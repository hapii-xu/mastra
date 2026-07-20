import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { RequestContext } from '../../../../packages/_internal-core/src/request-context'
import { mockModel } from './mock-model'

/**
 * 06.2 · ⭐ 动态解析（DynamicArgument）—— 多租户的关键
 *
 * 源码：agent.ts 里 model / memory / instructions / tools 都是
 *       DynamicArgument<T, TRequestContext> —— 可以是值，也可以是「按请求解析的函数」。
 *
 * 企业级价值：不同租户用不同模型/记忆/工具，靠 requestContext 分流。
 *
 * 断点：getLLM (agent.ts:2665)、getMemory (:1905)、getInstructions 等，
 *       它们都接 requestContext，按需解析。
 */

describe('model 可以是函数（按请求选模型）', () => {
  it('根据 requestContext 动态返回不同模型', async () => {
    const cheapModel = mockModel([{ kind: 'text', text: 'cheap-model' }])
    const proModel = mockModel([{ kind: 'text', text: 'pro-model' }])

    const agent = new Agent({
      name: 'router',
      instructions: 'x',
      // DynamicArgument：函数接收 { requestContext }，按租户/计划选模型
      model: async ({ requestContext }: any) => {
        const plan = requestContext.get('plan')
        return plan === 'pro' ? (proModel as any) : (cheapModel as any)
      },
    })

    // free 用户 → cheap
    const ctxFree = new RequestContext()
    ctxFree.set('plan', 'free')
    const outFree = await (await agent.stream('hi', { requestContext: ctxFree } as any)).getFullOutput()
    expect(outFree.text).toBe('cheap-model')

    // pro 用户 → pro
    const ctxPro = new RequestContext()
    ctxPro.set('plan', 'pro')
    const outPro = await (await agent.stream('hi', { requestContext: ctxPro } as any)).getFullOutput()
    expect(outPro.text).toBe('pro-model')
  }, 20000)
})

describe('instructions 可以是函数（按请求生成系统提示词）', () => {
  it('根据 requestContext 的租户名定制指令', async () => {
    const agent = new Agent({
      name: 'dyn-instr',
      instructions: async ({ requestContext }: any) => {
        const tenant = requestContext.get('tenantId') ?? 'guest'
        return `你是 ${tenant} 公司的专属助手，用中文回答`
      },
      model: mockModel([{ kind: 'text', text: 'ok' }]) as any,
    })

    const ctx = new RequestContext()
    ctx.set('tenantId', 'Acme')
    const instr = await agent.getInstructions({ requestContext: ctx })
    expect(String(instr)).toContain('Acme')
  }, 15000)
})

describe('静态值 vs 动态函数 都合法', () => {
  it('静态 model（对象）—— 最常见', async () => {
    const agent = new Agent({
      name: 'static',
      instructions: '静态指令',
      model: mockModel([{ kind: 'text', text: 'static' }]) as any,
    })
    const out = await (await agent.stream('hi')).getFullOutput()
    expect(out.text).toBe('static')
  }, 15000)

  it('动态 model（函数）—— 多租户/AB 实验', async () => {
    const agent = new Agent({
      name: 'dynamic',
      instructions: 'x',
      model: async () => mockModel([{ kind: 'text', text: 'dynamic' }]) as any,
    })
    const out = await (await agent.stream('hi')).getFullOutput()
    expect(out.text).toBe('dynamic')
  }, 15000)
})

describe('多租户模式：一个 Agent 定义服务多个租户', () => {
  /**
   * 企业级典型：一个 Agent 配置，靠 DynamicArgument + requestContext
   * 为每个租户解析出不同的 model / memory / instructions。
   * 不用为每个租户 new 一个 Agent。
   */
  it('同一 Agent，不同 requestContext → 不同行为', async () => {
    const agent = new Agent({
      name: 'multi-tenant',
      instructions: async ({ requestContext }: any) => `服务于 ${requestContext.get('tenant')}`,
      model: async ({ requestContext }: any) =>
        mockModel([{ kind: 'text', text: `reply-to-${requestContext.get('tenant')}` }]) as any,
    })

    for (const tenant of ['Acme', 'Globex']) {
      const ctx = new RequestContext()
      ctx.set('tenant', tenant)
      const out = await (await agent.stream('hi', { requestContext: ctx } as any)).getFullOutput()
      expect(out.text).toBe(`reply-to-${tenant}`)
    }
  }, 20000)
})
