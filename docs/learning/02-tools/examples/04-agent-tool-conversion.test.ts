import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { createTool } from '../../../../packages/core/src/tools'
import { z } from 'zod/v4'
import { mockModel } from './mock-model'

/**
 * 02.4 · 工具从定义到被模型调用的转换链
 *
 * 源码：agent.ts:5696 getToolsForExecution → :5751 convertTools
 *       → tools/tool-builder/builder.ts CoreToolBuilder.build()（894 行附近）
 *
 * 你写的 Zod schema 不是模型直接看到的东西——中间经过 CoreToolBuilder
 * 转换成 CoreTool 格式（type/parameters/execute 等）。
 * 排查「模型传错参数」的第一现场就是对比这两个形状。
 */

describe('getToolsForExecution：转换后的工具形状', () => {
  it('转换后的工具有 type/parameters/execute（不是原始 Tool 实例）', async () => {
    const calc = createTool({
      id: 'calc',
      description: '加法',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
      execute: async (inputData: any) => ({ sum: inputData.a + inputData.b }),
    })

    const agent = new Agent({
      name: 'x',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
      tools: { calc },
    })

    const tools: any = await agent.getToolsForExecution({})

    // 转换后的形状：不再是 Tool 类实例，而是 CoreTool 格式
    expect(tools.calc.type).toBeDefined()
    expect(typeof tools.calc.execute).toBe('function')
    expect(tools.calc.parameters).toBeDefined() // JSON Schema 化的 inputSchema
    expect(tools.calc.description).toBe('加法')
  }, 15000)
})

describe('工具在真实 agent 循环里被正确调用（端到端验证）', () => {
  /**
   * 这是最有说服力的验证：不只检查转换后的形状，
   * 而是让模型真的「调用」这个工具，验证从 schema 到执行的完整链路。
   */
  it('模型调用工具 → 转换层解析参数 → 工具执行 → 结果正确', async () => {
    const multiply = createTool({
      id: 'multiply',
      description: '乘法',
      inputSchema: z.object({ x: z.number(), y: z.number() }),
      outputSchema: z.object({ product: z.number() }),
      execute: async (inputData: any) => ({ product: inputData.x * inputData.y }),
    })

    const agent = new Agent({
      name: 'calculator',
      instructions: '需要乘法时调用 multiply 工具',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 'multiply', input: { x: 6, y: 7 } },
        { kind: 'text', text: '答案是 42' },
      ]) as any,
      tools: { multiply },
    })

    const output: any = await (await agent.stream('6乘以7等于几')).getFullOutput()

    // 端到端验证：工具真的算出了 42（6*7），不是巧合
    const step = output.steps.find((s: any) => s.toolResults?.length)
    expect(step?.toolResults?.[0]?.payload?.result).toEqual({ product: 42 })
  }, 20000)
})

describe('多个工具同时注册', () => {
  it('agent 能同时持有多个工具，getToolsForExecution 全部返回', async () => {
    const add = createTool({
      id: 'add',
      description: '加法',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
      execute: async (inputData: any) => ({ sum: inputData.a + inputData.b }),
    })
    const sub = createTool({
      id: 'sub',
      description: '减法',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ diff: z.number() }),
      execute: async (inputData: any) => ({ diff: inputData.a - inputData.b }),
    })

    const agent = new Agent({
      name: 'multi-tool',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
      tools: { add, sub },
    })

    const tools: any = await agent.getToolsForExecution({})
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(['add', 'sub']))
  }, 15000)
})
