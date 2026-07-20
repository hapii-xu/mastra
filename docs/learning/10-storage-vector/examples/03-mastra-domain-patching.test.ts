import { describe, expect, it } from 'vitest'
import { Mastra } from '../../../../packages/core/src/mastra'
import { MastraCompositeStore } from '../../../../packages/core/src/storage/base'
import { InMemoryStore } from '../../../../packages/core/src/storage/mock'

/**
 * 10.3 · ⭐ Mastra 自动补齐缺失 domain（实测）
 *
 * 源码：storage/storageWithInit.ts（augmentWithInit）；mastra/index.ts 构造函数
 *
 * 11-mastra 索引提到「Mastra 会自动补齐缺失的 domain（workflows、
 * backgroundTasks）为内存实现，因为 evented workflow 引擎强依赖它们」——
 * 本文件用真实断言验证了这一点。
 *
 * ⭐ 企业级含义：如果你的自定义存储适配器只实现了部分 domain（比如只做了
 * memory 但没做 workflows），注册到 Mastra 后依然能跑，但那部分数据
 * 悄悄地被存进了内存（重启即丢），而不是你自定义的后端。
 */

describe('只配置部分 domain 的 store', () => {
  it('注册到 Mastra 前，缺失的 domain 确实是 undefined', async () => {
    const full = new InMemoryStore()
    const partial = new MastraCompositeStore({
      id: 'partial',
      domains: { memory: full.stores?.memory }, // 只给 memory
    })

    expect(partial.stores?.memory).toBeDefined()
    expect(partial.stores?.workflows).toBeUndefined()
  })
})

describe('⭐ 注册到 Mastra 后，缺失的 workflows domain 被自动补齐', () => {
  it('实测：workflows domain 从 undefined 变成可用', async () => {
    const full = new InMemoryStore()
    const partial = new MastraCompositeStore({
      id: 'partial',
      domains: { memory: full.stores?.memory },
    })

    const mastra = new Mastra({ storage: partial as any })
    const storage = mastra.getStorage()
    const workflowsStore = await storage?.getStore('workflows')

    // 之前是 undefined，注册到 Mastra 后变成可用（自动补的内存实现）
    expect(workflowsStore).toBeDefined()
  })

  it('⚠️ 补的是内存实现，不是你自定义的后端 —— 数据不会持久化到你期望的地方', async () => {
    const full = new InMemoryStore()
    const partial = new MastraCompositeStore({
      id: 'partial',
      domains: { memory: full.stores?.memory },
    })

    const mastra = new Mastra({ storage: partial as any })
    const storage = mastra.getStorage()
    const workflowsStore = await storage?.getStore('workflows')

    // 能正常写入/读取，但这份数据存在自动补的内存 store 里，
    // 完全不经过你原本配置的存储后端。
    await workflowsStore?.persistWorkflowSnapshot({
      workflowName: 'wf',
      runId: 'r1',
      snapshot: { status: 'success' } as any,
    })
    const loaded = await workflowsStore?.loadWorkflowSnapshot({ workflowName: 'wf', runId: 'r1' })
    expect(loaded).toEqual({ status: 'success' })

    // 关键：这个 workflowsStore 不是 full.stores.workflows（你可能以为的持久化后端）
    expect(workflowsStore).not.toBe(full.stores?.workflows)
  })
})

describe('完整配置的 store 不会被覆盖', () => {
  it('已提供的 domain 保持原样，不会被自动补的实现替换', async () => {
    const full = new InMemoryStore()
    const mastra = new Mastra({ storage: full as any })
    const storage = mastra.getStorage()
    const memoryStore = await storage?.getStore('memory')

    // 完整配置时，memory domain 就是你传入的那个实例
    expect(memoryStore).toBe(full.stores?.memory)
  })
})
