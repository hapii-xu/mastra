import { describe, expect, it } from 'vitest'
import {
  MASTRA_AUTH_TOKEN_KEY,
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  MASTRA_VERSIONS_KEY,
  RequestContext,
} from '../../../../packages/_internal-core/src/request-context'

/**
 * 04 · ⭐ 安全：serializeForSpan 脱敏 + 4 个保留键的优先级
 *
 * 源码：packages/_internal-core/src/request-context/index.ts:17-51, 300-318
 *
 * 企业级最该先读的一节。两个主题：
 *   1. 为什么有了 toJSON 还要 serializeForSpan（两套威胁模型）
 *   2. 保留键的「中间件优先于客户端」是怎么防住越权的
 */

describe('4 个保留键（index.ts:17-51）', () => {
  it('全部是 mastra__ 双下划线前缀的字符串常量', () => {
    expect(MASTRA_RESOURCE_ID_KEY).toBe('mastra__resourceId')
    expect(MASTRA_THREAD_ID_KEY).toBe('mastra__threadId')
    expect(MASTRA_VERSIONS_KEY).toBe('mastra__versions')
    expect(MASTRA_AUTH_TOKEN_KEY).toBe('mastra__authToken')
  })

  /**
   * MASTRA_RESOURCE_ID_KEY 的源码注释（index.ts:7-8）原文：
   *   "When set in RequestContext, this takes precedence over client-provided values
   *    for security (prevents attackers from hijacking another user's memory)."
   *
   * 落地实现是 packages/server/src/server/handlers/utils.ts:73-90 的一行：
   *   contextResourceId || clientResourceId
   *
   * 断点：handlers/utils.ts:77 getEffectiveResourceId。观察两个来源谁赢。
   */
  it('⭐ 越权防护：中间件设的值恒赢客户端传的值', () => {
    // 复刻 getEffectiveResourceId 的语义
    const getEffectiveResourceId = (ctx: RequestContext, clientProvided?: string) =>
      (ctx.get(MASTRA_RESOURCE_ID_KEY) as string | undefined) || clientProvided

    const ctx = new RequestContext()
    // 认证中间件写入真实用户（server/auth/helpers.ts:473 是唯一的生产写入点）
    ctx.set(MASTRA_RESOURCE_ID_KEY, 'user-alice')

    // 攻击者在请求体里伪造 resourceId，想读 bob 的记忆
    const effective = getEffectiveResourceId(ctx, 'user-bob')

    expect(effective).toBe('user-alice') // 攻击失败
  })

  it('中间件没设时，才回退到客户端值', () => {
    const getEffectiveResourceId = (ctx: RequestContext, clientProvided?: string) =>
      (ctx.get(MASTRA_RESOURCE_ID_KEY) as string | undefined) || clientProvided

    const ctx = new RequestContext() // 中间件没写
    expect(getEffectiveResourceId(ctx, 'user-bob')).toBe('user-bob')

    // ⚠️ 推论：不配认证中间件 = 客户端可以随便声称自己是谁
  })
})

describe('⭐ serializeForSpan：把 token 挡在可观测性之外（index.ts:300-318）', () => {
  /**
   * 源码注释（index.ts:291-299）解释了威胁：
   *   @mastra/observability 的 deepClean 会先调 serializeForSpan()，
   *   否则就会 fallback 到 Object.keys() 遍历 registry 字段
   *   —— 把 bearer token 原样序列化进导出的 span。
   *
   * 注意 registry 是 TypeScript 的 private（index.ts:123），运行时可枚举，挡不住 Object.keys。
   * 断点：index.ts:303 的 if (key === MASTRA_AUTH_TOKEN_KEY)。
   */
  it('auth token 被替换成 [REDACTED]', () => {
    const ctx = new RequestContext()
    ctx.set(MASTRA_AUTH_TOKEN_KEY, 'Bearer super-secret-token-xyz')

    const forSpan = ctx.serializeForSpan()

    expect(forSpan[MASTRA_AUTH_TOKEN_KEY]).toBe('[REDACTED]')
    expect(JSON.stringify(forSpan)).not.toContain('super-secret-token-xyz')
  })

  it('原始值（string/number/boolean/null/undefined）原样通过', () => {
    const ctx = new RequestContext()
    ctx.set('s', 'str')
    ctx.set('n', 42)
    ctx.set('b', true)
    ctx.set('nul', null)
    ctx.set('und', undefined)

    expect(ctx.serializeForSpan()).toEqual({
      s: 'str',
      n: 42,
      b: true,
      nul: null,
      und: undefined,
    })
  })

  it('⭐ 非原始值一律变成 [typeof] 占位符（index.ts:314）', () => {
    const ctx = new RequestContext()
    ctx.set('obj', { secret: 'nested-token' })
    ctx.set('arr', [1, 2, 3])
    ctx.set('fn', () => 'x')

    const forSpan = ctx.serializeForSpan()

    // 对象/数组不展开 —— 里面藏什么都出不去
    expect(forSpan.obj).toBe('[object]')
    expect(forSpan.arr).toBe('[object]')
    expect(forSpan.fn).toBe('[function]')
    expect(JSON.stringify(forSpan)).not.toContain('nested-token')
  })
})

