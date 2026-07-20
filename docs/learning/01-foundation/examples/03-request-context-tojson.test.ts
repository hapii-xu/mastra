import { describe, expect, it } from 'vitest'
import { RequestContext } from '../../../../packages/_internal-core/src/request-context'

/**
 * 03 · ⭐ toJSON 的静默过滤规则，以及那个 100% CPU 挂死的 bug
 *
 * 源码：packages/_internal-core/src/request-context/index.ts:243-289
 *
 * 这是全框架最重要的一个约束：evented workflow 引擎会把 requestContext 做 JSON round-trip，
 * 而 toJSON() 会「静默」丢掉不可序列化的值。理解这里，才能理解：
 *   - 为什么 direct 是默认引擎（06-agent）
 *   - 为什么 loop 要发明 runScope 来传 class 实例和闭包（07-loop）
 */

describe('isSerializable 的过滤规则（index.ts:274-289）', () => {
  // 断点：index.ts:254 的 if (this.isSerializable(value))。
  // 逐个 key F5，观察每个值走进 isSerializable 的哪个分支。
  it('null / undefined：保留（index.ts:275）', () => {
    const ctx = new RequestContext()
    ctx.set('nullValue', null)
    ctx.set('undefinedValue', undefined)

    const json = ctx.toJSON()

    expect('nullValue' in json).toBe(true)
    expect('undefinedValue' in json).toBe(true)
    expect(json.nullValue).toBeNull()
  })

  it('⚠️ 函数：静默丢弃（index.ts:276）', () => {
    const ctx = new RequestContext()
    ctx.set('callback', () => 'never survives')
    ctx.set('kept', 'ok')

    const json = ctx.toJSON()

    // 没有报错、没有警告，就这么没了
    expect(json).toEqual({ kept: 'ok' })
    expect('callback' in json).toBe(false)
  })

  it('⚠️ symbol：静默丢弃（index.ts:277）', () => {
    const ctx = new RequestContext()
    ctx.set('sym', Symbol('x'))
    ctx.set('kept', 'ok')

    expect(ctx.toJSON()).toEqual({ kept: 'ok' })
  })

  it('原始值（string/number/boolean）：保留（index.ts:278）', () => {
    const ctx = new RequestContext()
    ctx.set('s', 'str')
    ctx.set('n', 42)
    ctx.set('b', true)

    expect(ctx.toJSON()).toEqual({ s: 'str', n: 42, b: true })
  })

  it('⚠️ 循环引用对象：静默丢弃（index.ts:280-288 的 try/catch）', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular

    const ctx = new RequestContext()
    ctx.set('circular', circular)
    ctx.set('kept', 'ok')

    expect(ctx.toJSON()).toEqual({ kept: 'ok' })
  })

  it('普通嵌套对象/数组：保留', () => {
    const ctx = new RequestContext()
    ctx.set('nested', { a: { b: [1, 2, 3] } })

    expect(ctx.toJSON()).toEqual({ nested: { a: { b: [1, 2, 3] } } })
  })
})

describe('⚠️ toJSON 是按引用拷贝，不做深拷贝', () => {
  // 这点很容易误解：toJSON 返回的不是一份安全快照
  // 断点：index.ts:255 的 result[key] = value。观察这里是直接赋引用。
  it('toJSON() 返回的对象与原值共享引用', () => {
    const live = { count: 0 }
    const ctx = new RequestContext()
    ctx.set('live', live)

    const json = ctx.toJSON()
    ;(json.live as { count: number }).count = 99

    // 改 json 就是改原对象
    expect(live.count).toBe(99)
  })

  it('对比：durable agent 的 snapshotRequestContextEntries 才是深拷贝', () => {
    // agent/durable/preparation.ts:41-59 逐条 JSON.parse(JSON.stringify(v))
    const live = { count: 0 }
    const deepCloned = JSON.parse(JSON.stringify(live))
    deepCloned.count = 99

    expect(live.count).toBe(0) // 原值安全
  })
})

