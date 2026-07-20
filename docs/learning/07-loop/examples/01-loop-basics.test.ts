import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { mockModel } from './mock-model'

/**
 * 07.1 · agentic loop 基础
 *
 * 源码：packages/core/src/loop/loop.ts:11（入口）
 *       packages/core/src/loop/workflows/agentic-loop/index.ts:24（.dowhile 循环）
 *
 * ⭐ 核心事实：agent.stream() 最终把控制权交给 loop/。
 *    「Agent 能自己反复思考、调工具、直到完成」的本质 = 一个 .dowhile() 循环。
 *    没有 magic，就是循环 + 停止条件。
 *
 * 本文件用内联 mock 模型走通 loop，不调真实 provider。
 * 断点建议：loop/loop.ts:11、agentic-loop/index.ts:24 的 dowhile 条件闭包。
 */

describe('agent.stream 走通 agentic loop', () => {
  it('mock 模型返回文本 → loop 跑一轮就结束', async () => {
    // 断点：loop/loop.ts:11 loop() 入口
    const agent = new Agent({
      name: 'basic',
      instructions: '你是个测试 agent',
      model: mockModel([{ kind: 'text', text: '你好，我是 mock' }]) as any,
    })

    const output = await (await agent.stream('随便说点什么')).getFullOutput()

    expect(output.text).toContain('你好，我是 mock')
    expect(output.finishReason).toBe('stop')
  }, 15000)

  it('getFullOutput 里有 usage（成本核算用，见 12）', async () => {
    const agent = new Agent({
      name: 'usage',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
    })
    const output = await (await agent.stream('hi')).getFullOutput()
    expect(output.usage).toBeDefined()
    // totalUsage 累加了所有循环轮次
    expect(output.totalUsage).toBeDefined()
  }, 15000)

  it('agent.generate 本质 = stream + getFullOutput（见 06）', async () => {
    // generate 内部就是走 stream 链路再 await getFullOutput（agent.ts:7291）。
    // generate 路径的 mock 模型需要另一种 doGenerate 格式（content 数组），这里不展开，
    // 用 stream 等价演示：拿到的是同一个 FullOutput 形状。
    const agent = new Agent({
      name: 'gen',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'generated' }]) as any,
    })
    const streamResult = await agent.stream('hi')
    const output = await streamResult.getFullOutput() // generate 就是多走这一步
    expect(output.text).toContain('generated')
  }, 15000)
})

describe('loop 的入口与交界点', () => {
  /**
   * 完整调用链（见 06/07 文档）：
   *   agent.stream() → #execute → execution-workflow → streamStep
   *     → MastraLLMVNext.stream()  (llm/model/model.loop.ts:106)
   *       → loop()                 (llm/model/model.loop.ts:361 → loop/loop.ts:11)
   *         → workflowLoopStream() (loop/workflows/stream.ts)
   *           → createAgenticLoopWorkflow()  (loop/workflows/agentic-loop/index.ts:24)
   *             .dowhile(agenticExecution, 停止条件)
   *
   * ⭐ model.loop.ts:361 是全框架最值得打断点的地方之一：
   *    agent 准备好的一切，在这里以最终形态交给 agentic 循环。
   */
  it('loop 是 agent.stream 的下游（间接验证：流能拿到结果）', async () => {
    const agent = new Agent({
      name: 'chain',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'from-loop' }]) as any,
    })
    // agent.stream 不直接调 loop——中间经过三层 workflow（见 06）
    const output = await (await agent.stream('hi')).getFullOutput()
    expect(output.text).toBe('from-loop')
  }, 15000)
})
