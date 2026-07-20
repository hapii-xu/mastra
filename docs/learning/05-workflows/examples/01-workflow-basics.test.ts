import { describe, expect, it } from 'vitest'
import { createStep, createWorkflow } from '../../../../packages/core/src/workflows'
import { Mastra } from '../../../../packages/core/src/mastra'

/**
 * 05.1 · Workflow 基础：定义、提交、运行
 *
 * 源码：packages/core/src/workflows/workflow.ts（4546 行）
 *       createWorkflow 在 workflows/create.ts:26
 *
 * 三个核心概念：
 *   - Workflow = 定义（图结构），可复用
 *   - Run      = 一次执行，有 runId、状态、快照
 *   - createStep = 把一段逻辑变成图里的节点
 *
 * ⚠️ 重要事实（贯穿全模块）：一个 agent 运行时，本质就是三层嵌套的 Workflow。
 *    所以学懂 workflow，agent 那一万行才能读懂。
 */

// 一个最小 step：execute 接收 inputData，返回输出对象
const makeStep = (id: string, out: Record<string, unknown>) =>
  createStep({ id, execute: async ({ inputData }) => ({ ...out, got: (inputData as any).v }) })

describe('createWorkflow + .then() + .commit()', () => {
  // 断点：workflows/create.ts:26 createWorkflow；workflows/workflow.ts:1690 then；:2289 commit
  it('最简单的链：input → step a → step b → output', async () => {
    // step 的 execute 接收 { inputData }，返回值成为下一步的 inputData（链式传递）
    const a = createStep({ id: 'a', execute: async ({ inputData }) => ({ fromInput: (inputData as any).v, a: 1 }) })
    const b = createStep({ id: 'b', execute: async ({ inputData }) => ({ fromA: (inputData as any).a, b: 2 }) })

    const wf = createWorkflow({ id: 'chain', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(a)
      .then(b)
      .commit()

    const run = await wf.createRun()
    const res: any = await run.start({ inputData: { v: 'hello' } })

    expect(res.status).toBe('success')
    // 结果形状：res.result = 最后一步的输出；res.steps.<id>.output = 每步输出
    expect(res.result).toEqual({ fromA: 1, b: 2 }) // b 拿到 a 的 a:1
    expect(res.steps.a.output).toEqual({ fromInput: 'hello', a: 1 }) // a 拿到 input 的 v
    expect(res.steps.b.output).toEqual({ fromA: 1, b: 2 })
  })

  it('⚠️ 不调 .commit() 就 createRun → 抛错', async () => {
    const wf = createWorkflow({ id: 'nocommit', inputSchema: {} as any, outputSchema: {} as any, steps: [] }).then(
      makeStep('a', {}),
    )
    // 没 commit
    await expect(wf.createRun()).rejects.toThrow(/commit/i)
  })

  it('⚠️ 没有任何 step → 抛错', async () => {
    const wf = createWorkflow({ id: 'empty', inputSchema: {} as any, outputSchema: {} as any, steps: [] }).commit()
    await expect(wf.createRun()).rejects.toThrow(/Add steps/)
  })
})

describe('Workflow（定义） vs Run（执行）—— 一对多', () => {
  // 断点：workflow.ts:1544 class Workflow；:2978 class Run；:2320 createRun
  it('同一个 Workflow 定义可以产生多个独立 Run', async () => {
    const wf = createWorkflow({ id: 'reuse', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(makeStep('a', {}))
      .commit()

    const run1 = await wf.createRun()
    const run2 = await wf.createRun()

    // 两个不同的 runId
    expect(run1.runId).not.toBe(run2.runId)

    const r1: any = await run1.start({ inputData: { v: 'one' } })
    const r2: any = await run2.start({ inputData: { v: 'two' } })
    expect(r1.status).toBe('success')
    expect(r2.status).toBe('success')
    // 互不干扰：各自的 step a 拿到各自的 input
    expect(r1.steps.a.output.got).toBe('one')
    expect(r2.steps.a.output.got).toBe('two')
  })

  it('createRun 传 runId 可复用同一个 Run 实例', async () => {
    const wf = createWorkflow({ id: 'reuseid', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(makeStep('a', {}))
      .commit()

    const run1 = await wf.createRun({ runId: 'fixed-id' })
    const run2 = await wf.createRun({ runId: 'fixed-id' })
    // 同一个 runId → 返回缓存的同一个 Run 实例（#runs Map，workflow.ts:2347/2369）
    expect(run1).toBe(run2)
  })
})

describe('Run 的状态：success / suspended / failed', () => {
  it('step 抛错 → status = failed', async () => {
    const bad = createStep({
      id: 'bad',
      execute: async () => {
        throw new Error('boom')
      },
    })
    const wf = createWorkflow({ id: 'fail', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(bad)
      .commit()
    const run = await wf.createRun()
    const res = await run.start({ inputData: {} })
    expect(res.status).toBe('failed')
  })

  it('runId 在 Run 实例上（关联存储/追踪用），不在 result 上', async () => {
    const wf = createWorkflow({ id: 'rid', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(makeStep('a', {}))
      .commit()
    const run = await wf.createRun({ runId: 'my-run-id' })
    const res: any = await run.start({ inputData: {} })
    // runId 属于 Run，不属于 WorkflowResult
    expect(run.runId).toBe('my-run-id')
    expect(res.runId).toBeUndefined()
    // res 里有 traceId / spanId 字段（可观测性用，没配 observability 时为 undefined，见 12）
  })
})

describe('注册到 Mastra：拿到存储/日志/可观测性', () => {
  /**
   * 裸 createWorkflow 没有 mastra —— suspend/resume 会失败（见 03-suspend-resume）。
   * 注册到 new Mastra({ workflows }) 后，自动获得 InMemoryStore 等基础设施。
   * 断点：mastra/index.ts:1220 构造函数；:1310/1332 workflow.__registerMastra(this)
   */
  it('getWorkflow 取回注册的 workflow', async () => {
    const wf = createWorkflow({ id: 'reg', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(makeStep('a', {}))
      .commit()
    const m = new Mastra({ workflows: { reg: wf } })

    const w = m.getWorkflow('reg')
    expect(w).toBeDefined()

    const run = await w.createRun()
    const res = await run.start({ inputData: {} })
    expect(res.status).toBe('success')
  })
})
