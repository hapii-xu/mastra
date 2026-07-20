/**
 * 内联 v3 mock 模型 —— 让 agent.stream 在不调真实 provider 的情况下走通 loop/ 源码。
 *
 * 为什么不用仓库的 agent/__tests__/mock-model.ts？因为它传递依赖 msw（仅测试态），
 * 根目录没装。这个内联版按 AI SDK v5 的 chunk 协议手动发流，零额外依赖。
 *
 * v3 chunk 协议（从 packages/core/src/loop/test-utils/tool-media.ts 等处归纳）：
 *   stream-start → response-metadata → [text-start/delta/end | tool-call] → finish
 *   finishReason: 'stop'（结束）/ 'tool-calls'（让 loop 继续执行工具后再调模型）
 */
export type MockResponse =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; toolCallId: string; toolName: string; input: Record<string, unknown> }

const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } }

/** 造一个按顺序消费 responses 的 v3 mock 模型（每次 doStream 吐下一个 response） */
export function mockModel(responses: MockResponse[]) {
  let count = 0
  return {
    specificationVersion: 'v2' as const,
    provider: 'mock',
    modelId: 'mock-1',
    supportedUrls: {},
    doGenerate: async () => ({
      text: '',
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      request: {},
      response: undefined as any,
      warnings: undefined,
    }),
    doStream: async () => {
      const resp = responses[count++] ?? responses[responses.length - 1]
      const chunks: any[] = [
        { type: 'stream-start', warnings: [] },
        { type: 'response-metadata', id: `id-${count}`, modelId: 'mock', timestamp: new Date(0) },
      ]
      if (resp.kind === 'text') {
        chunks.push({ type: 'text-start', id: 'text-1' })
        chunks.push({ type: 'text-delta', id: 'text-1', delta: resp.text })
        chunks.push({ type: 'text-end', id: 'text-1' })
        chunks.push({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage })
      } else {
        chunks.push({
          type: 'tool-call',
          id: resp.toolCallId,
          toolCallId: resp.toolCallId,
          toolName: resp.toolName,
          input: JSON.stringify(resp.input),
        })
        chunks.push({ type: 'finish', finishReason: 'tool-calls', usage })
      }
      return {
        stream: new ReadableStream({
          start(controller) {
            chunks.forEach(ch => controller.enqueue(ch))
            controller.close()
          },
        }),
      }
    },
  }
}
