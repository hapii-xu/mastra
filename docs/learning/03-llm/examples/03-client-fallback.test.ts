import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { mockModel } from './mock-model'

/**
 * 03.3 · ⭐ 客户端模型 fallback —— 主模型挂了自动切备用
 *
 * 源码：agent.ts:2665 getLLM；:2743 resolveModelConfig；:2945 getModelList
 *       agent.ts:2785 normalizeModelFallbacks（私有，标准化 fallback 数组）
 *
 * 这是与 03.2「服务端 fallback」不同的机制：
 *   服务端 fallback：provider（如 Anthropic）自己在内部切换模型
 *   客户端 fallback（本篇）：Mastra agent 层面配置多个模型，逐个尝试
 *
 * 企业级价值：多模型容灾——主力模型限流/故障时，自动切换到备用模型，
 * 不需要应用层写重试逻辑。
 */

/** 一个总是失败的 mock 模型，模拟 provider 故障/限流 */
function failingModel(errorMessage = 'primary model down') {
  return {
    specificationVersion: 'v2' as const,
    provider: 'mock',
    modelId: 'failing',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error(errorMessage)
    },
    doStream: async () => {
      throw new Error(errorMessage)
    },
  }
}

describe('模型数组配置：getModelList 保留每个模型的 id', () => {
  it('配置数组后，getModelList 能取回带 id 的模型列表', async () => {
    const primary = mockModel([{ kind: 'text', text: 'from-primary' }])
    const backup = mockModel([{ kind: 'text', text: 'from-backup' }])

    const agent = new Agent({
      name: 'multi-model',
      instructions: 'x',
      model: [
        { id: 'primary', model: primary as any },
        { id: 'backup', model: backup as any },
      ],
    })

    const list = await agent.getModelList()
    expect(list?.length).toBe(2)
    expect(list?.map((m: any) => m.id)).toEqual(['primary', 'backup'])
  }, 15000)
})

describe('⭐ 主模型失败 → 自动切换备用模型', () => {
  /**
   * 断点：agent.ts 里模型执行失败后的重试逻辑（loop 内部的 model fallback 处理）。
   * 这是「多模型容灾」的核心验证——不需要应用层写 try/catch 重试，
   * agent 配置了 fallback 数组后自动处理。
   */
  it('primary 抛错 → agent 自动用 backup 模型完成请求', async () => {
    const primary = failingModel()
    const backup = mockModel([{ kind: 'text', text: 'from-backup' }])

    const agent = new Agent({
      name: 'failover',
      instructions: 'x',
      model: [
        { id: 'primary', model: primary as any },
        { id: 'backup', model: backup as any },
      ],
    })

    const output: any = await (await agent.stream('hi')).getFullOutput()

    // 最终结果来自 backup，不是 primary（因为 primary 抛错了）
    expect(output.text).toBe('from-backup')
  }, 15000)

  it('两个都失败 → 最终抛错（没有更多 fallback 可用）', async () => {
    const primary = failingModel('primary down')
    const backup = failingModel('backup also down')

    const agent = new Agent({
      name: 'all-fail',
      instructions: 'x',
      model: [
        { id: 'primary', model: primary as any },
        { id: 'backup', model: backup as any },
      ],
    })

    await expect(agent.stream('hi').then(r => r.getFullOutput())).rejects.toThrow()
  }, 15000)
})

describe('企业级模式：成本路由 + 容灾结合（关联 06.2 动态解析）', () => {
  /**
   * 06.2 学的是「按 requestContext 选模型」（一个模型）。
   * 本篇是「配置多个模型做 fallback」（模型数组）。
   * 两者可以结合：动态函数返回一个 fallback 数组，而不是单个模型。
   */
  it('动态函数返回 fallback 数组：按租户等级配置不同的容灾链', async () => {
    const proPrimary = mockModel([{ kind: 'text', text: 'pro-primary-reply' }])
    const proBackup = mockModel([{ kind: 'text', text: 'pro-backup-reply' }])

    const agent = new Agent({
      name: 'tenant-aware-fallback',
      instructions: 'x',
      model: async () => [
        { id: 'pro-primary', model: proPrimary as any },
        { id: 'pro-backup', model: proBackup as any },
      ],
    })

    const list = await agent.getModelList()
    expect(list?.map((m: any) => m.id)).toEqual(['pro-primary', 'pro-backup'])
  }, 15000)
})
