import { describe, expect, it } from 'vitest'
import { RequestContext } from '../../../../packages/_internal-core/src/request-context'

/**
 * 01 · RequestContext 基础 API
 *
 * 源码：packages/_internal-core/src/request-context/index.ts
 *
 * 为什么这个文件有价值：仓库原生测试（packages/core/src/request-context/index.test.ts，298 行）
 * 有 ~80% 在测序列化边界，set/get/has/delete/clear/keys/values/entries/size/forEach/all
 * 这些日常 API 反而没有任何专门的运行时测试。本文件补的就是这个真空。
 */

describe('构造函数：双模式（index.ts:125-135）', () => {
  // 断点：index.ts:130 的 if 判别。观察 iterable 走了哪个分支。
  it('模式一：从 tuple 数组构造（Map 的标准入参）', () => {
    const ctx = new RequestContext([
      ['a', 1],
      ['b', 2],
    ])

    expect(ctx.get('a')).toBe(1)
    expect(ctx.get('b')).toBe(2)
  })

  // 断点：index.ts:131 的 Object.entries 分支。
  // 这个分支专为「从 JSON 反序列化回来的普通对象」而生 —— 见 03-tojson 那一课。
  it('模式二：从 plain object 构造（JSON round-trip 回来的形状）', () => {
    const ctx = new RequestContext({ a: 1, b: 2 })

    expect(ctx.get('a')).toBe(1)
    expect(ctx.get('b')).toBe(2)
  })

  // 判别依据是「有没有 Symbol.iterator」，不是 Array.isArray
  it('判别依据是 Symbol.iterator 的有无，不是数组判定', () => {
    const fromMap = new RequestContext(new Map([['k', 'v']]))
    expect(fromMap.get('k')).toBe('v')
  })

  it('不传参也能构造出空容器', () => {
    const ctx = new RequestContext()
    expect(ctx.size()).toBe(0)
  })
})

describe('核心读写 API', () => {
  it('set / get / has / delete 的基本语义', () => {
    const ctx = new RequestContext()

    expect(ctx.has('k')).toBe(false)
    ctx.set('k', 'v')
    expect(ctx.has('k')).toBe(true)
    expect(ctx.get('k')).toBe('v')

    // delete 返回 boolean，表示「原来存在吗」
    expect(ctx.delete('k')).toBe(true)
    expect(ctx.delete('k')).toBe(false)
    expect(ctx.has('k')).toBe(false)
  })

  // ⚠️ 坑 1：set 返回 void，不是 this —— 不能链式调用
  it('⚠️ set() 返回 void，不可链式（index.ts:140-146）', () => {
    const ctx = new RequestContext()
    const returned = ctx.set('a', 1)

    expect(returned).toBeUndefined()
    // 所以 ctx.set('a', 1).set('b', 2) 会直接抛 TypeError
  })

  // ⚠️ 坑 2：size 是方法不是 getter —— 与 Map.size 的直觉相反
  it('⚠️ size() 是方法不是 getter（index.ts:210，对比 Map.size）', () => {
    const ctx = new RequestContext()
    ctx.set('a', 1)
    ctx.set('b', 2)

    expect(ctx.size()).toBe(2)
    // 写成 ctx.size 会拿到函数本身，恒为 truthy —— 一个安静的 bug
    expect(typeof ctx.size).toBe('function')
  })

  it('get 不存在的 key 返回 undefined，不抛错', () => {
    const ctx = new RequestContext()
    expect(ctx.get('nope')).toBeUndefined()
  })

  it('clear() 清空全部（index.ts:175）', () => {
    const ctx = new RequestContext([
      ['a', 1],
      ['b', 2],
    ])
    ctx.clear()
    expect(ctx.size()).toBe(0)
  })
})

describe('遍历 API', () => {
  // 断点：index.ts:182/189/199。这三个都是直接透传底层 Map 的迭代器。
  it('keys / values / entries 返回迭代器（不是数组）', () => {
    const ctx = new RequestContext([
      ['a', 1],
      ['b', 2],
    ])

    // 是迭代器，要 spread 成数组才能断言
    expect([...ctx.keys()]).toEqual(['a', 'b'])
    expect([...ctx.values()]).toEqual([1, 2])
    expect([...ctx.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('迭代顺序 = Map 的插入顺序', () => {
    const ctx = new RequestContext()
    ctx.set('z', 1)
    ctx.set('a', 2)
    ctx.set('m', 3)

    // 不排序，按插入序
    expect([...ctx.keys()]).toEqual(['z', 'a', 'm'])
  })

  // 断点：index.ts:218-226。注意第三个参数直接漏出了底层的原始 Map。
  it('forEach 的回调第三参会漏出底层原始 Map（index.ts:222）', () => {
    const ctx = new RequestContext([['a', 1]])
    let leakedMap: unknown

    ctx.forEach((_value, _key, map) => {
      leakedMap = map
    })

    // 封装泄漏：拿到的就是内部那个 registry
    expect(leakedMap).toBeInstanceOf(Map)
  })
})

describe('all getter（index.ts:332）', () => {
  // 断点：index.ts:333 的 Object.fromEntries。这是唯一的 getter，其余都是方法。
  it('all 是 getter（不是方法），用于解构', () => {
    const ctx = new RequestContext<{ userId: string; apiKey: string }>()
    ctx.set('userId', 'user-123')
    ctx.set('apiKey', 'key-456')

    // 注意没有括号 —— 这是 getter
    const { userId, apiKey } = ctx.all

    expect(userId).toBe('user-123')
    expect(apiKey).toBe('key-456')
  })

  it('all 每次都新建对象，改它不会回写进 context', () => {
    const ctx = new RequestContext()
    ctx.set('a', 1)

    const snapshot = ctx.all
    snapshot.a = 999

    // 顶层 key 是隔离的
    expect(ctx.get('a')).toBe(1)
  })

  // 但只有顶层隔离 —— Object.fromEntries 是浅拷贝。这条与 02-fork 那一课同源。
  it('⚠️ all 只是浅拷贝：改存储对象的内部仍会串味', () => {
    const shared = { count: 0 }
    const ctx = new RequestContext()
    ctx.set('obj', shared)

    ;(ctx.all.obj as { count: number }).count = 42

    // 同一个引用，改内部就是改本体
    expect((ctx.get('obj') as { count: number }).count).toBe(42)
  })
})

describe('可变性：这是个共享的可变容器', () => {
  // 索引里那个「是可变的还是不可变的？」的 TODO —— 答案就在这
  it('没有 fork()，也没有 clone()（这是 02 那一课的起点）', () => {
    const ctx = new RequestContext() as unknown as Record<string, unknown>

    expect(ctx.fork).toBeUndefined()
    expect(ctx.clone).toBeUndefined()
  })

  // 断点：任意 set 处。观察同一个实例被多方持有时的相互影响。
  it('传给别人 = 给出可写句柄，对方的修改你立刻看得到', () => {
    const ctx = new RequestContext()
    ctx.set('tenantId', 'acme')

    // 模拟把 context 传进某个下游函数
    const downstream = (c: RequestContext) => c.set('tenantId', 'evil-corp')
    downstream(ctx)

    // 被改掉了 —— 没有任何保护
    expect(ctx.get('tenantId')).toBe('evil-corp')
  })
})
