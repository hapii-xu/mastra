import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { createStep, createWorkflow } from '../../../../packages/core/src/workflows'
import { createTool } from '../../../../packages/core/src/tools'
import { Mastra } from '../../../../packages/core/src/mastra'

/**
 * 05.5 · createStep 的多态 —— 万物皆可成 step
 *
 * 源码：packages/core/src/workflows/workflow.ts:207-338（6 个重载）
 *
 * createStep 接受 4 种东西：
 *   - 普通 step 配置（最常见）
 *   - Tool       → 工具变 step（本文件演示）
 *   - Workflow   → 嵌套 workflow 变 step（本文件演示）
 *   - Processor  → 处理器变 step（见 08-processors）
 *   - Agent      → agent 变 step（需要 model，见 06-agent）
 *
 * ⭐ 这是整个框架组合性的来源：agent run 本身就是 workflow，
 *    而 workflow 里又能嵌套 agent/tool/workflow/processor。
 */

const wf = (id: string) => createWorkflow({ id, inputSchema: {} as any, outputSchema: {} as any, steps: [] })

describe('Tool 作为 step', () => {
  // 断点：workflow.ts:608 createStepFromTool；:655 params.execute(inputData, toolContext)
  // ⭐ 重要（v1.0 breaking change）：tool 作为 step 时，execute 被「位置参数」调用——
  //   createStepFromTool 调的是 tool.execute(inputData, toolContext)，
  //   所以 step 里的 tool execute 要读第一个位置参数（inputData），不是 { context }。
  //   源码注释原文："BREAKING CHANGE v1.0: Pass raw input as first arg, context as second"
  it('createStep(tool) 把工具包装成 step（execute 读位置参数 input）', async () => {
    const myTool = createTool({
      id: 'addOne',
      description: '加一',
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ result: z.number() }),
      execute: async (input: any) => ({ result: input.n + 1 }), // ← 位置参数，不是 { context }
    })
    const stepFromTool = createStep(myTool)
    const run = await wf('toolstep').then(stepFromTool).commit().createRun()
    const res: any = await run.start({ inputData: { n: 41 } })
    expect(res.status).toBe('success')
    expect(res.steps.addOne.output).toEqual({ result: 42 })
  })
})

describe('Workflow 作为 step（嵌套）', () => {
  // 断点：workflow.ts:305 的 createStep 重载（接受 Workflow）
  //       default.ts:130 isNestedWorkflowStep，:248 executeWorkflowStep
  it('把一个 workflow 嵌进另一个 workflow', async () => {
    // 子 workflow：做实际工作
    const child = createWorkflow({ id: 'child', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(createStep({ id: 'double', execute: async ({ inputData }) => ({ doubled: (inputData as any).n * 2 }) }))
      .commit()

    // 父 workflow：用 createStep 把 child 变成一个 step
    const parent = createWorkflow({ id: 'parent', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(createStep(child))
      .commit()

    const run = await parent.createRun()
    const res: any = await run.start({ inputData: { n: 21 } })
    expect(res.status).toBe('success')
    // 子 workflow 的输出出现在父的结果里
    expect(res.steps.child).toBeDefined()
  })
})

describe('组合：Tool + Workflow 混搭', () => {
  it('一个 workflow 里：先跑 tool，再跑子 workflow', async () => {
    const addOne = createTool({
      id: 'addOne',
      description: '加一',
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ n: z.number() }),
      execute: async (input: any) => ({ n: input.n + 1 }), // 位置参数（tool 作为 step 时）
    })
    const timesTen = createWorkflow({ id: 'timesTen', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(createStep({ id: 'mul', execute: async ({ inputData }) => ({ n: (inputData as any).n * 10 }) }))
      .commit()

    const pipeline = createWorkflow({ id: 'pipe', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(createStep(addOne))
      .then(createStep(timesTen))
      .commit()

    const run = await pipeline.createRun()
    const res: any = await run.start({ inputData: { n: 4 } })
    expect(res.status).toBe('success')
    expect(res.steps.addOne.output).toEqual({ n: 5 })
    expect(res.steps.timesTen).toBeDefined()
  })
})

describe('注册到 Mastra 后取回', () => {
  it('多个 workflow 注册，各自独立运行', async () => {
    const w1 = wf('w1')
      .then(createStep({ id: 's', execute: async () => ({ from: 1 }) }))
      .commit()
    const w2 = wf('w2')
      .then(createStep({ id: 's', execute: async () => ({ from: 2 }) }))
      .commit()
    const m = new Mastra({ workflows: { w1, w2 } })

    const r1: any = await (await m.getWorkflow('w1').createRun()).start({ inputData: {} })
    const r2: any = await (await m.getWorkflow('w2').createRun()).start({ inputData: {} })
    expect(r1.steps.s.output).toEqual({ from: 1 })
    expect(r2.steps.s.output).toEqual({ from: 2 })
  })
})
