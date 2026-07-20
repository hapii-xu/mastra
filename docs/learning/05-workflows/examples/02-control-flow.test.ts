import { describe, expect, it } from 'vitest'
import { createStep, createWorkflow } from '../../../../packages/core/src/workflows'

/**
 * 05.2 · 控制流原语
 *
 * 源码：packages/core/src/workflows/workflow.ts（全部链式方法）
 *   .then(1690) .sleep(1735) .sleepUntil(1774) .waitForEvent(1810)
 *   .map(1825) .parallel(2006) .branch(2069) .dowhile(2125) .dountil(2173)
 *   .foreach(2221) .commit(2289)
 *
 * 全部返回 this（链式），全部最后要 .commit()。
 * 回顾：agent 的三层嵌套 workflow 用的就是这些原语——
 *   execution-workflow: .parallel().map().then()
 *   agentic-loop:       .dowhile()
 *   agentic-execution:  .then().map().foreach().then()...
 */

const wf = (id: string) => createWorkflow({ id, inputSchema: {} as any, outputSchema: {} as any, steps: [] })

describe('.then() —— 顺序（1690）', () => {
  it('前一步输出 = 后一步 inputData', async () => {
    const a = createStep({ id: 'a', execute: async () => ({ n: 1 }) })
    const b = createStep({ id: 'b', execute: async ({ inputData }) => ({ doubled: (inputData as any).n * 2 }) })
    const run = await wf('then').then(a).then(b).commit().createRun()
    const res: any = await run.start({ inputData: {} })
    expect(res.result).toEqual({ doubled: 2 })
  })
})

describe('.parallel() —— 并发（2006）', () => {
  // 断点：workflow.ts:2006 parallel；handlers/control-flow.ts:69 executeParallel
  it('多个 step 并发执行，输出合并', async () => {
    const a = createStep({ id: 'a', execute: async () => ({ a: 1 }) })
    const b = createStep({ id: 'b', execute: async () => ({ b: 2 }) })
    const run = await wf('par').parallel([a, b]).commit().createRun()
    const res: any = await run.start({ inputData: {} })
    expect(res.status).toBe('success')
    // 两步各自的输出都在 steps 里
    expect(res.steps.a.output).toEqual({ a: 1 })
    expect(res.steps.b.output).toEqual({ b: 2 })
  })
})

describe('.branch() —— 条件分支（2069）', () => {
  // ⚠️ API：branch 接收 [conditionFn, step] 元组数组（不是 {when, then}）
  // 断点：workflow.ts:2069 branch；handlers/control-flow.ts:270 executeConditional
  it('条件为真的分支执行，假的跳过', async () => {
    const yes = createStep({ id: 'yes', execute: async () => ({ ran: 'yes' }) })
    const no = createStep({ id: 'no', execute: async () => ({ ran: 'no' }) })
    const run = await wf('br')
      .branch([
        [({ inputData }) => (inputData as any).go === 'yes', yes],
        [({ inputData }) => (inputData as any).go === 'no', no],
      ])
      .commit()
      .createRun()
    const res: any = await run.start({ inputData: { go: 'yes' } })
    expect(res.steps.yes.output).toEqual({ ran: 'yes' })
    expect(res.steps.no?.status).not.toBe('success') // 没执行
  })
})

describe('.dowhile() / .dountil() —— 循环（2125 / 2173）', () => {
  // 断点：workflow.ts:2125 dowhile；handlers/control-flow.ts:596 executeLoop
  // ⭐ agentic-loop 的「自主循环」就是一个 .dowhile()
  it('dowhile：先执行，再判断是否再来一轮', async () => {
    let count = 0
    const inc = createStep({
      id: 'inc',
      execute: async () => {
        count++
        return { count }
      },
    })
    const run = await wf('dw')
      .dowhile(inc, async ({ inputData }) => (inputData as any).count < 3)
      .commit()
      .createRun()
    const res: any = await run.start({ inputData: { count: 0 } })
    expect(res.status).toBe('success')
    expect(count).toBeGreaterThanOrEqual(3) // 至少跑到 count>=3
  })
})

describe('.foreach() —— 遍历（2221）', () => {
  // 断点：workflow.ts:2221 foreach；handlers/control-flow.ts:865 executeForeach
  // ⭐ agentic-execution 用 .foreach(toolCallStep) 并发执行多个工具调用
  it('对数组的每个元素执行一次 step', async () => {
    // foreach 的上游要产出数组。用 map 把 input 变成数组。
    const toArray = createStep({
      id: 'toArray',
      execute: async ({ inputData }) => ({ items: (inputData as any).list }),
    })
    const handleOne = createStep({
      id: 'handleOne',
      execute: async ({ inputData }) => ({ handled: inputData as any as string }),
    })
    const run = await wf('fe').then(toArray).foreach(handleOne).commit().createRun()
    const res: any = await run.start({ inputData: { list: ['x', 'y', 'z'] } })
    expect(res.status).toBe('success')
    // foreach 对每个元素执行一次，step 结果按 index 收集
    expect(res.steps.handleOne).toBeDefined()
  })
})

describe('.map() —— 数据变换（1825）', () => {
  // ⭐ agentic-execution 用 .map(map-tool-calls) 算工具并发度
  it('纯变换：不注册新 step，改写流向下游的数据', async () => {
    const run = await wf('map')
      .map(async ({ inputData }) => ({ upper: String((inputData as any).s).toUpperCase() }))
      .then(createStep({ id: 'check', execute: async ({ inputData }) => ({ got: (inputData as any).upper }) }))
      .commit()
      .createRun()
    const res: any = await run.start({ inputData: { s: 'hello' } })
    expect(res.steps.check.output).toEqual({ got: 'HELLO' })
  })
})

describe('组合：模拟 agent 的 execution-workflow 形状', () => {
  // 复刻 agent/workflows/prepare-stream/index.ts:184 的形状（简化）
  // 重点是「形状」：.parallel().map().then() —— 和 agent 内部 workflow 同款结构
  it('.parallel([...]).map(...).then(...) 链路能跑通', async () => {
    const prepTools = createStep({ id: 'prepTools', execute: async () => ({ tools: 2 }) })
    const stream = createStep({
      id: 'stream',
      execute: async ({ inputData }) => ({ ran: (inputData as any).tools === 2 }),
    })

    const run = await wf('agentShape')
      .parallel([prepTools])
      .map(async () => ({ tools: 2 })) // map 产出固定结构给下游（agent 里这里整理 prep 结果）
      .then(stream)
      .commit()
      .createRun()
    const res: any = await run.start({ inputData: {} })
    expect(res.status).toBe('success')
    expect(res.steps.stream.output).toEqual({ ran: true })
  })
})
