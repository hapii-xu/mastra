import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { createTool } from '../../../../packages/core/src/tools'
import { z } from 'zod/v4'
import { mockModel } from './mock-model'

/**
 * 07.2 · ⭐ agentic 循环：调工具 → 继续 → 完成
 *
 * 源码：loop/workflows/agentic-loop/index.ts:24（.dowhile 的停止条件）
 *       loop/workflows/agentic-execution/index.ts:113（一轮循环的 8 个 step）
 *
 * ⭐ 这是全模块最好的一课：「Agent 自主循环」的全部秘密：
 *    模型返回 finishReason:'tool-calls' → loop 执行工具 → 再调模型
 *    模型返回 finishReason:'stop'        → loop 结束
 *    就是一个 .dowhile，停止条件看 finishReason。
 *
 * mock 模型按顺序消费 responses：第 1 次返回 tool-call，第 2 次返回最终文本。
 * 断点：agentic-loop/index.ts:24 的 dowhile 条件闭包；agentic-execution 的 llmExecutionStep。
 */

describe('⭐ 模型调工具 → loop 继续 → 模型给最终答案 → loop 结束', () => {
  it('finishReason=tool-calls 触发新一轮，finishReason=stop 结束', async () => {
    let toolCalled = 0
    // ⚠️ tool.execute 是位置参数 (inputData, context)，不是 ({ context }) 解构。
    //    用 { context } 解构第一参会拿到 inputData 里名叫 context 的字段（这里是 undefined），
    //    静默产出 NaN、被 outputSchema 校验拦截成 { error: true, message: '...' }。
    //    完整的坑与验证过程见 02-tools/02-execute-contract.md。
    const calc = createTool({
      id: 'calc',
      description: '加法',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
      execute: async (inputData: any) => {
        toolCalled++
        return { sum: inputData.a + inputData.b }
      },
    })

    const agent = new Agent({
      name: 'looping',
      instructions: '需要算数时调 calc 工具',
      model: mockModel([
        // 第 1 轮：模型决定调 calc(2,3)
        { kind: 'tool-call', toolCallId: 'c1', toolName: 'calc', input: { a: 2, b: 3 } },
        // 第 2 轮：拿到工具结果后，模型给出最终答案
        { kind: 'text', text: '结果是 5' },
      ]) as any,
      tools: { calc },
    })

    const output: any = await (await agent.stream('2+3 等于几')).getFullOutput()

    // 工具被调了一次（证明 loop 执行了工具）
    expect(toolCalled).toBe(1)
    // ⭐ 验证工具真的算对了（不只是 mock 文本凑巧对上）——2+3=5，不是 NaN
    const stepWithResults = (output.steps as any[])?.find(s => s.toolResults?.length)
    expect(stepWithResults?.toolResults?.[0]?.payload?.result).toEqual({ sum: 5 })
    // loop 跑了 2 轮后用最终文本结束（证明工具结果被回传给模型，模型给出最终答案）
    expect(output.text).toContain('结果是 5')
    expect(output.finishReason).toBe('stop')
    // toolResults 的具体位置见下一个 describe（在 output.steps[i].toolResults）
  }, 20000)
})

describe('停止条件 = finishReason', () => {
  it('模型不调工具（直接 stop）→ loop 只跑一轮', async () => {
    let toolCalled = 0
    const calc = createTool({
      id: 'calc',
      description: '加法',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
      execute: async () => {
        toolCalled++
        return { sum: 0 }
      },
    })
    const agent = new Agent({
      name: 'no-tool',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: '我不需要工具' }]) as any,
      tools: { calc },
    })
    const output = await (await agent.stream('hi')).getFullOutput()
    expect(toolCalled).toBe(0) // 没调工具
    expect(output.finishReason).toBe('stop')
  }, 15000)

  it('多轮工具调用：调两次工具再结束', async () => {
    let calls = 0
    const ping = createTool({
      id: 'ping',
      description: 'ping',
      inputSchema: z.object({}),
      outputSchema: z.object({ n: z.number() }),
      execute: async () => {
        calls++
        return { n: calls }
      },
    })
    const agent = new Agent({
      name: 'multi',
      instructions: 'x',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 'ping', input: {} },
        { kind: 'tool-call', toolCallId: 'c2', toolName: 'ping', input: {} },
        { kind: 'text', text: '调了两次' },
      ]) as any,
      tools: { ping },
    })
    const output = await (await agent.stream('go')).getFullOutput()
    expect(calls).toBe(2) // 两轮工具调用
    expect(output.text).toContain('调了两次')
  }, 20000)
})

describe('agentic-execution 一轮循环的 8 个 step', () => {
  /**
   * 每一轮循环（loop/workflows/agentic-execution/index.ts:113-140）：
   *   .then(llmExecutionStep)      ← 调模型（本文件的 mock）
   *   .map(map-tool-calls)         ← 算工具并发度
   *   .foreach(toolCallStep)       ← 执行工具（本文件的 calc/ping）
   *   .then(llmMappingStep)        ← 结果映射
   *   .then(backgroundTaskCheckStep)
   *   .then(signalDrainStep)
   *   .then(isTaskCompleteStep)    ← 影响 dowhile 停止条件
   *   .then(goalStep)
   *
   * 断点建议：在 tool-call-step.ts 的 execute 打断点，看工具执行的上下文。
   */
  it('工具在 foreach(step) 里执行（间接验证：toolResults 出现在输出）', async () => {
    const t = createTool({
      id: 't',
      description: 't',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    const agent = new Agent({
      name: 'foreach',
      instructions: 'x',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
        { kind: 'text', text: 'done' },
      ]) as any,
      tools: { t },
    })
    const output = await (await agent.stream('go')).getFullOutput()
    // toolResults 在 step 上（每轮循环一个 step）；结果在 payload.result
    const stepWithResults = (output.steps as any[])?.find(s => s.toolResults?.length)
    expect(stepWithResults?.toolResults?.[0]?.payload?.result).toMatchObject({ ok: true })
  }, 15000)
})
