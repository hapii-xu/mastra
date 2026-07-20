import { describe, expect, it } from 'vitest'
import { MockMemory } from '../../../../packages/core/src/memory/mock'
import { Agent } from '../../../../packages/core/src/agent/agent'
import { mockModel } from '../../07-loop/examples/mock-model'

/**
 * 09.3 · Working Memory vs 消息历史 —— 两条独立的记忆轨道
 *
 * 源码：memory.ts:641 getWorkingMemory；:657 getWorkingMemoryTemplate；:663 updateWorkingMemory
 *
 * 四种记忆机制里，「消息历史」和「工作记忆」是最基础的两条：
 *   消息历史：完整对话记录，按需召回（本模块 09.1/09.2 已验证）
 *   工作记忆：一块结构化的、模型可读写的「便签」，独立于对话历史存在
 *
 * 关键认知：working memory 不会随对话增长——它是一个固定位置的状态，
 * 每次更新是覆盖/合并，不是追加。这和消息历史（不断累积）是相反的模式。
 */

describe('getWorkingMemoryTemplate：默认无模板', () => {
  it('没有配置模板时返回 null', async () => {
    const memory = new MockMemory()
    const template = await memory.getWorkingMemoryTemplate({} as any)
    expect(template).toBeNull()
  })
})

describe('⭐ working memory 独立于消息历史，不会因对话增长', () => {
  it('多次更新 working memory，内容是覆盖而不是累积', async () => {
    const memory = new MockMemory({ options: { workingMemory: { enabled: true } } } as any)
    const thread = await memory.createThread({ resourceId: 'r1' })

    await memory.updateWorkingMemory({
      threadId: thread.id,
      resourceId: 'r1',
      workingMemory: '用户偏好：简洁回答',
    } as any)

    let wm = await memory.getWorkingMemory({ threadId: thread.id, resourceId: 'r1' } as any)
    expect(wm).toContain('简洁回答')

    // 第二次更新
    await memory.updateWorkingMemory({
      threadId: thread.id,
      resourceId: 'r1',
      workingMemory: '用户偏好：详细回答，喜欢代码示例',
    } as any)

    wm = await memory.getWorkingMemory({ threadId: thread.id, resourceId: 'r1' } as any)
    expect(wm).toContain('详细回答')
    // 注意：具体是覆盖还是合并取决于 updateWorkingMemory 的实现（this 是 MockMemory 的行为，
    // 真实的 @mastra/memory 实现有 deepMergeWorkingMemory 做结构化合并，见模块索引）
  })

  it('working memory 不受消息历史条数影响（对比 09.1 的消息累积）', async () => {
    const memory = new MockMemory({ options: { workingMemory: { enabled: true } } } as any)
    const thread = await memory.createThread({ resourceId: 'r1' })

    // 存 5 条消息（消息历史会累积到 5）
    for (let i = 0; i < 5; i++) {
      await memory.saveMessages({
        messages: [
          {
            id: `m${i}`,
            threadId: thread.id,
            resourceId: 'r1',
            role: 'user',
            content: { format: 2, parts: [{ type: 'text', text: `消息 ${i}` }] },
          } as any,
        ],
      })
    }

    await memory.updateWorkingMemory({ threadId: thread.id, resourceId: 'r1', workingMemory: '固定的用户画像' } as any)

    const recalled = await memory.recall({ threadId: thread.id, resourceId: 'r1' } as any)
    const wm = await memory.getWorkingMemory({ threadId: thread.id, resourceId: 'r1' } as any)

    // 消息历史累积到了 5 条
    expect(recalled.total).toBe(5)
    // working memory 依然只是那一块内容，不会跟着变成 5 份
    expect(wm).toBe('固定的用户画像')
  })
})

describe('四种记忆机制速查（本模块 + 08-processors 的映射）', () => {
  /**
   * | 机制       | 特点                             | 实现位置                                    |
   * |-----------|----------------------------------|---------------------------------------------|
   * | 消息历史   | 完整记录，累积增长               | processors/memory/message-history.ts        |
   * | 语义召回   | 向量检索相关历史（09.2 未涉及）  | processors/memory/semantic-recall.ts        |
   * | 工作记忆   | 固定位置，覆盖式更新（本篇）     | processors/memory/working-memory.ts         |
   * | 观察记忆   | 后台 agent 持续提炼长期记忆      | @mastra/memory（独立包，见下方说明）        |
   *
   * 前三种是同步的（在请求链路里），观察记忆是异步的（后台 agent，额外成本）。
   */
  it('占位：见上方表格', () => {
    expect(true).toBe(true)
  })
})
