import { describe, expect, it } from 'vitest'
import { createStep, createWorkflow } from '../../../../packages/core/src/workflows'

/**
 * 08.3 · ⭐ Processor 也是 Workflow Step —— 「一切皆 workflow」的证据
 *
 * 源码：workflows/workflow.ts:281（createStep 的 Processor 重载）
 *       agent/agent.ts:1455（combineProcessorsIntoWorkflow，私有方法，
 *       agent 内部用它把 input/output processor 列表编译成一条 workflow）
 *
 * 这是本模块最重要的认知：processor 不是一个独立的执行阶段，
 * 它被编译成了普通的 workflow step，享有 workflow 的全部能力
 * （重试、并行、可观测性），也受 workflow 的全部约束（见 05）。
 */

describe('createStep(processor)：把 processor 包装成 step', () => {
  // 断点：workflow.ts:281 的 createStep 重载
  it('⚠️ step id 会自动加上 "processor:" 前缀', async () => {
    const myProcessor = {
      id: 'my-proc',
      processInput: async ({ messages }: any) => messages,
    }
    const step = createStep(myProcessor as any)

    // 不是原样的 'my-proc'，而是加了前缀 —— 这是实测发现的细节
    expect(step.id).toBe('processor:my-proc')
  })

  it('转换后的 step 可以正常塞进 workflow 链路', async () => {
    const passthrough = {
      id: 'passthrough',
      processInput: async ({ messages }: any) => messages,
    }
    const step = createStep(passthrough as any)

    // 能正常 .then() 接进 workflow（本身能不能独立跑通取决于 processor 需要的
    // 上下文，这里只验证「能被当作 step 使用」这件事）
    const wf = createWorkflow({ id: 'proc-wf', inputSchema: {} as any, outputSchema: {} as any, steps: [] })
    expect(() => wf.then(step as any)).not.toThrow()
  })
})

describe('回顾 05.5：createStep 的多态一览', () => {
  /**
   * createStep 接受 4 种东西（workflow.ts:207-338）：
   *   普通 step 配置、Tool、Workflow、Processor
   * 本文件补上了 Processor 这一种（05.5 当时演示的是 Tool 和 Workflow）。
   */
  it('占位：completeness 说明，见上方注释', () => {
    expect(true).toBe(true)
  })
})
