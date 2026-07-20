import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { TokenLimiterProcessor } from '../../../../packages/core/src/processors/processors/token-limiter'
import { mockModel } from './mock-model'

/**
 * 08.2 · 内置 processor 实战：TokenLimiterProcessor
 *
 * 源码：packages/core/src/processors/processors/token-limiter.ts
 *
 * 这是最简单、最适合当第一个精读对象的内置 processor：短、逻辑清晰、
 * 无外部依赖（用 tokenx 库估算 token，不需要真实的 tokenizer）。
 *
 * 用途：防止长对话把上下文窗口撑爆，超限时按「系统消息永远保留、
 * 非系统消息保留最近的」策略裁剪历史。
 */

describe('构造：数字简写 vs 完整配置对象', () => {
  it('传数字 = token 上限，其余用默认策略', () => {
    const p = new TokenLimiterProcessor(1000)
    expect(p.id).toBe('token-limiter')
  })

  it('传对象可以精细配置 strategy/countMode/trimMode', () => {
    const p = new TokenLimiterProcessor({ limit: 1000, strategy: 'truncate', countMode: 'cumulative' })
    expect(p.id).toBe('token-limiter')
  })
})

describe('⭐ 作为 input processor：裁剪超限的历史消息', () => {
  it('token 预算充足时，不影响正常对话', async () => {
    const agent = new Agent({
      name: 'limited',
      instructions: '你是个助手',
      model: mockModel([{ kind: 'text', text: '正常回复' }]) as any,
      inputProcessors: [new TokenLimiterProcessor(10000)], // 预算很大，不会触发裁剪
    })
    const output = await (await agent.stream('简短问题')).getFullOutput()
    expect(output.text).toBe('正常回复')
  }, 15000)

  it('⚠️ 系统消息本身超过预算 → 抛 TripWire（不是静默失败）', async () => {
    const longInstructions = '这是一段很长的系统指令。'.repeat(200) // 制造超长系统消息
    const agent = new Agent({
      name: 'tiny-budget',
      instructions: longInstructions,
      model: mockModel([{ kind: 'text', text: 'unreachable' }]) as any,
      inputProcessors: [new TokenLimiterProcessor(5)], // 极小预算，系统消息都装不下
    })
    const output: any = await (await agent.stream('hi')).getFullOutput()

    // 源码：System messages alone exceed token limit → TripWire
    expect(output.tripwire).toBeDefined()
    expect(output.tripwire.reason).toContain('exceed token limit')
    expect(output.tripwire.metadata).toMatchObject({ limit: 5 })
  }, 15000)
})

describe('企业级用法：多轮长对话防止上下文爆炸', () => {
  it('token-limiter 配合 agent 的多轮工具循环也能正常工作', async () => {
    // 这里只验证 processor 不会破坏正常的 agent 执行链路
    const agent = new Agent({
      name: 'safe-long-chat',
      instructions: '简短的系统指令',
      model: mockModel([{ kind: 'text', text: '回复' }]) as any,
      inputProcessors: [new TokenLimiterProcessor({ limit: 8000, strategy: 'truncate' })],
    })
    const output = await (await agent.stream('正常问题')).getFullOutput()
    expect(output.text).toBe('回复')
  }, 15000)
})
