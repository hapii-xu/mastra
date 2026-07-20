import { describe, expect, it } from 'vitest'
import { createStep, createWorkflow } from '../../../../packages/core/src/workflows'
import { MastraNonRetryableError } from '../../../../packages/_internal-core/src/error'
import { Mastra } from '../../../../packages/core/src/mastra'

/**
 * 05.4 · 执行引擎：重试、不可重试错误、事件流
 *
 * 源码：packages/core/src/workflows/default.ts（DefaultExecutionEngine :55，execute :712）
 *       default.ts:425 executeStepWithRetry，:458 instanceof MastraNonRetryableError
 *       workflows/handlers/step.ts:70 executeStep，:549 runScorersForStep
 *       workflows/handlers/entry.ts:242 executeEntry，:142 persistStepUpdate
 *
 * 两套引擎：DefaultExecutionEngine（direct，默认）和 EventedExecutionEngine（evented）。
 * 切换：MASTRA_EVENTED_EXECUTION=true，或声明 schedule 自动转 evented（create.ts:34）。
 */

const wf = (id: string, retryConfig?: any) =>
  createWorkflow({
    id,
    inputSchema: {} as any,
    outputSchema: {} as any,
    steps: [],
    ...(retryConfig ? { retryConfig } : {}),
  })

describe('重试：retryConfig', () => {
  // 断点：default.ts:425 executeStepWithRetry 的重试循环
  it('普通错误会按 retryConfig 重试', async () => {
    let attempts = 0
    const flaky = createStep({
      id: 'flaky',
      execute: async () => {
        attempts++
        if (attempts < 3) throw new Error('临时故障')
        return { ok: true }
      },
    })
    const w = createWorkflow({
      id: 'retry',
      inputSchema: {} as any,
      outputSchema: {} as any,
      steps: [],
      retryConfig: { attempts: 5, delay: 0 }, // 给足重试次数
    })
      .then(flaky)
      .commit()
    const run = await w.createRun()
    const res: any = await run.start({ inputData: {} })
    expect(res.status).toBe('success')
    expect(attempts).toBe(3) // 失败 2 次，第 3 次成功
  })

  it('重试耗尽 → status = failed', async () => {
    const alwaysFail = createStep({
      id: 'alwaysFail',
      execute: async () => {
        throw new Error('永久故障（但不是 NonRetryable）')
      },
    })
    const w = createWorkflow({
      id: 'retry2',
      inputSchema: {} as any,
      outputSchema: {} as any,
      steps: [],
      retryConfig: { attempts: 2, delay: 0 },
    })
      .then(alwaysFail)
      .commit()
    const run = await w.createRun()
    const res: any = await run.start({ inputData: {} })
    expect(res.status).toBe('failed')
  })
})

describe('⭐ MastraNonRetryableError：第一次就放弃，不重试', () => {
  // 关联 01.2 §五：原型链三连。default.ts:458 用 instanceof 判定。
  it('抛 MastraNonRetryableError → 不重试，直接 failed', async () => {
    let attempts = 0
    const bad = createStep({
      id: 'bad',
      execute: async () => {
        attempts++
        // 参数非法，重试也没用
        throw new MastraNonRetryableError('参数非法，不重试')
      },
    })
    const w = createWorkflow({
      id: 'nonretry',
      inputSchema: {} as any,
      outputSchema: {} as any,
      steps: [],
      retryConfig: { attempts: 10, delay: 0 }, // 即使给 10 次也不重试
    })
      .then(bad)
      .commit()
    const run = await w.createRun()
    const res: any = await run.start({ inputData: {} })
    expect(res.status).toBe('failed')
    expect(attempts).toBe(1) // 只执行一次
  })

  it('对比：普通 Error 会重试到上限', async () => {
    let attempts = 0
    const bad = createStep({
      id: 'bad',
      execute: async () => {
        attempts++
        throw new Error('普通错误')
      },
    })
    const w = createWorkflow({
      id: 'retry-cmp',
      inputSchema: {} as any,
      outputSchema: {} as any,
      steps: [],
      retryConfig: { attempts: 2, delay: 0 },
    })
      .then(bad)
      .commit()
    const run = await w.createRun()
    await run.start({ inputData: {} })
    // 首次 + 2 次重试 = 3 次
    expect(attempts).toBe(3)
  })
})

describe('watch() —— 监听执行事件流（workflow.ts:3809）', () => {
  // watch 是 run 的事件订阅入口，stream()/watch() 都基于它
  it('能收到 step 的开始/结束事件', async () => {
    const events: string[] = []
    const a = createStep({ id: 'a', execute: async () => ({ a: 1 }) })
    const w = createWorkflow({ id: 'watch', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(a)
      .commit()
    const run = await w.createRun()
    // watch 返回一个 unsubscribe 函数
    const unsub = run.watch((event: any) => {
      // 事件类型有 'step-start' 之类（具体 payload 见 types.ts WorkflowStreamEvent）
      if (event?.type) events.push(event.type)
    })
    await run.start({ inputData: {} })
    unsub()
    // 至少收到一些事件
    expect(events.length).toBeGreaterThan(0)
  })
})

describe('direct vs evented 引擎', () => {
  /**
   * 切换方式：
   *   1. MASTRA_EVENTED_EXECUTION=true 环境变量
   *   2. createWorkflow 时声明 schedule → 自动转 evented（create.ts:34）
   * 默认是 direct（进程内）。
   *
   * 为什么默认 direct：evented 路径会把 requestContext 做 JSON round-trip，
   * 丢函数和循环引用（见 01.1 §四）。
   *
   * 这里只验证 direct 默认行为；evented 需要完整环境，留给手动实验。
   */
  it('默认引擎是 direct（进程内执行）', async () => {
    const a = createStep({ id: 'a', execute: async () => ({ x: 1 }) })
    const w = createWorkflow({ id: 'engine', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
      .then(a)
      .commit()
    const run = await w.createRun()
    const res: any = await run.start({ inputData: {} })
    // direct 引擎同步在进程内跑完
    expect(res.status).toBe('success')
  })
})
