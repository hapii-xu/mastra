import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { z } from 'zod/v4'
import { mockModel } from './mock-model'

/**
 * 06.3 · 结构化输出（structuredOutput）
 *
 * 源码：agent.ts generate/stream 的 structuredOutput 选项
 *       配合 stream/base/output-format-handlers.ts 解析（见 04-stream）
 *
 * 让 agent 返回符合 schema 的对象，而不是自由文本。
 * 企业级常用：抽取、分类、表单填充。
 *
 * ⚠️ mock 模型要返回符合 schema 的 JSON 文本才能解析成功。
 */

describe('structuredOutput：让 agent 返回结构化对象', () => {
  it('配 schema → output.object 是解析后的对象', async () => {
    const schema = z.object({
      sentiment: z.enum(['positive', 'negative', 'neutral']),
      score: z.number(),
    })

    const agent = new Agent({
      name: 'structured',
      instructions: '分析情感，返回 JSON',
      model: mockModel([{ kind: 'text', text: '{"sentiment":"positive","score":0.9}' }]) as any,
    })

    const out = await (await agent.stream('今天天气真好', { structuredOutput: { schema } } as any)).getFullOutput()

    // text 是原始文本，object 是解析后的结构化结果
    expect(out.object).toMatchObject({ sentiment: 'positive', score: 0.9 })
  }, 15000)

  it('不配 structuredOutput → object 为 undefined（只有 text）', async () => {
    const agent = new Agent({
      name: 'plain',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: '自由文本' }]) as any,
    })
    const out = await (await agent.stream('hi')).getFullOutput()
    expect(out.text).toBe('自由文本')
    expect(out.object).toBeUndefined()
  }, 15000)
})

describe('用法：信息抽取', () => {
  it('从文本抽取结构化字段', async () => {
    const schema = z.object({
      personName: z.string(),
      age: z.number().nullable(),
      email: z.string().nullable(),
    })
    const agent = new Agent({
      name: 'extract',
      instructions: '抽取人物信息',
      model: mockModel([{ kind: 'text', text: '{"personName":"张三","age":30,"email":null}' }]) as any,
    })
    const out = await (await agent.stream('张三 30 岁', { structuredOutput: { schema } } as any)).getFullOutput()
    expect(out.object).toMatchObject({ personName: '张三', age: 30, email: null })
  }, 15000)
})
