import { describe, expect, it } from 'vitest'
import { createTool } from '../../../../packages/core/src/tools'
import { z } from 'zod/v4'

/**
 * 02.1 · ⭐ Tool.execute 的真实调用约定 —— 位置参数，不是解构
 *
 * 源码：packages/core/src/tools/tool.ts:276-468（Tool 构造函数）
 *       :303-305 `this.execute = async (inputData, context) => {...}`
 *       :447 `originalExecute(data, organizedContext)` —— 你写的 execute 被这样调用
 *
 * ⭐⭐⭐ 这是全仓库最容易踩的一个坑，本次写文档时在自己的示例里踩中过：
 *
 *   execute: async ({ context }) => ...   // ❌ 看起来合理，实际是 bug
 *   execute: async (inputData) => ...     // ✅ 正确：第一参是校验后的输入
 *
 * 为什么 `({ context })` 会「看起来能跑」：JS 允许对象解构任何对象的任意字段，
 * 哪怕该字段不存在也只是拿到 undefined，不会报错。inputData 里没有 `context` 字段，
 * 于是 `context` 静默变成 undefined，下游对它取属性再传给 outputSchema 校验，
 * 校验失败会返回 { error: true, message: '...' } 而不是抛异常——非常容易被忽略。
 *
 * 本文件用真实场景复现了这个坑，并给出正确写法。
 */

describe('✅ 正确：execute 的第一参是校验后的输入（位置参数）', () => {
  it('inputData 直接就是入参对象', async () => {
    const echo = createTool({
      id: 'echo',
      description: '回显输入',
      inputSchema: z.object({ msg: z.string() }),
      outputSchema: z.object({ echoed: z.string() }),
      execute: async (inputData: any) => ({ echoed: inputData.msg }),
    })

    const result: any = await (echo as any).execute({ msg: 'hello' })
    expect(result).toEqual({ echoed: 'hello' })
  })

  it('第二参才是执行上下文（mastra/requestContext/suspend 等）', async () => {
    let capturedContext: any
    const t = createTool({
      id: 't',
      description: 'd',
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ n: z.number() }),
      execute: async (inputData: any, context: any) => {
        capturedContext = context
        return { n: inputData.n }
      },
    })
    await (t as any).execute({ n: 1 }, { requestContext: 'fake-context-marker' })
    expect(capturedContext).toEqual({ requestContext: 'fake-context-marker' })
  })
})

describe('⚠️ 错误：{ context } 解构第一参 —— 静默产出错误结果', () => {
  /**
   * 断点：tool.ts:447 `originalExecute(data, organizedContext)`。
   * 打在这里，对比 data（真实输入）和你的 execute 第一参解构出的东西。
   */
  it('{ context } 解构拿到的其实是 inputData.context（通常是 undefined）', async () => {
    let sawContextField: any = 'not-set'
    const buggyCalc = createTool({
      id: 'buggyCalc',
      description: '加法（写错了）',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
      // ❌ inputData 是 { a, b }，没有 context 字段 —— context 解构出 undefined
      execute: async ({ context }: any) => {
        sawContextField = context
        return { sum: context?.a + context?.b } // undefined + undefined = NaN
      },
    })

    const result: any = await (buggyCalc as any).execute({ a: 2, b: 3 })

    expect(sawContextField).toBeUndefined()
    // outputSchema 是 z.object({ sum: z.number() })，NaN 校验失败
    expect(result.error).toBe(true)
    expect(result.message).toContain('sum')
  })

  it('对比：正确写法算出真实结果', async () => {
    const fixedCalc = createTool({
      id: 'fixedCalc',
      description: '加法（写对了）',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
      execute: async (inputData: any) => ({ sum: inputData.a + inputData.b }),
    })
    const result = await (fixedCalc as any).execute({ a: 2, b: 3 })
    expect(result).toEqual({ sum: 5 }) // 不是 NaN
  })

  /**
   * ⭐ 最危险的场景：如果 outputSchema 里恰好有个字段名能装下 undefined 或
   * NaN 逃过校验（比如字段是 z.any() 或校验宽松），这个 bug 会完全不报错，
   * 静默产出错误数据流进下游（agent 的最终回答、下游 workflow step）。
   * 这就是为什么"跑起来不报错"不等于"写对了"——务必对照本文件的写法检查。
   */
  it('⚠️ 宽松 schema 下，bug 完全不会被发现', async () => {
    const silentlyWrong = createTool({
      id: 'silent',
      description: 'd',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.any(), // 宽松 schema —— 校验形同虚设
      execute: async ({ context }: any) => ({ sum: context?.a + context?.b }),
    })
    const result = await (silentlyWrong as any).execute({ a: 2, b: 3 })
    // 没有报错、没有警告 —— 但 sum 是 NaN，是错的
    expect(Number.isNaN((result as any).sum)).toBe(true)
  })
})

describe('resume 时跳过输入校验', () => {
  // tool.ts:306-320：resumeData 存在时，跳过 inputSchema 校验
  // 因为原始参数已经在首次执行时验证过了，resume 时 execute 只看 resumeData
  it('context.resumeData 存在时，inputData 不会被重新校验', async () => {
    const t = createTool({
      id: 'hitl',
      description: 'd',
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (inputData: any, context: any) => {
        if (context?.resumeData) return { ok: true }
        return { ok: false }
      },
    })
    // 故意传一个不符合 inputSchema 的 inputData（缺 n），配合 resumeData
    const result = await (t as any).execute({} as any, { resumeData: { approved: true } })
    // 没有因为 inputData 校验失败而报错，说明校验被跳过了
    expect(result).toEqual({ ok: true })
  })
})
