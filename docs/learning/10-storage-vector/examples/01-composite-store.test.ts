import { describe, expect, it } from 'vitest'
import { MastraCompositeStore } from '../../../../packages/core/src/storage/base'
import { InMemoryStore } from '../../../../packages/core/src/storage/mock'

/**
 * 10.1 · MastraCompositeStore —— 组合式而非单体
 *
 * 源码：packages/core/src/storage/base.ts:287（MastraCompositeStore）
 *       packages/core/src/storage/mock.ts:45（InMemoryStore，25 个 domain 全内存实现）
 *
 * ⭐ 关键设计：存储不是一个大接口，而是按 domain 组合的。
 * 企业级价值：消息用 PG、快照用 Redis、追踪用 ClickHouse，混搭。
 */

describe('getStore(domain)：按 domain 取具体实现', () => {
  it('workflows domain 能持久化/读取快照', async () => {
    const storage = new InMemoryStore()
    const workflows = await storage.getStore('workflows')

    await workflows?.persistWorkflowSnapshot({
      workflowName: 'wf1',
      runId: 'run1',
      snapshot: { status: 'running' } as any,
    })
    const loaded = await workflows?.loadWorkflowSnapshot({ workflowName: 'wf1', runId: 'run1' })

    expect(loaded).toEqual({ status: 'running' })
  })
})

describe('⭐ 组合模式：从多个 store 混搭 domain', () => {
  /**
   * 断点：storage/base.ts 里的 resolve() 函数（构造函数内部）。
   * 优先级：domains override > editor（针对 editor 专属 domain）> default。
   */
  it('domains override 能精确指定某个 domain 用另一个 store', async () => {
    const storeA = new InMemoryStore({ id: 'a' })
    const storeB = new InMemoryStore({ id: 'b' })

    const composite = new MastraCompositeStore({
      id: 'composed',
      default: storeA,
      domains: { memory: storeB.stores?.memory }, // 只覆盖 memory，其余用 A
    })

    // memory domain 来自 storeB（override 生效）
    expect(composite.stores?.memory).toBe(storeB.stores?.memory)
    // 其他 domain 依然来自 storeA（default 兜底）
    expect(composite.stores?.workflows).toBe(storeA.stores?.workflows)
  })

  it('override 为 false 时该 domain 被禁用（不回退到 default）', async () => {
    const storeA = new InMemoryStore({ id: 'a' })

    const composite = new MastraCompositeStore({
      id: 'composed2',
      default: storeA,
      domains: { blobs: false }, // 显式禁用
    })

    expect(composite.stores?.blobs).toBeUndefined()
    // 其他 domain 不受影响
    expect(composite.stores?.workflows).toBe(storeA.stores?.workflows)
  })

  /**
   * ⚠️ 实测发现：这条校验只在「提供了组合配置」时才触发
   * （config.default || config.editor || config.domains 任一为真）。
   * 完全不传这三者（比如只传 { id }）根本不会走进组合分支，
   * 此时 this.stores 就是 undefined——不报错，但也没有任何 domain 可用。
   */
  it('⚠️ 完全不传 default/editor/domains 时不会抛错，但 stores 是 undefined', () => {
    const bare = new MastraCompositeStore({ id: 'bare' })
    expect(bare.stores).toBeUndefined()
  })

  it('传了 domains 但里面全是 undefined → 抛错（没有实际来源）', () => {
    expect(() => new MastraCompositeStore({ id: 'empty', domains: { memory: undefined } })).toThrow(
      /requires at least one storage source/,
    )
  })
})

describe('构造函数校验：id 是必需的', () => {
  it('空 id 会抛错', () => {
    expect(() => new InMemoryStore({ id: '' })).toThrow(/id must be provided/)
  })
})
