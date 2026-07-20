# 07.1 agentic loop 基础

> 源码：`loop/loop.ts:11`（入口）；`loop/workflows/agentic-loop/index.ts:24`（`.dowhile`）；`loop/workflows/stream.ts`
> 示例：[`examples/01-loop-basics.test.ts`](./examples/01-loop-basics.test.ts)
> 跑：`cd docs/learning/07-loop/examples && npx vitest run 01`

**06-agent 是编排与配置，07-loop 是执行。** `agent.stream()` 最终把控制权交给这里：模型调用、工具执行、循环终止判定，全在这个模块。

---

## 一、⭐ 核心事实：loop 是 agent 的下游

完整调用链：

```
agent.stream()                        agent/agent.ts:7859
  └─ #execute()                       agent/agent.ts:6467
       └─ execution-workflow          agent/workflows/prepare-stream/index.ts:184
            └─ streamStep
                 └─ MastraLLMVNext.stream()   llm/model/model.loop.ts:106
                      └─ loop()              llm/model/model.loop.ts:361 → loop/loop.ts:11
                           └─ workflowLoopStream()           loop/workflows/stream.ts
                                └─ createAgenticLoopWorkflow()  loop/workflows/agentic-loop/index.ts:24
                                     .dowhile(agenticExecution, 停止条件)
```

**`llm/model/model.loop.ts:361` 是全框架最值得打断点的地方之一**——agent 准备好的一切，在这里以最终形态交给 agentic 循环。

---

## 二、入口 `loop()`

`loop/loop.ts:11`。基本是参数解构 + 转发：

```ts
loop() → workflowLoopStream() (loop/workflows/stream.ts) → createAgenticLoopWorkflow()
```

从 import 就能看出这个模块的位置——它是 `error`、`logger`、`observability`、`processors`、`stream/base/output` 的汇流处。

---

## 三、最小可跑例子（内联 mock 模型）

```ts
const agent = new Agent({
  name: 'basic',
  instructions: '你是个测试 agent',
  model: mockModel([{ kind: 'text', text: '你好' }]) as any,
})
const output = await (await agent.stream('随便说点什么')).getFullOutput()
expect(output.text).toContain('你好')
```

**为什么用内联 mock**：仓库的 `agent/__tests__/mock-model.ts` 传递依赖 `msw`（仅测试态，根目录没装）。`examples/mock-model.ts` 按 AI SDK v5 chunk 协议手动发流，零额外依赖。

### v3 chunk 协议（mock 要发的格式）

```
stream-start → response-metadata → [text-start/delta/end | tool-call] → finish
```

- `finishReason: 'stop'`（文本，结束循环）
- `finishReason: 'tool-calls'`（让 loop 执行工具后再调模型，见 07.2）

---

## 四、`getFullOutput()` 的产物

`agent.stream()` 返回 `MastraModelOutput`，`await getFullOutput()` 拿到 `FullOutput`：

| 字段                                 | 内容                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `output.text`                        | 最终文本                                                                      |
| `output.finishReason`                | `'stop'` / `'tool-calls'` / ...                                               |
| `output.usage` / `output.totalUsage` | token 用量（成本核算，见 12）                                                 |
| **`output.steps`**                   | **每轮循环一个 step**（见 07.3）                                              |
| `output.toolCalls` / `toolResults`   | **顶层就有**，是跨所有轮次的聚合数组（每个 step 上也有各自那一轮的，见 07.3） |

⚠️ **`agent.generate` 本质 = `stream` + `getFullOutput()`**（`agent.ts:7291`），没有独立的非流式实现。generate 路径的 mock 需要 `doGenerate` 的另一种格式（content 数组）。

---

## 五、Debug 断点清单

| 断点                                      | 观察什么                                                |
| ----------------------------------------- | ------------------------------------------------------- |
| `loop/loop.ts:11`                         | `loop()` 入口                                           |
| **`llm/model/model.loop.ts:361`**         | **`loop()` 调用处——agent 准备的一切进入 loop 的交界点** |
| `loop/workflows/stream.ts`                | `workflowLoopStream`、runScope 桥接                     |
| `loop/workflows/agentic-loop/index.ts:24` | `.dowhile` 循环本体                                     |

**推荐动作**：跑 `examples/01`，在 `model.loop.ts:361` 打断点，看 agent 把什么交给了 loop。

---

## 六、设计取舍与坑

- **loop 是 agent 的下游**：agent 编排，loop 执行。理解了这条链，agent 祛魅一半。
- **mock 模型要按 v3 协议发流**：`stream-start`/`response-metadata`/`text-*`/`finish`，finishReason 决定循环走向。
- **`generate` = `stream` + `getFullOutput()`**：不是独立实现。
- **`output.steps` 是 loop 的脚印**：每轮循环一个 step，调试循环次数看这里（见 07.3）。
- **`loop/test-utils/`（~16k 行）是夹具不是源码**：看 LOC 统计别被误导。

---

## 七、后续细化 TODO

- [ ] `loop()` 的完整参数（`LoopOptions`，loop/types.ts）
- [ ] `workflowLoopStream` 怎么把 loop 接到 agent 的 streamStep
- [ ] `createAgenticLoopWorkflow` 的 `shouldPersistSnapshot` 三态策略（支持 resumeStream）
- [ ] `MastraLLMVNext`（llm/model/model.loop.ts）和 loop 的完整交互
