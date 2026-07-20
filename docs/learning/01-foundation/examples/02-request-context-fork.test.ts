import { describe, expect, it } from 'vitest'
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '../../../../packages/_internal-core/src/request-context'

/**
 * 02 · ⭐ 本模块最好的一课：fork() 不存在
 *
 * RequestContext 可变、共享、没有 fork()/clone()。
 * 这一个缺失，在主干代码里长出了两种应对，优劣鲜明 —— 而且直接连到 06-agent 的子 agent 委派。
 *
 * 做法 A（干净）：packages/memory/src/processors/observational-memory/internal-request-context.ts:19
 * 做法 B（脏）  ：packages/core/src/agent/agent.ts:4608-4615（且要在 5 个 return 分支各恢复一次）
 */

describe('做法 A：手搓 fork —— new RequestContext(parent.entries())', () => {
  // 这就是 memory/.../internal-request-context.ts:19 的原样 idiom
  // 断点：index.ts:125 构造函数。观察 entries() 迭代器怎么变成新的 registry。
  it('复刻 observational-memory 的 fork：隔离 threadId 避免子 agent 写进父 thread', () => {
    const parent = new RequestContext()
    parent.set(MASTRA_THREAD_ID_KEY, 'thread-parent')
    parent.set('tenantId', 'acme')

    // ↓ 全仓库反复出现的手搓 fork
    const forked = new RequestContext(parent.entries())
    forked.set(MASTRA_THREAD_ID_KEY, `thread-parent-om-agent`)

    // 子上下文改了 threadId，父的不受影响
    expect(forked.get(MASTRA_THREAD_ID_KEY)).toBe('thread-parent-om-agent')
    expect(parent.get(MASTRA_THREAD_ID_KEY)).toBe('thread-parent')

    // 其余键照常继承
    expect(forked.get('tenantId')).toBe('acme')
  })

  it('fork 后新增 key 不会回流到父上下文', () => {
    const parent = new RequestContext([['a', 1]])
    const forked = new RequestContext(parent.entries())

    forked.set('onlyInChild', true)

    expect(parent.has('onlyInChild')).toBe(false)
  })

  it('同款 idiom 也写作 new RequestContext(Object.entries(ctx))（evented 引擎的写法）', () => {
    // workflows/evented/workflow-event-processor/loop.ts:44 等处的形状
    const parent = new RequestContext([['a', 1]])
    const asPlainObject = Object.fromEntries(parent.entries())
    const rebuilt = new RequestContext(Object.entries(asPlainObject))

    expect(rebuilt.get('a')).toBe(1)
  })
})

describe('⚠️ 但 fork 是浅拷贝 —— 这是最容易翻车的地方', () => {
  // 断点：index.ts:133 的 new Map(iterable)。
  // 观察：Map 复制的是 entry，value 是同一个引用。
  it('顶层 key 重绑定：隔离 ✅', () => {
    const parent = new RequestContext()
    parent.set('scalar', 'parent-value')

    const forked = new RequestContext(parent.entries())
    forked.set('scalar', 'child-value')

    expect(parent.get('scalar')).toBe('parent-value') // 没被污染
  })

  it('⚠️ 存储对象的内部字段：串味 ❌ —— fork 挡不住', () => {
    const sharedConfig = { retries: 3 }
    const parent = new RequestContext()
    parent.set('config', sharedConfig)

    const forked = new RequestContext(parent.entries())

    // 子上下文改的是对象内部，不是重绑定 key
    ;(forked.get('config') as { retries: number }).retries = 99

    // 父上下文也被改了 —— 同一个引用
    expect((parent.get('config') as { retries: number }).retries).toBe(99)
    expect(parent.get('config')).toBe(sharedConfig)
  })

  it('结论：fork 只隔离「顶层 key 重绑定」，不隔离「值内部的变更」', () => {
    const parent = new RequestContext()
    parent.set('obj', { n: 1 })
    parent.set('str', 'a')

    const forked = new RequestContext(parent.entries())
    forked.set('str', 'b') // 重绑定 → 隔离
    ;(forked.get('obj') as { n: number }).n = 2 // 改内部 → 串味

    expect(parent.get('str')).toBe('a')
    expect((parent.get('obj') as { n: number }).n).toBe(2)
  })
})

