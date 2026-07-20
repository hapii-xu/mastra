import { describe, expect, it } from 'vitest'
import {
  MASTRA_VERSIONS_KEY,
  mergeVersionOverrides,
  RequestContext,
  type VersionOverrides,
} from '../../../../packages/_internal-core/src/request-context'

/**
 * 05 · 版本覆盖 mergeVersionOverrides
 *
 * 源码：packages/_internal-core/src/request-context/index.ts:53-81
 *
 * 用途：子 agent 委派时决定「用哪个版本的 agent」。
 * 三级优先级在 agent/agent.ts:6479-6488 组装：
 *   Mastra 默认  <  requestContext  <  调用点 options.versions
 */

describe('类型形状（index.ts:53-59）', () => {
  it('VersionSelector 是二选一联合：按 id 或按状态', () => {
    const byId: VersionOverrides = { agents: { a: { versionId: '123' } } }
    const byStatus: VersionOverrides = { agents: { a: { status: 'published' } } }

    expect(byId.agents?.a).toEqual({ versionId: '123' })
    expect(byStatus.agents?.a).toEqual({ status: 'published' })
  })
})

describe('mergeVersionOverrides 的合并语义（index.ts:61-81）', () => {
  // 断点：index.ts:65 的 if (!base && !overrides)
  it('两边都空 → undefined（而不是空对象）', () => {
    expect(mergeVersionOverrides(undefined, undefined)).toBeUndefined()
  })

  // 断点：index.ts:70-73 的 agents 展开
  it('⭐ agents 是「逐键」浅合并，不是整体替换', () => {
    const base: VersionOverrides = {
      agents: {
        researcher: { versionId: 'v1' },
        writer: { versionId: 'v1' },
      },
    }
    const overrides: VersionOverrides = {
      agents: { writer: { versionId: 'v2' } }, // 只覆盖 writer
    }

    const merged = mergeVersionOverrides(base, overrides)

    // researcher 存活（若是整体替换就没了），writer 被覆盖
    expect(merged?.agents).toEqual({
      researcher: { versionId: 'v1' },
      writer: { versionId: 'v2' },
    })
  })

  // 断点：index.ts:75-79 那串嵌套三元
  it('defaultStatus：overrides 赢', () => {
    const merged = mergeVersionOverrides({ defaultStatus: 'published' }, { defaultStatus: 'draft' })
    expect(merged?.defaultStatus).toBe('draft')
  })

  it('defaultStatus：overrides 没给就回退 base', () => {
    const merged = mergeVersionOverrides({ defaultStatus: 'published' }, { agents: {} })
    expect(merged?.defaultStatus).toBe('published')
  })

  /**
   * ⭐ 这条解释了 index.ts:75-79 为什么要写成嵌套三元展开，而不是直接
   *    defaultStatus: overrides?.defaultStatus ?? base?.defaultStatus
   *
   * 因为第 69 行的 ...overrides 展开时，若 overrides 里有 defaultStatus: undefined，
   * 会把 base 的值覆盖成 undefined。用条件展开才能做到「没给就整个字段不出现」。
   */
  it('⭐ 两边都没给 → 字段整个不出现（不是 undefined）', () => {
    const merged = mergeVersionOverrides({ agents: { a: { versionId: '1' } } }, {})

    expect('defaultStatus' in (merged ?? {})).toBe(false)
  })

  it('单边为空也能正常工作', () => {
    expect(mergeVersionOverrides(undefined, { defaultStatus: 'draft' })?.defaultStatus).toBe('draft')
    expect(mergeVersionOverrides({ defaultStatus: 'draft' }, undefined)?.defaultStatus).toBe('draft')
  })
})

describe('三级优先级链（复刻 agent/agent.ts:6479-6488）', () => {
  /**
   * 断点：agent.ts:6479。观察两次 mergeVersionOverrides 的连续调用，
   *      以及 :6488 把结果写回 MASTRA_VERSIONS_KEY —— 这样子 agent 才能继承。
   */
  it('Mastra 默认 < requestContext < 调用点', () => {
    const mastraDefaults: VersionOverrides = { defaultStatus: 'published' }
    const fromRequestContext: VersionOverrides = { agents: { researcher: { versionId: 'ctx' } } }
    const fromCallSite: VersionOverrides = { agents: { researcher: { versionId: 'call' } } }

    // 第一次合并：默认 < requestContext
    const step1 = mergeVersionOverrides(mastraDefaults, fromRequestContext)
    // 第二次合并：上一步 < 调用点
    const final = mergeVersionOverrides(step1, fromCallSite)

    expect(final?.agents?.researcher).toEqual({ versionId: 'call' }) // 调用点赢
    expect(final?.defaultStatus).toBe('published') // 默认值存活
  })

  it('合并结果写回 MASTRA_VERSIONS_KEY，供子 agent 继承', () => {
    const ctx = new RequestContext()
    const merged = mergeVersionOverrides({ defaultStatus: 'published' }, { agents: { a: { versionId: 'v9' } } })

    ctx.set(MASTRA_VERSIONS_KEY, merged)

    expect((ctx.get(MASTRA_VERSIONS_KEY) as VersionOverrides).agents?.a).toEqual({ versionId: 'v9' })
  })
})

describe('消费端的解析（复刻 agent/agent.ts:4621-4625）', () => {
  // 逐 agent 条目优先，defaultStatus 兜底
  const resolveSelector = (overrides: VersionOverrides | undefined, agentId: string) =>
    overrides?.agents?.[agentId] ?? (overrides?.defaultStatus ? { status: overrides.defaultStatus } : undefined)

  it('有逐 agent 条目 → 用它', () => {
    const o: VersionOverrides = { agents: { a: { versionId: 'v1' } }, defaultStatus: 'draft' }
    expect(resolveSelector(o, 'a')).toEqual({ versionId: 'v1' })
  })

  it('没有逐 agent 条目 → 回退 defaultStatus', () => {
    const o: VersionOverrides = { agents: {}, defaultStatus: 'draft' }
    expect(resolveSelector(o, 'unknown')).toEqual({ status: 'draft' })
  })

  it('都没有 → undefined（用 agent 自己的默认版本）', () => {
    expect(resolveSelector({ agents: {} }, 'x')).toBeUndefined()
    expect(resolveSelector(undefined, 'x')).toBeUndefined()
  })
})
