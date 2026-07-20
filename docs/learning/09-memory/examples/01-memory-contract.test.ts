import { describe, expect, it } from 'vitest'
import { MockMemory } from '../../../../packages/core/src/memory/mock'

/**
 * 09.1 · MastraMemory 契约 —— Thread / Message / Working Memory
 *
 * 源码：packages/core/src/memory/memory.ts:114（abstract class MastraMemory）
 *       packages/core/src/memory/mock.ts:75（MockMemory —— 最简单的完整实现）
 *
 * core 只定义抽象契约（13 个抽象方法），真正的实现在 @mastra/memory 包
 * （embedding 语义召回、LRU 缓存、observational memory 等）。
 * MockMemory 是学习契约本身最好的入口——纯内存、零依赖、零构建。
 *
 * 核心概念只有两个：Thread（会话）和 Message（消息），
 * 外加一个正交的 Working Memory（工作记忆）。
 */

describe('createThread：具体辅助方法（非抽象）', () => {
  // memory.ts 里 createThread 不是 abstract，它组装好 thread 对象后调用 saveThread
  it('不传 threadId 会自动生成一个', async () => {
    const memory = new MockMemory()
    const thread = await memory.createThread({ resourceId: 'r1', title: '我的会话' })

    expect(thread.id).toBeDefined()
    expect(thread.resourceId).toBe('r1')
    expect(thread.title).toBe('我的会话')
  })

  it('传 threadId 会原样使用', async () => {
    const memory = new MockMemory()
    const thread = await memory.createThread({ resourceId: 'r1', threadId: 'fixed-id' })
    expect(thread.id).toBe('fixed-id')
  })
})

describe('saveMessages + recall：消息的存储与召回', () => {
  it('保存的消息能被 recall 取回', async () => {
    const memory = new MockMemory()
    const thread = await memory.createThread({ resourceId: 'r1' })

    await memory.saveMessages({
      messages: [
        {
          id: 'm1',
          threadId: thread.id,
          resourceId: 'r1',
          role: 'user',
          content: { format: 2, parts: [{ type: 'text', text: 'hello' }] },
        } as any,
        {
          id: 'm2',
          threadId: thread.id,
          resourceId: 'r1',
          role: 'assistant',
          content: { format: 2, parts: [{ type: 'text', text: 'hi there' }] },
        } as any,
      ],
    })

    const recalled = await memory.recall({ threadId: thread.id, resourceId: 'r1' } as any)

    expect(recalled.total).toBe(2)
    expect(recalled.messages.length).toBe(2)
  })

  it('不同 thread 之间消息互不干扰', async () => {
    const memory = new MockMemory()
    const t1 = await memory.createThread({ resourceId: 'r1' })
    const t2 = await memory.createThread({ resourceId: 'r1' })

    await memory.saveMessages({
      messages: [
        {
          id: 'm1',
          threadId: t1.id,
          resourceId: 'r1',
          role: 'user',
          content: { format: 2, parts: [{ type: 'text', text: 'in t1' }] },
        } as any,
      ],
    })

    const r1 = await memory.recall({ threadId: t1.id, resourceId: 'r1' } as any)
    const r2 = await memory.recall({ threadId: t2.id, resourceId: 'r1' } as any)

    expect(r1.total).toBe(1)
    expect(r2.total).toBe(0) // t2 没有消息
  })
})

describe('listThreads / getThreadById / deleteThread', () => {
  /**
   * ⚠️ 实测发现：MockMemory.listThreads({ resourceId }) 并不会按 resourceId
   * 过滤——它把底层 InMemoryStore 里的全部 thread 都返回了，不管属于哪个
   * resourceId。这是本次写作过程中的一次真实教训：mock 实现不完全代表
   * 生产存储（如 PG/LibSQL 适配器）的过滤行为，自己实现存储适配器时，
   * 别假设 mock 的行为就是契约要求的行为——以 storage/types.ts 的类型
   * 声明和生产适配器的测试为准。
   */
  it('⚠️ MockMemory 的 listThreads 实测不按 resourceId 过滤（返回全部 thread）', async () => {
    const memory = new MockMemory()
    await memory.createThread({ resourceId: 'r1', title: 'A' })
    await memory.createThread({ resourceId: 'r1', title: 'B' })
    await memory.createThread({ resourceId: 'r2', title: 'C' }) // 不同 resource

    const list = await memory.listThreads({ resourceId: 'r1' } as any)
    // 实测：返回了全部 3 个，不是预期中过滤后的 2 个
    expect(list.threads.length).toBe(3)
  })

  it('deleteThread 后 getThreadById 找不到', async () => {
    const memory = new MockMemory()
    const thread = await memory.createThread({ resourceId: 'r1' })
    await memory.deleteThread(thread.id)

    const got = await memory.getThreadById({ threadId: thread.id })
    expect(got).toBeNull()
  })
})

describe('Working Memory：独立于对话历史的「便签」', () => {
  it('getWorkingMemory 初始为空，updateWorkingMemory 后能取回', async () => {
    const memory = new MockMemory({ options: { workingMemory: { enabled: true } } } as any)
    const thread = await memory.createThread({ resourceId: 'r1' })

    await memory.updateWorkingMemory({
      threadId: thread.id,
      resourceId: 'r1',
      workingMemory: '用户喜欢简洁的回答',
    } as any)

    const wm = await memory.getWorkingMemory({ threadId: thread.id, resourceId: 'r1' } as any)
    expect(wm).toContain('简洁')
  })
})
