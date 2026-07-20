import { describe, expect, it } from 'vitest'
import { createStep, createWorkflow } from '../../../../packages/core/src/workflows'
import { Mastra } from '../../../../packages/core/src/mastra'

/**
 * 05.3 · Suspend / Resume —— 人机协作（HITL）的基础
 *
 * 源码：packages/core/src/workflows/step.ts（品牌类型 SuspendBrand，:19-22）
 *       packages/core/src/workflows/workflow.ts（resume :3864，_resume ~3985）
 *       packages/core/src/workflows/types.ts（suspendedPaths:351, resumeLabels:352）
 *
 * ⭐ 类型设计的妙处：suspend() 的返回类型带一个只存在于类型层的品牌符号，
 *    业务代码无法伪造「挂起结果」——只能真的调 suspend()。
 *
 * ⚠️ 关键约束（实测）：resume 必须有存储。裸 workflow 没有 mastra → resume 抛
 *    "No snapshot found"。所以示例注册到 new Mastra({ workflows })。
 */

/** 注册 workflow 到一个内存 Mastra，拿回带存储的实例 */
function withMastra(id: string, builder: (w: ReturnType<typeof createWorkflow>) => ReturnType<typeof createWorkflow>) {
  const wf = builder(createWorkflow({ id, inputSchema: {} as any, outputSchema: {} as any, steps: [] }))
  const m = new Mastra({ workflows: { [id]: wf } })
  return m.getWorkflow(id)
}

describe('suspend() —— 把执行挂起', () => {
  // 断点：step.ts:19 的 SuspendBrand；workflow.ts 里 suspend 的消费
  it('调用 suspend() → run.status = suspended', async () => {
    const w = withMastra('s1', w =>
      w
        .then(
          createStep({
            id: 'ask',
            execute: async ({ suspend }) => suspend({ question: '审批通过吗？' }),
          }),
        )
        .commit(),
    )
    const run = await w.createRun()
    const res: any = await run.start({ inputData: {} })
    expect(res.status).toBe('suspended')
  })

  it('不挂起的 step → 正常 success', async () => {
    const w = withMastra('s2', w => w.then(createStep({ id: 'work', execute: async () => ({ done: true }) })).commit())
    const run = await w.createRun()
    const res: any = await run.start({ inputData: {} })
    expect(res.status).toBe('success')
  })
})

describe('resume() —— 恢复挂起的执行', () => {
  // 断点：workflow.ts:3985 _resume 里 loadWorkflowSnapshot；:3989 抛 "No snapshot found"
  it('带 resumeData 恢复，step 通过 resumeData 收到恢复值', async () => {
    const w = withMastra('r1', w =>
      w
        .then(
          createStep({
            id: 'ask',
            execute: async ({ resumeData }: any) => {
              if (resumeData?.approved) return { done: true }
              return { status: 'no-resume' } as any
            },
          }),
        )
        .commit(),
    )
    const run = await w.createRun()
    // 第一次：没 resumeData → 我们手动让它走挂起路径（这里简化为直接成功路径测 resume）
    // 真实 HITL：先 start（挂起），再 resume（带数据）
    const ask = createStep({
      id: 'ask',
      execute: async ({ resumeData, suspend }: any) => {
        if (resumeData?.approved) return { done: true }
        return suspend({ q: 'ok?' })
      },
    })
    const w2 = withMastra('r2', w => w.then(ask).commit())
    const run2 = await w2.createRun()
    const r1: any = await run2.start({ inputData: {} })
    expect(r1.status).toBe('suspended')

    // 恢复：传 approved: true
    const r2: any = await run2.resume({ resumeData: { approved: true }, step: ask })
    expect(r2.status).toBe('success')
    expect(r2.steps.ask.output).toEqual({ done: true })
  })

  it('⚠️ 裸 workflow（无 Mastra）resume → 抛 "No snapshot found"', async () => {
    const ask = createStep({
      id: 'ask',
      execute: async ({ resumeData, suspend }: any) => {
        if (resumeData?.approved) return { done: true }
        return suspend({ q: 'ok?' })
      },
    })
    // 注意：没有注册到 Mastra
    const wf = createWorkflow({ id: 'bare', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(ask)
      .commit()
    const run = await wf.createRun()
    await run.start({ inputData: {} }) // 挂起（start 不需要存储）
    // resume 需要存储 → 抛错
    await expect(run.resume({ resumeData: { approved: true }, step: ask })).rejects.toThrow(/No snapshot found/)
  })
})

describe('suspendedPaths 与 resumeLabels（types.ts:351-352）', () => {
  /**
   * 挂起状态记录在快照里：
   *   suspendedPaths: Record<string, number[]>  —— 挂在步骤图的哪条路径
   *   resumeLabels:   Record<string, { stepId, forEachIndex? }>  —— 恢复标签
   * resume 可用 4 种方式定位恢复点：step 对象 / 路径数组 / 字符串 id / label
   */
  it('用 step 对象定位恢复点（最常见）', async () => {
    const ask = createStep({
      id: 'ask',
      execute: async ({ resumeData, suspend }: any) => {
        if (resumeData) return { got: resumeData }
        return suspend({ q: 1 })
      },
    })
    const w = withMastra('lbl', w => w.then(ask).commit())
    const run = await w.createRun()
    await run.start({ inputData: {} })
    const res: any = await run.resume({ resumeData: 'human-answer', step: ask })
    expect(res.steps.ask.output).toEqual({ got: 'human-answer' })
  })

  it('用 step id（字符串）定位恢复点', async () => {
    const ask = createStep({
      id: 'ask',
      execute: async ({ resumeData, suspend }: any) => {
        if (resumeData) return { got: resumeData }
        return suspend({ q: 1 })
      },
    })
    const w = withMastra('lbl2', w => w.then(ask).commit())
    const run = await w.createRun()
    await run.start({ inputData: {} })
    const res: any = await run.resume({ resumeData: 'by-id', step: 'ask' })
    expect(res.steps.ask.output).toEqual({ got: 'by-id' })
  })
})

describe('企业级 HITL 场景：危险操作要人工确认', () => {
  it('退款 workflow：先挂起等审批，批准后执行退款', async () => {
    const approve = createStep({
      id: 'approve',
      execute: async ({ inputData, resumeData, suspend }: any) => {
        // ⚠️ 恢复时的返回值会流向下游 —— 必须把 refund 需要的字段带出去
        if (resumeData?.approved) return { approved: true, amount: inputData.amount, userId: inputData.userId }
        return suspend({ amount: inputData.amount, userId: inputData.userId })
      },
    })
    const refund = createStep({
      id: 'refund',
      execute: async ({ inputData }: any) => ({ refunded: true, amount: inputData.amount }),
    })
    const w = withMastra('hitl', w => w.then(approve).then(refund).commit())

    const run = await w.createRun()
    const r1: any = await run.start({ inputData: { amount: 100, userId: 'u1' } })
    expect(r1.status).toBe('suspended') // 等审批

    // 人工审批通过
    const r2: any = await run.resume({ resumeData: { approved: true }, step: approve })
    expect(r2.status).toBe('success')
    expect(r2.steps.refund.output).toEqual({ refunded: true, amount: 100 })
  })
})
