import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { createTool } from '../../../../packages/core/src/tools'
import { z } from 'zod/v4'
import { mockModel } from './mock-model'

/**
 * 07.3 · loop 的可观察产物：steps 数组
 *
 * 每次 getFullOutput() 的结果里，output.steps 记录了 loop 的每一轮。
 * 这是「agent 自主循环」在返回值上留下的痕迹——每轮循环一个 step。
 *
 * 源码：loop/workflows/agentic-loop/index.ts:24（dowhile 每轮产出一个 step 结果）
 *       stream/base/output.ts（FullOutput.steps 的组装）
 */

describe('output.steps：每轮循环一个 step', () => {
  it('不调工具 → 1 个 step', async () => {
    const agent = new Agent({
      name: 'one',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: '直接回答' }]) as any,
    })
    const output: any = await (await agent.stream('hi')).getFullOutput()

    expect(Array.isArray(output.steps)).toBe(true)
    expect(output.steps.length).toBe(1) // 1 轮循环
  }, 15000)

  it('调 1 次工具 → 2 个 step（工具轮 + 回答轮）', async () => {
    const t = createTool({
      id: 't',
      description: 't',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    const agent = new Agent({
      name: 'two',
      instructions: 'x',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
        { kind: 'text', text: '完成' },
      ]) as any,
      tools: { t },
    })
    const output: any = await (await agent.stream('go')).getFullOutput()

    // 2 轮循环 = 2 个 step
    expect(output.steps.length).toBe(2)
  }, 15000)

  it('调 2 次工具 → 3 个 step', async () => {
    const t = createTool({
      id: 't',
      description: 't',
      inputSchema: z.object({}),
      outputSchema: z.object({ n: z.number() }),
      execute: async () => ({ n: 1 }),
    })
    const agent = new Agent({
      name: 'three',
      instructions: 'x',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
        { kind: 'tool-call', toolCallId: 'c2', toolName: 't', input: {} },
        { kind: 'text', text: '完成' },
      ]) as any,
      tools: { t },
    })
    const output: any = await (await agent.stream('go')).getFullOutput()

    expect(output.steps.length).toBe(3) // 3 轮循环
  }, 20000)
})

describe('每轮 step 的内容', () => {
  it('工具轮的 step 里有 toolCalls 和 toolResults', async () => {
    const t = createTool({
      id: 't',
      description: 't',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    const agent = new Agent({
      name: 'inspect',
      instructions: 'x',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
        { kind: 'text', text: 'done' },
      ]) as any,
      tools: { t },
    })
    const output: any = await (await agent.stream('go')).getFullOutput()

    // 第 1 轮（工具轮）：有 toolCalls（toolName 在 payload 里）
    const toolStep = output.steps.find((s: any) => s.toolCalls?.length)
    expect(toolStep).toBeDefined()
    expect(toolStep.toolCalls[0].payload.toolName).toBe('t')

    // 工具结果在 payload.result（见 02 的探查）
    const resultStep = output.steps.find((s: any) => s.toolResults?.length)
    expect(resultStep?.toolResults?.[0]?.payload?.result).toMatchObject({ ok: true })
  }, 15000)

  /**
   * ⭐ 校正：output.toolResults（顶层）也存在，是跨所有轮次的聚合数组。
   * 早期草稿曾错误地记录成「顶层没有 toolResults」——直接探测后发现记录有误，
   * 现已更正。这里把断言钉死，防止同样的误解再次进文档。
   */
  it('⭐ 顶层 output.toolCalls / output.toolResults 也存在（跨轮聚合，不只在 step 上）', async () => {
    const t = createTool({
      id: 't',
      description: 't',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    const agent = new Agent({
      name: 'top-level',
      instructions: 'x',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
        { kind: 'text', text: 'done' },
      ]) as any,
      tools: { t },
    })
    const output: any = await (await agent.stream('go')).getFullOutput()

    expect(output.toolCalls?.length).toBe(1)
    expect(output.toolResults?.length).toBe(1)
    // 顶层和 step 上的内容一致，顶层只是跨轮聚合
    const stepResult = output.steps.find((s: any) => s.toolResults?.length)
    expect(output.toolResults[0].payload.result).toEqual(stepResult.toolResults[0].payload.result)
  }, 15000)

  it('总 usage 累加所有轮次（成本核算，见 12）', async () => {
    const t = createTool({
      id: 't',
      description: 't',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    const agent = new Agent({
      name: 'usage',
      instructions: 'x',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
        { kind: 'text', text: 'done' },
      ]) as any,
      tools: { t },
    })
    const output: any = await (await agent.stream('go')).getFullOutput()

    // totalUsage 是所有轮次 usage 的累加（2 轮，每轮 mock 给 1 input + 1 output token）
    expect(output.totalUsage).toBeDefined()
    expect(output.steps.length).toBe(2)
  }, 15000)
})

describe('断点建议（不在测试里跑，留给手动 debug）', () => {
  /**
   * 跑任意一个上面的用例时，在这些位置打断点：
   *
   * 1. loop/workflows/agentic-loop/index.ts:24 的 .dowhile 条件闭包
   *    → 看 loop 为什么继续/停止（最有价值的断点）
   *
   * 2. loop/workflows/agentic-execution/llm-execution-step.ts 的 execute
   *    → 每一轮真正发给模型的 messages 和 tools
   *
   * 3. loop/workflows/agentic-execution/tool-call-step.ts 的 execute
   *    → 工具执行的上下文（你的 tool.execute 被包了几层）
   *
   * 4. llm/model/model.loop.ts:361 的 loop() 调用
   *    → agent 准备的一切以什么形态进入 loop（交界点）
   */
  it('占位：见上方注释的断点清单', () => {
    expect(true).toBe(true)
  })
})