describe('做法 B：agent.ts 的 save → delete → restore 舞蹈', () => {
  /**
   * 复刻 packages/core/src/agent/agent.ts:4608-4615。
   * 源码注释（4604-4607）解释了为什么必须清掉保留键：
   *   "These keys take precedence over the memory option in generate/stream,
   *    so leaving them would cause the sub-agent to write to the parent's thread
   *    instead of its own."
   *
   * 断点：agent.ts:4608。观察 savedThreadIdKey / savedResourceIdKey 被存到哪、何时恢复。
   */
  const delegateToSubAgent = (requestContext: RequestContext, subAgentWork: () => void) => {
    // ① save
    const savedThreadIdKey = requestContext.get(MASTRA_THREAD_ID_KEY) as string | undefined
    const savedResourceIdKey = requestContext.get(MASTRA_RESOURCE_ID_KEY) as string | undefined

    // ② delete
    if (savedThreadIdKey !== undefined) requestContext.delete(MASTRA_THREAD_ID_KEY)
    if (savedResourceIdKey !== undefined) requestContext.delete(MASTRA_RESOURCE_ID_KEY)

    try {
      subAgentWork()
    } finally {
      // ③ restore —— 真实源码里这段要在 5 个 return 分支各写一遍
      if (savedThreadIdKey !== undefined) requestContext.set(MASTRA_THREAD_ID_KEY, savedThreadIdKey)
      if (savedResourceIdKey !== undefined) requestContext.set(MASTRA_RESOURCE_ID_KEY, savedResourceIdKey)
    }
  }

  it('子 agent 执行期间，保留键确实被清空了', () => {
    const ctx = new RequestContext()
    ctx.set(MASTRA_THREAD_ID_KEY, 'parent-thread')
    let seenBySubAgent: unknown = 'not-run'

    delegateToSubAgent(ctx, () => {
      seenBySubAgent = ctx.get(MASTRA_THREAD_ID_KEY)
    })

    // 子 agent 看不到父的 threadId → 不会写进父的 thread
    expect(seenBySubAgent).toBeUndefined()
  })

  it('子 agent 结束后，保留键被还原', () => {
    const ctx = new RequestContext()
    ctx.set(MASTRA_THREAD_ID_KEY, 'parent-thread')
    ctx.set(MASTRA_RESOURCE_ID_KEY, 'user-42')

    delegateToSubAgent(ctx, () => {})

    expect(ctx.get(MASTRA_THREAD_ID_KEY)).toBe('parent-thread')
    expect(ctx.get(MASTRA_RESOURCE_ID_KEY)).toBe('user-42')
  })

  // 这个用例演示做法 B 的脆弱性：漏掉一个恢复分支就会静默污染
  it('⚠️ 漏掉恢复分支的后果：父上下文被永久污染', () => {
    const ctx = new RequestContext()
    ctx.set(MASTRA_THREAD_ID_KEY, 'parent-thread')

    // 模拟一个「忘了在 return 前恢复」的分支
    const buggyDelegate = (requestContext: RequestContext) => {
      const saved = requestContext.get(MASTRA_THREAD_ID_KEY)
      requestContext.delete(MASTRA_THREAD_ID_KEY)
      if (saved) return 'early-return-忘了恢复'
      requestContext.set(MASTRA_THREAD_ID_KEY, saved as string)
      return 'ok'
    }

    buggyDelegate(ctx)

    // 父上下文的 threadId 没了 —— 后续所有记忆写入都会跑偏
    expect(ctx.has(MASTRA_THREAD_ID_KEY)).toBe(false)
  })

  it('对比：做法 A 天然不需要恢复，因为压根没碰父上下文', () => {
    const parent = new RequestContext()
    parent.set(MASTRA_THREAD_ID_KEY, 'parent-thread')

    // fork 一份给子 agent 用，父的自始至终没动过
    const forked = new RequestContext(parent.entries())
    forked.delete(MASTRA_THREAD_ID_KEY)

    expect(parent.get(MASTRA_THREAD_ID_KEY)).toBe('parent-thread')
    // 没有 try/finally，没有 5 处恢复，没有漏掉分支的风险
  })
})
