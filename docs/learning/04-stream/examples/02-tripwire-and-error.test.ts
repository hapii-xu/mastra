import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { TripWire } from '../../../../packages/core/src/agent/trip-wire'
import { mockModel } from './mock-model'

/**
 * 04.2 · ⭐ tripwire ≠ error —— 两种不同性质的失败
 *
 * 源码：packages/core/src/agent/trip-wire.ts（TripWire 类）
 *       stream/base/output.ts:1496 get tripwire()；:1334 get error()
 *
 * processor 主动中断（内容审核拦截、prompt 注入检测）走 tripwire 字段，
 * 不是 error。企业级做用户提示时必须区分这两者：
 *   result.tripwire → "你的输入包含敏感内容"（业务拦截，预期行为）
 *   result.error    → "系统异常"（技术故障，非预期）
 */

describe('processor 抛 TripWire → output.tripwire 有值，output.error 是 undefined', () => {
  it('实测：一个拦截型 processor 的完整产出', async () => {
    const blockProcessor = {
      id: 'blocker',
      processInput: async () => {
        throw new TripWire('内容被拦截：命中黑名单词', { retry: false })
      },
    }

    const agent = new Agent({
      name: 'guarded',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'should not reach' }]) as any,
      inputProcessors: [blockProcessor as any],
    })

    const output: any = await (await agent.stream('危险词')).getFullOutput()

    // ⭐ tripwire 有完整信息：reason / retry / processorId
    expect(output.tripwire).toMatchObject({
      reason: '内容被拦截：命中黑名单词',
      retry: false,
    })
    expect(output.tripwire.processorId).toBeDefined()

    // ⭐ error 是 undefined —— 这不是系统故障，是设计内的拦截
    expect(output.error).toBeUndefined()

    // 模型根本没被调用，text 是空的
    expect(output.text).toBe('')
  }, 15000)

  it('TripWire 可以携带结构化 metadata（供业务代码判断具体拦截原因）', async () => {
    const blockProcessor = {
      id: 'blocker2',
      processInput: async () => {
        throw new TripWire('检测到 PII', { retry: false, metadata: { category: 'pii', field: 'phone' } })
      },
    }
    const agent = new Agent({
      name: 'pii-guard',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'x' }]) as any,
      inputProcessors: [blockProcessor as any],
    })
    const output: any = await (await agent.stream('我的电话是 123')).getFullOutput()
    expect(output.tripwire.metadata).toEqual({ category: 'pii', field: 'phone' })
  }, 15000)
})

describe('正常执行时，tripwire 和 error 都是 undefined', () => {
  it('没有 processor 拦截 → 两者都没有值', async () => {
    const agent = new Agent({
      name: 'normal',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
    })
    const output: any = await (await agent.stream('hi')).getFullOutput()
    expect(output.tripwire).toBeUndefined()
    expect(output.error).toBeUndefined()
    expect(output.text).toBe('ok')
  }, 15000)
})

describe('实战：企业级判断逻辑', () => {
  it('区分「业务拦截」vs「正常完成」的判断模式', async () => {
    const blockProcessor = {
      id: 'guard',
      processInput: async () => {
        throw new TripWire('触发内容策略', { retry: false })
      },
    }
    const agent = new Agent({
      name: 'e',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'x' }]) as any,
      inputProcessors: [blockProcessor as any],
    })
    const output: any = await (await agent.stream('test')).getFullOutput()

    // 企业级判断模式：先查 tripwire，再查 error，最后才是正常文本
    const userMessage = output.tripwire
      ? `请求被拦截：${output.tripwire.reason}`
      : output.error
        ? '系统繁忙，请稍后再试'
        : output.text

    expect(userMessage).toBe('请求被拦截：触发内容策略')
  }, 15000)
})