describe('⭐ 跨 context 循环引用：那个让 CPU 跑满的真实 bug', () => {
  /**
   * 源码注释 index.ts:83-100 完整记录了这个 bug：
   *
   * V8 内置的循环检测是「每次 JSON.stringify 调用」独立的。
   * 若 ctx A 存的值引用 ctx B，B 存的值又引用回 A：
   *   A.toJSON() → isSerializable → JSON.stringify → V8 调 B.toJSON()
   *     → isSerializable → 全新的 JSON.stringify（cycle stack 重置！）→ 回到 A → ...
   * 每一跳都重置了 V8 的检测器，于是永远检测不到环，单核 100% 无限递归。
   *
   * 修复三件套：
   *   _toJSONInProgress: WeakSet   (index.ts:113) 追踪在途实例
   *   _toJSONDepth: number         (index.ts:120) 嵌套深度
   *   CyclicRequestContextToJSONError (index.ts:101) 私有标记类，内层重抛、最外层吞掉
   *
   * 断点：index.ts:244 的 if (_toJSONInProgress.has(this))。
   *      这是检测到重入、抛标记的那一刻 —— 整个机制的核心。
   */

  it('A ↔ B 互相引用：不挂死，且能正常返回（回归守卫）', () => {
    const ctxA = new RequestContext()
    const ctxB = new RequestContext()

    // A 存的值引用 B，B 存的值引用回 A
    ctxA.set('toB', { ref: ctxB })
    ctxB.set('toA', { ref: ctxA })
    ctxA.set('safe', 'kept')

    // 修复前：这一行会跑满一个核心，永不返回
    const json = ctxA.toJSON()

    // 有环的 key 被过滤，安全的 key 保留
    expect(json.safe).toBe('kept')
    expect('toB' in json).toBe(false)
  })

  it('自引用：值直接引用回持有它的 context', () => {
    const ctx = new RequestContext()
    ctx.set('selfRef', { ref: ctx })
    ctx.set('safe', 'kept')

    expect(ctx.toJSON()).toEqual({ safe: 'kept' })
  })

  it('三方环 A → B → C → A：同样不挂死', () => {
    const a = new RequestContext()
    const b = new RequestContext()
    const c = new RequestContext()

    a.set('toB', { ref: b })
    b.set('toC', { ref: c })
    c.set('toA', { ref: a })
    a.set('safe', 'kept')

    expect(a.toJSON()).toEqual({ safe: 'kept' })
  })

  it('JSON.stringify(context) 也能安全收敛（V8 会自动调 toJSON）', () => {
    const ctxA = new RequestContext()
    const ctxB = new RequestContext()
    ctxA.set('toB', { ref: ctxB })
    ctxB.set('toA', { ref: ctxA })
    ctxA.set('safe', 'kept')

    const str = JSON.stringify(ctxA)

    expect(str).toBe('{"safe":"kept"}')
  })

  it('环被清理后，同一个实例仍可正常序列化（finally 复原了状态）', () => {
    // 验证 index.ts:259-262 的 finally 确实清了 WeakSet 和 depth
    const ctx = new RequestContext()
    ctx.set('selfRef', { ref: ctx })
    ctx.toJSON() // 第一次：触发环检测

    ctx.delete('selfRef')
    ctx.set('now', 'clean')

    // 第二次：状态没被上一次污染
    expect(ctx.toJSON()).toEqual({ now: 'clean' })
  })
})

describe('完整 round-trip：evented 引擎的真实遭遇', () => {
  // 这就是 06-agent / 07-loop 里 runScope 存在的全部理由
  // 断点：index.ts:243 toJSON 入口 + index.ts:131 构造函数的 Object.entries 分支
  it('一次 JSON round-trip 之后，函数没了、普通数据活着', () => {
    const original = new RequestContext()
    original.set('tenantId', 'acme')
    original.set('onProgress', () => 'callback') // ← 会消失

    // 模拟 evented 引擎跨进程传递
    const wire = JSON.stringify(original)
    const revived = new RequestContext(JSON.parse(wire))

    expect(revived.get('tenantId')).toBe('acme')
    expect(revived.get('onProgress')).toBeUndefined() // 静默消失

    // 教训：别往 requestContext 里塞回调，多实例部署时它活不过来
  })
})
