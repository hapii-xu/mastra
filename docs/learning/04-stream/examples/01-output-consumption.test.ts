import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { mockModel } from './mock-model'

/**
 * 04.1 · MastraModelOutput 的两种消费方式：等待 vs 流式
 *
 * 源码：packages/core/src/stream/base/output.ts（1858 行）
 *       getFullOutput :1425；textStream :1565；fullStream :1264
 *
 * agent.stream() 返回 MastraModelOutput——一个「双面对象」：
 * 既能当流消费（逐 chunk 拿），也能 await 拿最终结果。
 */

describe('方式一：await getFullOutput() —— 拿完整结果', () => {
  it('等待流跑完，一次性拿到所有字段', async () => {
    const agent = new Agent({
      name: 'p',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'hello world' }]) as any,
    })
    const output = await (await agent.stream('hi')).getFullOutput()
    expect(output.text).toBe('hello world')
  }, 15000)

  it('agent.generate() 本质就是 stream + getFullOutput（agent.ts:7291）', async () => {
    // generate 走 doGenerate，需要另一种 mock 格式（content 数组），这里不展开；
    // 用 stream 等价演示：两者拿到的是同一个 FullOutput 形状。
    const agent = new Agent({
      name: 'p2',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'via generate' }]) as any,
    })
    const streamResult = await agent.stream('hi')
    const output = await streamResult.getFullOutput() // generate 内部就是多做这一步
    expect(output.text).toBe('via generate')
  }, 15000)
})

describe('方式二：textStream —— 逐 chunk 消费纯文本', () => {
  // 断点：stream/base/output.ts:1565 get textStream
  it('textStream 是 ReadableStream<string>，可以 for-await 消费', async () => {
    const agent = new Agent({
      name: 'p3',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'hello world' }]) as any,
    })
    const streamResult = await agent.stream('hi')

    const chunks: string[] = []
    for await (const chunk of streamResult.textStream as any) {
      chunks.push(chunk)
    }
    // 拼起来等于完整文本（这里 mock 只发一个 delta，真实场景会有多个）
    expect(chunks.join('')).toBe('hello world')
  }, 15000)
})

describe('方式三：fullStream —— 逐 chunk 消费完整事件（含类型标记）', () => {
  /**
   * 断点：stream/base/output.ts:1264 get fullStream
   * 这是 UI 层真正会用的接口——每个 chunk 有 type，可以区分文本增量、
   * 步骤开始/结束、工具调用等，用于渲染打字机效果或工具调用提示。
   */
  it('fullStream 产出的 chunk 类型序列（实测）', async () => {
    const agent = new Agent({ name: 'p4', instructions: 'x', model: mockModel([{ kind: 'text', text: 'hi' }]) as any })
    const streamResult = await agent.stream('hi')

    const types: string[] = []
    for await (const chunk of streamResult.fullStream as any) {
      types.push(chunk.type)
    }

    // 一次纯文本响应的完整事件序列
    expect(types).toEqual(['start', 'step-start', 'text-start', 'text-delta', 'text-end', 'step-finish', 'finish'])
  }, 15000)
})

describe('⚠️ 一个流只能消费一次', () => {
  /**
   * MastraModelOutput 内部靠 #bufferedChunks 等私有字段边流边攒，
   * 但 fullStream/textStream 本身是 ReadableStream，读过的 chunk 不会再吐第二次。
   * 想要「既流式展示又要最终结果」，用 getFullOutput()（它会消费完流后聚合），
   * 不要既遍历 fullStream 又调 getFullOutput()。
   */
  it('遍历完 fullStream 后，getFullOutput 仍能拿到聚合结果（因为底层做了缓冲）', async () => {
    const agent = new Agent({
      name: 'p5',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'buffered' }]) as any,
    })
    const streamResult = await agent.stream('hi')

    // 先流式消费一遍
    for await (const _chunk of streamResult.fullStream as any) {
      // 只是遍历，不做什么
    }
    // 再调 getFullOutput —— 因为内部已缓冲，依然能拿到完整结果
    const output = await streamResult.getFullOutput()
    expect(output.text).toBe('buffered')
  }, 15000)
})
