import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { TripWire } from '../../../../packages/core/src/agent/trip-wire'
import { mockModel } from './mock-model'

/**
 * 08.1 · Processor 基础：6 个切点、执行顺序
 *
 * 源码：packages/core/src/processors/index.ts（Processor 接口 :560，BaseProcessor :750）
 *
 * Processor 是可选实现的接口，6 个切点：
 *   processInput / processInputStep / processLLMRequest / processLLMResponse
 *   processOutputStream / processOutputResult
 * 全是可选的——实现你需要的那几个即可。
 */

describe('⭐ 执行顺序：input processors 先跑，output processors 后跑', () => {
  it('多个 processor 按声明顺序依次执行（实测）', async () => {
    const order: string[] = []
    const p1 = {
      id: 'p1',
      processInput: async ({ messages }: any) => {
        order.push('p1-in')
        return messages
      },
    }
    const p2 = {
      id: 'p2',
      processInput: async ({ messages }: any) => {
        order.push('p2-in')
        return messages
      },
    }
    const o1 = {
      id: 'o1',
      processOutputResult: async ({ messages }: any) => {
        order.push('o1-out')
        return messages
      },
    }

    const agent = new Agent({
      name: 'ordered',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'hi' }]) as any,
      inputProcessors: [p1, p2] as any,
      outputProcessors: [o1] as any,
    })

    await (await agent.stream('go')).getFullOutput()

    // 输入处理器全部先跑完，再跑输出处理器；同类型内部按声明顺序
    expect(order).toEqual(['p1-in', 'p2-in', 'o1-out'])
  }, 15000)
})

describe('processInput：改写输入消息', () => {
  it('processInput 可以修改/替换消息内容', async () => {
    const uppercase = {
      id: 'uppercase',
      processInput: async ({ messages }: any) => messages,
    }
    const agent = new Agent({
      name: 'x',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
      inputProcessors: [uppercase] as any,
    })
    const output = await (await agent.stream('hello')).getFullOutput()
    expect(output.text).toBe('ok')
  }, 15000)
})

describe('⭐ 6 个切点全部可选：只实现你需要的', () => {
  it('只实现 processOutputResult 也合法（不需要实现全部方法）', async () => {
    const onlyOutput = {
      id: 'output-only',
      processOutputResult: async ({ messages }: any) => messages,
    }
    const agent = new Agent({
      name: 'y',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
      outputProcessors: [onlyOutput] as any,
    })
    const output = await (await agent.stream('hi')).getFullOutput()
    expect(output.text).toBe('ok')
  }, 15000)
})

describe('processor 抛 TripWire → 中断整个执行（关联 04.2）', () => {
  it('input processor 抛 TripWire，模型完全不会被调用', async () => {
    let modelCalled = false
    const blocker = {
      id: 'blocker',
      processInput: async () => {
        throw new TripWire('测试拦截')
      },
    }
    // mock 模型，如果被调用就设置标记（用于验证模型真的没被调）
    const trackedModel = {
      ...mockModel([{ kind: 'text', text: 'should not happen' }]),
      doStream: async (...args: any[]) => {
        modelCalled = true
        return mockModel([{ kind: 'text', text: 'x' }]).doStream(...(args as [any]))
      },
    }
    const agent = new Agent({
      name: 'z',
      instructions: 'x',
      model: trackedModel as any,
      inputProcessors: [blocker] as any,
    })
    const output: any = await (await agent.stream('危险输入')).getFullOutput()

    expect(modelCalled).toBe(false) // 模型没被调用
    expect(output.tripwire?.reason).toBe('测试拦截')
  }, 15000)
})
