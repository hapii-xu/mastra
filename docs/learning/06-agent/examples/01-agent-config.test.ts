import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { createTool } from '../../../../packages/core/src/tools'
import { z } from 'zod/v4'
import { mockModel } from './mock-model'

/**
 * 06.1 · Agent 构造与配置
 *
 * 源码：packages/core/src/agent/agent.ts（8952 行，class Agent :457）
 *
 * Agent 把模型、工具、记忆、处理器、可观测性编排成一个能自主完成任务的单元。
 * 本文件聚焦「Agent 自身的配置」——loop 机制见 07，工具执行见 02。
 *
 * ⭐ 核心事实：agent.stream() 展开是三层嵌套 workflow（见 06 文档）。
 *    所以学 06 之前要先学 05（workflow）和 07（loop）。
 */

describe('Agent 最小配置', () => {
  // 断点：agent.ts:457 class Agent
  it('name + instructions + model 就能跑', async () => {
    const agent = new Agent({
      name: 'minimal',
      instructions: '你是个助手',
      model: mockModel([{ kind: 'text', text: '你好' }]) as any,
    })
    const out = await (await agent.stream('hi')).getFullOutput()
    expect(out.text).toContain('你好')
  }, 15000)
})

describe('instructions / 系统提示词', () => {
  it('getInstructions 能取到配置的指令', async () => {
    const agent = new Agent({
      name: 'instr',
      instructions: '你是个翻译助手',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
    })
    const instr = await agent.getInstructions()
    expect(String(instr)).toContain('翻译助手')
  }, 15000)

  // instructions 也支持 DynamicArgument（按请求动态生成，见 03）
  it('instructions 可以是函数', async () => {
    const agent = new Agent({
      name: 'dyn-instr',
      instructions: async () => '动态指令',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
    })
    expect(String(await agent.getInstructions())).toContain('动态指令')
  }, 15000)
})

describe('metadata —— 任意元数据', () => {
  it('能挂自定义元数据（版本、分类等）', async () => {
    const agent = new Agent({
      name: 'meta',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
      metadata: { role: 'support', version: 3, tags: ['public'] },
    })
    // metadata 用 getMetadata() 取（支持 DynamicArgument，所以是 async）
    const meta = await agent.getMetadata()
    expect(meta).toMatchObject({ role: 'support', version: 3 })
  })
})

describe('工具配置（多来源之一：直接 tools）', () => {
  // agent.ts 有 11 个 list*Tools 方法，最常见的是直接配 tools: {}
  // ⚠️ tool.execute 是位置参数 (inputData, context)，不是 ({ context }) 解构——
  //    这里故意写成正确写法，完整的坑详见 02-tools/02-execute-contract.md
  it('tools: {} 注册工具，agent 能拿到', async () => {
    const calc = createTool({
      id: 'calc',
      description: '加法',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
      execute: async (inputData: any) => ({ sum: inputData.a + inputData.b }),
    })
    const agent = new Agent({
      name: 'tools',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
      tools: { calc },
    })
    // getToolsForExecution 拿到转换后的工具（见 02-tools）；要传 options 对象
    const tools = await agent.getToolsForExecution({})
    expect(tools.calc).toBeDefined()
  }, 15000)
})

describe('agent 可以脱离 Mastra 独立使用（ephemeral mastra）', () => {
  /**
   * #getOrCreateEphemeralMastra（agent.ts #execute 第 4 步）：
   * Agent 没注册到 Mastra 时，会自己造一个临时实例。
   * 这就是为什么测试里能直接 new Agent({...}).stream()。
   */
  it('不注册 Mastra 也能 stream', async () => {
    const agent = new Agent({
      name: 'ephemeral',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'no-mastra' }]) as any,
    })
    const out = await (await agent.stream('hi')).getFullOutput()
    expect(out.text).toBe('no-mastra')
  }, 15000)
})
