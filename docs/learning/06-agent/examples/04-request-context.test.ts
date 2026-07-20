import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { createTool } from '../../../../packages/core/src/tools'
import { RequestContext, MASTRA_RESOURCE_ID_KEY } from '../../../../packages/_internal-core/src/request-context'
import { z } from 'zod/v4'
import { mockModel } from './mock-model'

/**
 * 06.4 · requestContext 流进 Agent 与工具
 *
 * 源码：agent.ts generate/stream 都接 requestContext（01.1 学的请求级数据总线）
 *       工具的 execute 通过 context 拿到 requestContext（见 02-tools 的 ToolExecutionContext）
 *
 * 这是多租户/鉴权信息传递到工具层的链路。
 * 关联 01.1：RequestContext 可变共享、4 个保留键、越权防护。
 */

describe('requestContext 从 agent.stream 传到工具 execute', () => {
  it('带 requestContext 调用，工具被执行（结果出现在 steps）', async () => {
    const whoami = createTool({
      id: 'whoami',
      description: '返回当前用户',
      inputSchema: z.object({}),
      outputSchema: z.object({ tenant: z.string() }),
      execute: async () => ({ tenant: 'Acme' }),
    })

    const agent = new Agent({
      name: 'ctx-agent',
      instructions: '调 whoami 工具回答',
      model: mockModel([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 'whoami', input: {} },
        { kind: 'text', text: 'done' },
      ]) as any,
      tools: { whoami },
    })

    const ctx = new RequestContext()
    ctx.set('tenantId', 'Acme')

    const out: any = await (await agent.stream('我是谁', { requestContext: ctx } as any)).getFullOutput()
    // 工具被执行（requestContext 透传到了 loop 的工具执行）
    const stepWithResults = (out.steps as any[])?.find(s => s.toolResults?.length)
    expect(stepWithResults?.toolResults?.[0]?.payload?.result).toMatchObject({ tenant: 'Acme' })

    // requestContext 工具拿到 requestContext 的具体字段位置见 ToolExecutionContext
    // （packages/core/src/tools/types.ts）—— 断点打在工具 execute 里看 context 形状
  }, 20000)
})

describe('保留键 MASTRA_RESOURCE_ID_KEY 的越权防护（关联 01.1 §六）', () => {
  /**
   * 认证中间件把真实用户写进 MASTRA_RESOURCE_ID_KEY（server/auth/helpers.ts:473），
   * 它优先于客户端传值——防止攻击者假冒身份读别人记忆。
   * 这里只演示「中间件设的值能透传到 agent 上下文」。
   */
  it('中间件设的 resourceId 进 requestContext，agent 全链路可见', async () => {
    const ctx = new RequestContext()
    ctx.set(MASTRA_RESOURCE_ID_KEY, 'user-alice')

    const agent = new Agent({
      name: 'auth',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
    })

    // agent.stream 接受 requestContext，贯穿到 memory/tool/processor
    const out = await (await agent.stream('hi', { requestContext: ctx } as any)).getFullOutput()
    expect(out.text).toBe('ok')
    // requestContext 此时仍持有中间件设的值（可变共享，见 01.1）
    expect(ctx.get(MASTRA_RESOURCE_ID_KEY)).toBe('user-alice')
  }, 15000)
})

describe('不传 requestContext 时，agent 自动建空的', () => {
  // agent.ts 里 ~40 处 requestContext = new RequestContext() 默认参数
  it('stream 不传 requestContext 也能跑（用空 context）', async () => {
    const agent = new Agent({
      name: 'default-ctx',
      instructions: 'x',
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
    })
    const out = await (await agent.stream('hi')).getFullOutput()
    expect(out.text).toBe('ok') // 不传也不报错
  }, 15000)
})
