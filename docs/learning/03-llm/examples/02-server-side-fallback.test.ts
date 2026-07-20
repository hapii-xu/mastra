import { describe, expect, it } from 'vitest'
import {
  getServerSideFallbackInfo,
  resolveResponseModelId,
} from '../../../../packages/core/src/llm/model/server-side-fallback'

/**
 * 03.2 · ⭐ 服务端 fallback 检测 —— 你请求 A 模型，网关可能实际用了 B
 *
 * 源码：packages/core/src/llm/model/server-side-fallback.ts
 *
 * 当配置了 providerOptions.anthropic.fallbacks 且主模型的安全分类器拒绝了
 * 某轮对话，Anthropic API 会透明地在 fallback 模型上重试，并把替换信息
 * 报告在 providerMetadata.anthropic.iterations 里（fallback_message 条目）。
 *
 * ⭐ 企业级意义：做成本核算和可观测性时，不能只信任你「请求」的模型 ID，
 * 要用这里的解析结果才知道「实际服务这轮对话」的模型是谁。
 */

describe('getServerSideFallbackInfo：从 providerMetadata 里挖出 fallback 信息', () => {
  it('没有 anthropic.iterations → undefined（没有 fallback 发生）', () => {
    expect(getServerSideFallbackInfo(undefined)).toBeUndefined()
    expect(getServerSideFallbackInfo({})).toBeUndefined()
    expect(getServerSideFallbackInfo({ anthropic: {} })).toBeUndefined()
  })

  it('iterations 不是数组 → undefined（防御性处理）', () => {
    expect(getServerSideFallbackInfo({ anthropic: { iterations: 'not-an-array' } })).toBeUndefined()
  })

  it('⭐ 有 fallback_message 类型的 iteration → 提取出 fallback 模型 id', () => {
    const providerMetadata = {
      anthropic: {
        iterations: [
          { type: 'normal_message', model: 'claude-primary' },
          { type: 'fallback_message', model: 'claude-fallback' },
        ],
      },
    }
    expect(getServerSideFallbackInfo(providerMetadata)).toEqual({ model: 'claude-fallback' })
  })

  it('多个 fallback_message 时取最后一个（reverse().find）', () => {
    const providerMetadata = {
      anthropic: {
        iterations: [
          { type: 'fallback_message', model: 'first-fallback' },
          { type: 'fallback_message', model: 'second-fallback' },
        ],
      },
    }
    // 源码用 [...iterations].reverse().find(...) —— 找到的是数组里最后出现的那个
    expect(getServerSideFallbackInfo(providerMetadata)).toEqual({ model: 'second-fallback' })
  })

  it('fallback_message 存在但没带 model 字段 → 返回空对象（不是 undefined）', () => {
    const providerMetadata = { anthropic: { iterations: [{ type: 'fallback_message' }] } }
    expect(getServerSideFallbackInfo(providerMetadata)).toEqual({})
  })
})

describe('⭐ resolveResponseModelId：成本核算/追踪要用这个，不要直接信任 responseModelId', () => {
  it('没有 fallback → 用响应自带的 model id', () => {
    expect(resolveResponseModelId(undefined, 'claude-requested')).toBe('claude-requested')
  })

  it('⭐ 有 fallback → 优先用 fallback 报告的模型 id（覆盖响应自带的）', () => {
    const providerMetadata = {
      anthropic: { iterations: [{ type: 'fallback_message', model: 'claude-actual-fallback' }] },
    }
    // 即使 responseModelId 说是 'claude-requested'，实际服务这轮的是 fallback 模型
    expect(resolveResponseModelId(providerMetadata, 'claude-requested')).toBe('claude-actual-fallback')
  })

  it('企业级用法：成本核算要按 resolveResponseModelId 的结果分摊，不能按请求参数', () => {
    // 模拟：请求时声明用 'claude-opus'（贵），但服务端因安全策略 fallback 到了 'claude-haiku'（便宜）
    const providerMetadata = {
      anthropic: { iterations: [{ type: 'fallback_message', model: 'claude-haiku' }] },
    }
    const actualModel = resolveResponseModelId(providerMetadata, 'claude-opus')

    // 如果成本核算按 'claude-opus' 定价，会算错——必须用 actualModel
    expect(actualModel).toBe('claude-haiku')
    expect(actualModel).not.toBe('claude-opus')
  })
})
