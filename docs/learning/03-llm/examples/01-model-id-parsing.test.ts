import { describe, expect, it } from 'vitest'
import { parseModelRouterId } from '../../../../packages/core/src/llm/model/gateway-resolver'

/**
 * 03.1 · 模型 ID 解析 —— parseModelRouterId
 *
 * 源码：packages/core/src/llm/model/gateway-resolver.ts:8
 *
 * 把 "openai/gpt-4o" 这种字符串拆成 { providerId, modelId }。
 * 纯函数，没有网络调用，是模型路由的第一步。
 */

describe('标准 3 段格式（provider/model）', () => {
  it('"openai/gpt-4o" → { providerId: "openai", modelId: "gpt-4o" }', () => {
    expect(parseModelRouterId('openai/gpt-4o')).toEqual({ providerId: 'openai', modelId: 'gpt-4o' })
  })

  it('modelId 本身可以带斜杠（会被 join 回去）', () => {
    // idParts.slice(...).join('/') —— modelId 部分支持多段
    expect(parseModelRouterId('openai/org/gpt-4o')).toEqual({ providerId: 'openai', modelId: 'org/gpt-4o' })
  })
})

describe('带 gatewayPrefix 的 3 段格式', () => {
  it('netlify/openai/gpt-4o（gatewayPrefix="netlify"）', () => {
    expect(parseModelRouterId('netlify/openai/gpt-4o', 'netlify')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o',
    })
  })

  it('⚠️ 不带 gatewayPrefix 前缀会抛错', () => {
    expect(() => parseModelRouterId('wrong-prefix/openai/gpt-4o', 'netlify')).toThrow(/Expected netlify\//)
  })
})

describe('⭐ azure-openai 特例：2 段格式', () => {
  // 源码注释：Azure OpenAI uses 2-part format (azure-openai/deployment)
  it('azure-openai/my-deployment → providerId 固定为 azure-openai', () => {
    expect(parseModelRouterId('azure-openai/my-deployment', 'azure-openai')).toEqual({
      providerId: 'azure-openai',
      modelId: 'my-deployment',
    })
  })

  it('deployment 名字可以带斜杠', () => {
    expect(parseModelRouterId('azure-openai/team/my-deployment', 'azure-openai')).toEqual({
      providerId: 'azure-openai',
      modelId: 'team/my-deployment',
    })
  })
})

describe('⭐ provider-equals-gateway 特例：2 段格式', () => {
  // 源码注释：a gateway whose provider id is the same as its gateway id
  // (e.g. amazon-bedrock) uses a 2-part router id (gateway/model)
  it('amazon-bedrock/claude-3 → 2 段格式，无需第 3 段', () => {
    expect(parseModelRouterId('amazon-bedrock/claude-3', 'amazon-bedrock')).toEqual({
      providerId: 'amazon-bedrock',
      modelId: 'claude-3',
    })
  })
})

describe('错误场景', () => {
  it('没有斜杠 → 抛错（无法识别 provider）', () => {
    expect(() => parseModelRouterId('gpt-4o')).toThrow(/doesn't appear to contain a provider/)
  })

  /**
   * ⚠️ 容易误判的边界：'netlify/openai' 只有 2 段，但配合 gatewayPrefix='netlify'
   * 时并不会报错——因为它命中了「provider-equals-gateway」分支
   * （idParts[0] === gatewayPrefix），被当成 { providerId: 'netlify', modelId: 'openai' }。
   * 真正触发"段数不足"报错的，是第一段和 gatewayPrefix 不同名的 2 段输入。
   */
  it('2 段输入若第一段恰好等于 gatewayPrefix，不会报错（走 provider-equals-gateway 分支）', () => {
    expect(parseModelRouterId('netlify/openai', 'netlify')).toEqual({ providerId: 'netlify', modelId: 'openai' })
  })

  it('真正的段数不足：第一段不等于 gatewayPrefix 时才会抛错', () => {
    expect(() => parseModelRouterId('netlify/onlyOneMore', 'other-gateway')).toThrow(/Expected other-gateway\//)
  })
})
