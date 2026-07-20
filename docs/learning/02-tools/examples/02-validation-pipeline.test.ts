import { describe, expect, it } from 'vitest'
import { createTool } from '../../../../packages/core/src/tools'
import { z } from 'zod/v4'

/**
 * 02.2 · ⭐ 校验管道 —— 为真实 LLM 怪癖设计的自愈机制
 *
 * 源码：packages/core/src/tools/validation.ts:450-570（validateToolInput）
 *
 * 模型返回的参数经常不严格符合 schema——不是因为模型笨，而是不同厂商对
 * JSON Schema 的实现有细微差异。Mastra 用一条 6 步管道尝试修复，每一步
 * 都关联一个真实的 GitHub issue：
 *
 *   1. normalizeNullishInput      全参数可选时模型传 undefined 而不是 {}
 *   2. convertUndefinedToNull     OpenAI strict mode 兼容（#11457）
 *   3. 首次校验（保留 null）
 *   4. coerceStringifiedJsonValues  GLM4.7 把数组/对象传成字符串（#12757）
 *   5. 剥离导致失败的 null 字段     Gemini 对 optional 字段传 null 而非 undefined（#12362）
 *   6. prompt 别名归一化           子 agent 多轮后把 prompt 写成 query/message/input（#14154）
 *
 * 全部失败才返回 ValidationError（{error:true, message, validationErrors}）。
 */

describe('步骤 1：全 optional 参数时，undefined 被当作 {}', () => {
  it('模型传 undefined（而非 {}）依然能通过校验', async () => {
    const t = createTool({
      id: 't',
      description: 'd',
      inputSchema: z.object({ verbose: z.boolean().optional() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (inputData: any) => ({ ok: inputData.verbose ?? false }),
    })
    const result = await (t as any).execute(undefined)
    expect(result).toEqual({ ok: false }) // 没有因为 undefined 报错
  })
})

describe('步骤 4：⭐ 字符串化的 JSON 数组/对象会被自动转换', () => {
  // 关联 GitHub #12757：GLM4.7 等模型把数组参数传成字符串
  it('数组参数传成 JSON 字符串，仍能校验通过', async () => {
    const t = createTool({
      id: 'files',
      description: 'd',
      inputSchema: z.object({ paths: z.array(z.string()) }),
      outputSchema: z.object({ count: z.number() }),
      execute: async (inputData: any) => ({ count: inputData.paths.length }),
    })
    // 模拟模型把数组传成了字符串 '["a.ts","b.ts"]'
    const result = await (t as any).execute({ paths: '["a.ts","b.ts"]' } as any)
    expect(result).toEqual({ count: 2 }) // 自动解析成了真数组
  })
})

describe('步骤 5：⭐ optional 字段收到 null（而非 undefined）会被剥离', () => {
  // 关联 GitHub #12362：Gemini 对 .optional() 字段传 null
  it('null 值在 optional 字段上被当作缺失处理', async () => {
    const t = createTool({
      id: 'search',
      description: 'd',
      inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (inputData: any) => ({ ok: inputData.query === 'test' }),
    })
    // limit 传了 null 而不是省略 —— Zod .optional() 只认 undefined，不认 null
    const result = await (t as any).execute({ query: 'test', limit: null } as any)
    expect(result).toEqual({ ok: true }) // 校验管道剥离了这个 null，没有报错
  })

  it('⚠️ 但 .nullable() 字段的合法 null 不会被误剥离', async () => {
    const t = createTool({
      id: 'nullable-test',
      description: 'd',
      inputSchema: z.object({ tag: z.string().nullable() }), // 显式允许 null
      outputSchema: z.object({ receivedNull: z.boolean() }),
      execute: async (inputData: any) => ({ receivedNull: inputData.tag === null }),
    })
    const result = await (t as any).execute({ tag: null } as any)
    // .nullable() 字段的 null 是合法值，应该被保留、原样传入
    expect(result).toEqual({ receivedNull: true })
  })
})

describe('全部尝试失败 → 返回结构化 ValidationError', () => {
  it('真正无法修复的输入返回 { error: true, message, validationErrors }', async () => {
    const t = createTool({
      id: 'strict',
      description: 'd',
      inputSchema: z.object({ count: z.number() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    // count 传了一个无法转换成数字的字符串
    const result: any = await (t as any).execute({ count: 'not-a-number' } as any)
    expect(result.error).toBe(true)
    expect(result.message).toContain('strict') // message 里带 toolId
    expect(result.message).toContain('count') // 指出了具体字段
  })
})

describe('outputSchema 校验同样存在（tool.ts:459 validateToolOutput）', () => {
  it('execute 返回值不符合 outputSchema 时也会拦截', async () => {
    const t = createTool({
      id: 'badOutput',
      description: 'd',
      inputSchema: z.object({}),
      outputSchema: z.object({ count: z.number() }),
      execute: async () => ({ count: 'not-a-number' as any }), // 故意返回错误类型
    })
    const result: any = await (t as any).execute({})
    expect(result.error).toBe(true)
  })
})