describe('⭐ 三种序列化，三套威胁模型（并排对比）', () => {
  /**
   * | 方法                          | 策略   | 拷贝语义 |
   * | toJSON()                     | 黑名单 | 按引用   |
   * | serializeForSpan()           | 白名单 | 值替换   |
   * | snapshotRequestContextEntries| 逐条试 | 深拷贝   |
   */
  it('toJSON 是黑名单：能 stringify 就放行 —— 嵌套的密钥会漏出去', () => {
    const ctx = new RequestContext()
    ctx.set('config', { apiKey: 'sk-leaked-in-json' })

    const json = ctx.toJSON()

    // 对象能 stringify → 整个放行 → 里面的密钥也跟着出去了
    expect(JSON.stringify(json)).toContain('sk-leaked-in-json')
  })

  it('serializeForSpan 是白名单：只有原始值能出去 —— 同一份数据被挡住', () => {
    const ctx = new RequestContext()
    ctx.set('config', { apiKey: 'sk-leaked-in-json' })

    const forSpan = ctx.serializeForSpan()

    expect(JSON.stringify(forSpan)).not.toContain('sk-leaked-in-json')
    expect(forSpan.config).toBe('[object]')
  })

  it('同一个 context，两个方法的产物截然不同（这就是设计意图）', () => {
    const ctx = new RequestContext()
    ctx.set('tenantId', 'acme')
    ctx.set(MASTRA_AUTH_TOKEN_KEY, 'Bearer secret')
    ctx.set('meta', { nested: true })

    // 给存储用：结构完整
    expect(ctx.toJSON()).toEqual({
      tenantId: 'acme',
      [MASTRA_AUTH_TOKEN_KEY]: 'Bearer secret', // ⚠️ token 原样保留！
      meta: { nested: true },
    })

    // 给 span 用：脱敏 + 压平
    expect(ctx.serializeForSpan()).toEqual({
      tenantId: 'acme',
      [MASTRA_AUTH_TOKEN_KEY]: '[REDACTED]',
      meta: '[object]',
    })
  })

  it('⚠️ 关键推论：toJSON 不脱敏，所以别拿它往日志/追踪里写', () => {
    const ctx = new RequestContext()
    ctx.set(MASTRA_AUTH_TOKEN_KEY, 'Bearer leak-me')

    // toJSON 保留 token（因为它的用途是持久化，不是可观测性）
    expect(ctx.toJSON()[MASTRA_AUTH_TOKEN_KEY]).toBe('Bearer leak-me')
    // 要往 span 里写，必须走 serializeForSpan
    expect(ctx.serializeForSpan()[MASTRA_AUTH_TOKEN_KEY]).toBe('[REDACTED]')
  })
})

describe('MASTRA_AUTH_TOKEN_KEY 的奇特身世', () => {
  // 好问题：一个从不被 .get() 读取的 key，为什么还要有个常量？
  // 答案：它是「只写 + 只用于脱敏比对」的键。
  //   唯一写入点：packages/server/src/server/auth/helpers.ts:466
  //   唯一引用点：request-context/index.ts:303（就是为了脱敏）
  it('它存在的意义就是让 serializeForSpan 能认出它并打码', () => {
    const ctx = new RequestContext()
    ctx.set(MASTRA_AUTH_TOKEN_KEY, 'Bearer x')

    // 常量的价值不在读取，而在「让脱敏逻辑有一个稳定的比对目标」
    expect(ctx.serializeForSpan()[MASTRA_AUTH_TOKEN_KEY]).toBe('[REDACTED]')
  })

  it('⚠️ 换个 key 名就绕过了脱敏 —— 别自己造 token 键', () => {
    const ctx = new RequestContext()
    ctx.set('myAuthToken', 'Bearer not-protected') // 自定义键名

    // 是字符串 → 白名单放行 → 原样进 span
    expect(ctx.serializeForSpan().myAuthToken).toBe('Bearer not-protected')
  })
})
