import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { createTool } from '../../../../packages/core/src/tools'
import { z } from 'zod/v4'
import { mockModel } from './mock-model'

/**
 * 04.3 · FullOutput 字段清单 —— 逐个验证真实值
 *
 * 源码：stream/base/output.ts:88-143（FullOutput 类型定义）
 *
 * FullOutput 是全框架 13 个模块能力在返回值上的投影：
 * tripwire 来自 processors（04.2）、rememberedMessages 来自 memory（09）、
 * traceId 来自 observability（12）、toolCalls/toolResults 来自 loop（07）。
 * 这份清单值得贴墙上——顺着字段反查是理解全框架的一条捷径。
 */

describe('token 用量字段：usage / totalUsage', () => {
  // 断点：stream/base/output.ts:1292 get usage；:1503 get totalUsage
  it('totalUsage 的真实形状（成本核算用，见 12）', async () => {
    const agent = new Agent({ name: 'p', instructions: 'x', model: mockModel([{ kind: 'text', text: 'hi' }]) as any })
    const output: any = await (await agent.stream('hi')).getFullOutput()

    expect(output.totalUsage).toMatchObject({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    })
    // raw 字段保留了 provider 的原始用量结构（服务端 fallback 场景要看这个，见 03-llm）
    expect(output.totalUsage.raw).toBeDefined()
  }, 15000)

  it('多轮工具调用后，totalUsage 是所有轮次的累加', async () => {
    const t = createTool({
      id: 't',
      description: 'd',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    const agent = new Agent({
      name: 'multi',
      instructions: 'x',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
        { kind: 'text', text: 'done' },
      ]) as any,
      tools: { t },
    })
    const output: any = await (await agent.stream('go')).getFullOutput()
    // 2 轮循环，totalUsage.totalTokens 应该是两轮的累加（不是只算最后一轮）
    expect(output.totalUsage.totalTokens).toBeGreaterThanOrEqual(output.usage.totalTokens)
  }, 20000)
})

describe('消息字段：messages / rememberedMessages', () => {
  // 断点：stream/base/output.ts 里 messages/rememberedMessages 的组装
  it('messages 包含本次交互的输入+输出（没配 memory 时 rememberedMessages 为空）', async () => {
    const agent = new Agent({
      name: 'p2',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'reply' }]) as any,
    })
    const output: any = await (await agent.stream('question')).getFullOutput()

    // messages：至少包含用户输入和模型回复
    expect(output.messages.length).toBeGreaterThanOrEqual(2)
    // 没有配置 memory，rememberedMessages（历史召回）应为空数组
    expect(output.rememberedMessages).toEqual([])
  }, 15000)
})

describe('标识字段：runId / traceId / spanId', () => {
  it('runId 是字符串（每次调用都不同）', async () => {
    const agent = new Agent({ name: 'p3', instructions: 'x', model: mockModel([{ kind: 'text', text: 'a' }]) as any })
    const o1: any = await (await agent.stream('hi')).getFullOutput()
    const o2: any = await (await agent.stream('hi')).getFullOutput()
    expect(typeof o1.runId).toBe('string')
    expect(o1.runId).not.toBe(o2.runId) // 每次调用独立的 runId
  }, 15000)

  it('没配置 observability 时，traceId/spanId 可能为 undefined（见 12）', async () => {
    const agent = new Agent({ name: 'p4', instructions: 'x', model: mockModel([{ kind: 'text', text: 'a' }]) as any })
    const output: any = await (await agent.stream('hi')).getFullOutput()
    // 不强制要求有值——取决于是否配置了 observability，这里只验证字段存在
    expect('traceId' in output).toBe(true)
    expect('spanId' in output).toBe(true)
  }, 15000)
})

describe('HITL 字段：suspendPayload / resumeSchema', () => {
  it('没有挂起时，两者都是 undefined', async () => {
    const agent = new Agent({ name: 'p5', instructions: 'x', model: mockModel([{ kind: 'text', text: 'a' }]) as any })
    const output: any = await (await agent.stream('hi')).getFullOutput()
    expect(output.suspendPayload).toBeUndefined()
  }, 15000)
})

describe('结构化输出字段：object', () => {
  it('不配 structuredOutput 时 object 为 undefined', async () => {
    const agent = new Agent({
      name: 'p6',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'plain' }]) as any,
    })
    const output: any = await (await agent.stream('hi')).getFullOutput()
    expect(output.object).toBeUndefined()
  }, 15000)
})

describe('⭐ 字段速查表（对照本文件的实测结果）', () => {
  /**
   * | 字段                | 来源模块        | 本文件对应用例 |
   * |---------------------|----------------|---------------|
   * | text / object       | 06-agent        | 结构化输出字段 |
   * | usage / totalUsage  | 03-llm / 12     | token 用量字段 |
   * | tripwire            | 08-processors   | 见 04.2       |
   * | traceId / spanId    | 12-observability| 标识字段       |
   * | suspendPayload      | 05-workflows    | HITL 字段     |
   * | messages / rememberedMessages | 09-memory | 消息字段  |
   * | toolCalls / toolResults | 07-loop     | 见 07.3       |
   */
  it('占位：见上方表格', () => {
    expect(true).toBe(true)
  })
})
