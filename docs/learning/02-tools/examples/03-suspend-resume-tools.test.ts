import { describe, expect, it } from 'vitest'
import { createTool } from '../../../../packages/core/src/tools'
import { z } from 'zod/v4'

/**
 * 02.3 · 工具级 suspend/resume —— HITL 的另一半
 *
 * 源码：packages/core/src/tools/tool.ts:332-345（suspend 包装）
 *       :436-444（resumeData 校验）
 *       :449-454（suspendData 用 suspendSchema 校验）
 *
 * 05.3 学的是 workflow 级的 suspend/resume（品牌类型、resume 要存储）。
 * 这里是 tool 自己的 suspend/resume schema：工具可以声明「挂起时传什么」
 * 「恢复时收什么」，独立于外层 workflow 的 suspend 机制。
 *
 * tool.ts:332-345 的包装逻辑：如果 context 提供了 suspend 函数，
 * Tool 会包一层，记录 suspendData 供之后用 suspendSchema 校验。
 */

describe('suspendSchema：声明挂起时传什么', () => {
  it('工具调用 context.suspend(data) 时，data 会按 suspendSchema 校验', async () => {
    const approve = createTool({
      id: 'approve',
      description: '需要审批的操作',
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.object({ approved: z.boolean() }),
      suspendSchema: z.object({ amount: z.number(), reason: z.string() }),
      execute: async (inputData: any, context: any) => {
        if (!context?.resumeData) {
          // 挂起，把审批所需信息传出去
          return context.suspend({ amount: inputData.amount, reason: '金额超过阈值' })
        }
        return { approved: true }
      },
    })

    let capturedSuspendCall: any
    const fakeContext = {
      suspend: (data: any) => {
        capturedSuspendCall = data
        return undefined // 真实场景下 workflow 引擎会处理挂起
      },
    }

    await (approve as any).execute({ amount: 500 }, fakeContext)
    expect(capturedSuspendCall).toEqual({ amount: 500, reason: '金额超过阈值' })
  })

  it('⚠️ suspendData 不符合 suspendSchema → 返回 ValidationError', async () => {
    const approve = createTool({
      id: 'approve2',
      description: 'd',
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.object({ approved: z.boolean() }),
      suspendSchema: z.object({ amount: z.number(), reason: z.string() }),
      execute: async (inputData: any, context: any) => {
        if (!context?.resumeData) {
          // 故意漏传 reason（suspendSchema 要求的字段）
          return context.suspend({ amount: inputData.amount })
        }
        return { approved: true }
      },
    })

    const fakeContext = { suspend: () => undefined }
    const result: any = await (approve as any).execute({ amount: 500 }, fakeContext)
    expect(result.error).toBe(true)
    expect(result.message).toContain('reason')
  })
})

describe('resumeData：恢复时收到什么', () => {
  it('context.resumeData 存在时，走恢复分支', async () => {
    const approve = createTool({
      id: 'approve3',
      description: 'd',
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.object({ approved: z.boolean() }),
      resumeSchema: z.object({ approved: z.boolean() }),
      execute: async (inputData: any, context: any) => {
        if (context?.resumeData) {
          return { approved: context.resumeData.approved }
        }
        return context.suspend({ amount: inputData.amount })
      },
    })

    const result = await (approve as any).execute(
      { amount: 500 },
      { resumeData: { approved: true }, suspend: () => undefined },
    )
    expect(result).toEqual({ approved: true })
  })

  it('⚠️ resumeData 不符合 resumeSchema → 返回 ValidationError（tool.ts:439-444）', async () => {
    const approve = createTool({
      id: 'approve4',
      description: 'd',
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.object({ approved: z.boolean() }),
      resumeSchema: z.object({ approved: z.boolean() }),
      execute: async (inputData: any, context: any) => {
        if (context?.resumeData) return { approved: context.resumeData.approved }
        return context.suspend({ amount: inputData.amount })
      },
    })

    // resumeData.approved 应该是 boolean，这里传了字符串
    const result: any = await (approve as any).execute(
      { amount: 500 },
      { resumeData: { approved: 'yes' } as any, suspend: () => undefined },
    )
    expect(result.error).toBe(true)
  })
})

describe('requireApproval：静态与条件式', () => {
  // tool.ts:126-146：requireApproval 可以是 boolean 或函数
  it('requireApproval: true（静态）', () => {
    const t = createTool({
      id: 'danger',
      description: '危险操作',
      requireApproval: true,
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    expect(t.requireApproval).toBe(true)
  })

  it('requireApproval 可以是函数（条件式审批）', async () => {
    const t = createTool({
      id: 'conditional-danger',
      description: 'd',
      requireApproval: async ({ isDryRun }: any) => !isDryRun, // dry-run 不需要审批
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    expect(typeof t.requireApproval).toBe('function')
    const needsApproval = await (t.requireApproval as any)({ isDryRun: false })
    const skipsApproval = await (t.requireApproval as any)({ isDryRun: true })
    expect(needsApproval).toBe(true)
    expect(skipsApproval).toBe(false)
  })

  it('不设置 requireApproval 时默认为 false（tool.ts:286）', () => {
    const t = createTool({
      id: 'safe',
      description: 'd',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    expect(t.requireApproval).toBe(false)
  })
})
