# 07-loop 可跑示例

**3 个文件，14 个用例，零构建，~5s 跑完。** 用内联 mock 模型走通真实 loop/ 源码，不调真实 provider。

## 怎么跑

```bash
cd docs/learning/07-loop/examples
npx vitest run                  # 全跑
npx vitest run 02-loop-with-tools   # 只跑招牌课
```

复用 05 的 vitest alias 配置（`vitest.config.ts`，8 个 alias 绕开构建）。

## mock 模型

`mock-model.ts` 是内联的 v3 mock：按顺序消费一组 responses，每个 response 是「文本」或「工具调用」。按 AI SDK v5 chunk 协议手动发流，零额外依赖。

**为什么不用仓库的 `agent/__tests__/mock-model.ts`**：它传递依赖 `msw`（仅测试态，根目录没装）。

```ts
model: mockModel([
  { kind: 'tool-call', toolCallId: 'c1', toolName: 'calc', input: { a: 2, b: 3 } },
  { kind: 'text', text: '结果是 5' },
])
```

## 文件清单

| 文件                         | 用例数 | 学什么                                                                | 文档                                   |
| ---------------------------- | ------ | --------------------------------------------------------------------- | -------------------------------------- |
| `01-loop-basics.test.ts`     | 4      | loop 是 agent 下游、getFullOutput 产物、generate=stream+getFullOutput | [01](../01-loop-basics.md)             |
| `02-loop-with-tools.test.ts` | 4      | ⭐ **招牌课**：tool-calls 继续、stop 结束、多轮工具                   | [02](../02-loop-with-tools.md)         |
| `03-loop-steps.test.ts`      | 6      | output.steps 脚印（N 工具=N+1 step）、toolCalls/toolResults 形状      | [03](../03-steps-runcscope-network.md) |

## 怎么用来 debug

**最有价值的练习**：跑 `02-loop-with-tools` 的「多轮工具调用」用例（调 2 次工具再结束），在这些断点观察：

1. **`loop/workflows/agentic-loop/index.ts:24` 的 `.dowhile` 条件闭包**——看循环被求值 3 次（2 次继续、1 次停止）
2. `loop/workflows/agentic-execution/llm-execution-step.ts` 的 execute——每一轮发给模型什么
3. `llm/model/model.loop.ts:361`——agent 把什么交给了 loop

## 探到的真实形状（写进文档的依据）

- 工具结果：`output.steps[i].toolResults[j].payload.result`（不是顶层 `.toolResults`，不是 `.output`）
- toolCall：`step.toolCalls[0].payload.toolName`
- 每轮循环一个 step：调 N 次工具 = N+1 个 `output.steps`
