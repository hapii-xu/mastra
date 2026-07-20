import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { MockMemory } from '../../../../packages/core/src/memory/mock'
import { mockModel } from '../../07-loop/examples/mock-model'

/**
 * 09.2 · ⭐ Agent + Memory 集成 —— 正确的调用形态
 *
 * 源码：agent/types.ts:909（AgentMemoryOption）；agent/save-queue/index.ts（防抖持久化）
 *
 * ⭐⭐⭐ 本次写作过程中的真实陷阱：agent.stream() 传 threadId/resourceId
 * 到顶层选项**完全不生效**（不报错，只是静默不生效——消息不会存进 memory）。
 * 正确形态是嵌套的 `memory: { thread, resource }`。
 */

describe('⚠️ 顶层 threadId/resourceId 不生效', () => {
  it('顶层传参，memory 不会保存任何消息（静默失败）', async () => {
    const memory = new MockMemory()
    const agent = new Agent({
      name: 'm',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'reply' }]) as any,
      memory: memory as any,
    })

    // ❌ 错误写法：threadId/resourceId 放在顶层
    await (await agent.stream('hello', { threadId: 't1', resourceId: 'r1' } as any)).getFullOutput()
    await new Promise(r => setTimeout(r, 300)) // 等过防抖窗口

    const recalled = await memory.recall({ threadId: 't1', resourceId: 'r1' } as any)
    // 什么都没存进去 —— 没有报错，纯粹静默失效
    expect(recalled.total).toBe(0)
  }, 15000)
})

describe('✅ 正确形态：memory: { thread, resource }', () => {
  it('嵌套在 memory 选项里才会生效', async () => {
    const memory = new MockMemory()
    const agent = new Agent({
      name: 'm',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'reply' }]) as any,
      memory: memory as any,
    })

    // ✅ 正确写法
    await (await agent.stream('hello', { memory: { thread: 't1', resource: 'r1' } } as any)).getFullOutput()
    await new Promise(r => setTimeout(r, 300))

    const recalled = await memory.recall({ threadId: 't1', resourceId: 'r1' } as any)
    expect(recalled.total).toBe(2) // 用户消息 + 助手回复都存了
  }, 15000)
})

describe('⭐ 跨调用记忆：第二次调用能召回第一次的历史', () => {
  it('output.rememberedMessages 在第二次调用时有值', async () => {
    const memory = new MockMemory()
    const memoryOpts = { memory: { thread: 't-conv', resource: 'r-conv' } } as any

    const agent1 = new Agent({
      name: 'm',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: '第一次回复' }]) as any,
      memory: memory as any,
    })
    await (await agent1.stream('第一句话', memoryOpts)).getFullOutput()
    await new Promise(r => setTimeout(r, 300)) // 等防抖持久化完成

    const agent2 = new Agent({
      name: 'm',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: '第二次回复' }]) as any,
      memory: memory as any,
    })
    const r2: any = await (await agent2.stream('第二句话', memoryOpts)).getFullOutput()

    // 第二次调用能看到第一轮的 2 条消息（用户+助手）
    expect(r2.rememberedMessages.length).toBe(2)
  }, 20000)
})

describe('⭐ 消息持久化是防抖的（agent/save-queue）', () => {
  /**
   * save-queue/index.ts：debounceMs 默认 100ms。这意味着 agent.stream()
   * 返回后，消息不一定立刻落盘——进程异常退出可能丢最近的消息。
   */
  it('立刻查询（不等待）可能看不到刚保存的消息', async () => {
    const memory = new MockMemory()
    const agent = new Agent({
      name: 'm',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'reply' }]) as any,
      memory: memory as any,
    })

    await (await agent.stream('hello', { memory: { thread: 't-immediate', resource: 'r1' } } as any)).getFullOutput()
    // 不等待，立刻查询
    const recalledImmediately = await memory.recall({ threadId: 't-immediate', resourceId: 'r1' } as any)

    // 等待防抖窗口后再查一次
    await new Promise(r => setTimeout(r, 300))
    const recalledAfterWait = await memory.recall({ threadId: 't-immediate', resourceId: 'r1' } as any)

    // 等待之后一定能看到完整消息；立刻查询的结果不保证（取决于防抖时机，
    // 这里只强调「等待之后」是可靠的读取方式）
    expect(recalledAfterWait.total).toBe(2)
  }, 15000)
})
