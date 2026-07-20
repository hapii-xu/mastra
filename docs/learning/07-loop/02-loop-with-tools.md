# 07.2 ⭐ agentic 循环：调工具 → 继续 → 完成

> 源码：`loop/workflows/agentic-loop/index.ts:24`（`.dowhile` 停止条件）；`loop/workflows/agentic-execution/index.ts:113`（8 个 step）
> 示例：[`examples/02-loop-with-tools.test.ts`](./examples/02-loop-with-tools.test.ts)
> 跑：`cd docs/learning/07-loop/examples && npx vitest run 02`

**这是全模块最好的一课：「Agent 自主循环」的全部秘密就是一个 `.dowhile()`，停止条件看 `finishReason`。**

---

## 一、循环规则

```
模型返回 finishReason: 'tool-calls'  → loop 执行工具 → 再调模型
模型返回 finishReason: 'stop'        → loop 结束
```

```ts
// mock 模型按顺序消费 responses
model: mockModel([
  { kind: 'tool-call', toolCallId: 'c1', toolName: 'calc', input: { a: 2, b: 3 } }, // 第 1 轮
  { kind: 'text', text: '结果是 5' }, // 第 2 轮
])
```

`examples/02` 验证：工具被调 1 次 → loop 跑 2 轮 → 用最终文本结束。

**没有 magic**——就是循环 + 停止条件。

---

## 二、`agentic-loop` 的 `.dowhile`

`loop/workflows/agentic-loop/index.ts:24`：

```ts
.dowhile(agenticExecutionWorkflow, async ({ inputData }) => { /* 停止条件 */ })
.commit()
```

停止条件看上一轮的 `finishReason` 和 `isTaskCompleteStep` 的结果。

### snapshot 三态策略（支持 resumeStream）

`shouldPersistSnapshot`（`agentic-loop/index.ts:70` 附近）：

- `pending` 时创建初始记录
- `suspended`/`paused` 时更新
- **`running` 时不写**——避免覆盖已有的 suspended 快照

这是为了支持流式 + 人工审批 + 恢复。**企业级 HITL 的关键。**

---

## 三、`agentic-execution` —— 一轮循环的 8 个 step

`loop/workflows/agentic-execution/index.ts:113-140`：

| step                      | 文件                               | 作用                             |
| ------------------------- | ---------------------------------- | -------------------------------- |
| `llmExecutionStep`        | `llm-execution-step.ts`（2179 行） | **调模型**，本模块最大文件       |
| `map-tool-calls`          | inline                             | **算工具并发度**                 |
| `toolCallStep`            | `tool-call-step.ts`（1298 行）     | **执行工具**（`.foreach`）       |
| `llmMappingStep`          | `llm-mapping-step.ts`              | 结果映射                         |
| `backgroundTaskCheckStep` | —                                  | 后台任务检查                     |
| `signalDrainStep`         | —                                  | 信号排空                         |
| `isTaskCompleteStep`      | —                                  | **任务完成判定**（影响 dowhile） |
| `goalStep`                | `goal-step.ts`                     | 目标评估                         |

---

## 四、⭐ 工具并发度的精妙设计

`loop/workflows/agentic-execution/tool-call-concurrency.ts` + `index.ts:113` 注释：

> 并发度按**本步的有效工具集**（`stepActiveTools`）算，**不是**按模型实际调用的工具算。
>
> 一个注册了的、需要审批/会挂起的工具，**即使模型这一轮没调它**，也必须强制串行——否则会被错误地允许并发。

`resolveToolCallConcurrency()` 综合 `requireToolApproval`、`tools`、`activeTools`、`configuredConcurrency` 决定。

**企业级注意**：注册一个审批工具会让该 agent 的**所有**工具串行。性能敏感时考虑拆分 agent。

---

## 五、工具结果的形状（实测）

工具结果在 `output.steps[i].toolResults`，每个 toolResult 是：

```ts
{
  type: 'tool-result',
  runId,
  from: 'AGENT',
  payload: { args, toolCallId, toolName, result: { ... } }  // ← 工具输出在 payload.result
}
```

⚠️ **不是 `.output`**——工具的实际返回值在 `.payload.result`。

`output.toolResults`（顶层）**确实存在**，是跨所有轮次的聚合数组——`output.steps[i].toolResults` 是每一轮各自的那部分，两者的 `payload.result` 内容一致，顶层只是把所有轮次的结果拼在一起，方便不关心分轮细节时直接读取。`examples/02/03` 用断言确认了这一点（含一次真实的自我纠正——最初的草稿曾错误地记录成「顶层没有」，后来直接探测顶层字段才发现记录有误）。

---

## 六、Debug 断点清单

| 断点                                                 | 观察什么                                     |
| ---------------------------------------------------- | -------------------------------------------- |
| **`agentic-loop/index.ts:24` 的 dowhile 条件闭包**   | **最有价值**：循环为什么继续/停止，F5 反复走 |
| `agentic-execution/llm-execution-step.ts` 的 execute | **每一轮真正发给模型的 messages 和 tools**   |
| `agentic-execution/tool-call-concurrency.ts`         | 并发度算出来是几？为什么？                   |
| `agentic-execution/tool-call-step.ts` 的 execute     | 工具执行上下文                               |

**推荐动作**：跑 `examples/02` 的「多轮工具调用」用例（调 2 次工具再结束），在 `agentic-loop/index.ts:24` 的 dowhile 条件打断点，看它被求值 3 次（2 次继续、1 次停止）。

---

## 七、设计取舍与坑

- **`.dowhile` 是「自主」的全部秘密**：循环 + 停止条件，没有神秘推理引擎。
- **停止看 `finishReason`**：`tool-calls` 继续，`stop` 结束。
- **审批工具让全部工具串行**：按「注册的工具」而非「调用的工具」判并发——正确但有性能代价。
- **工具结果的真实值在 `.payload.result`**（字段名不是 `output`），`output.toolResults`（顶层聚合）和 `steps[i].toolResults`（分轮）都能找到它。
- **snapshot 三态**：改这块要非常小心，关系到 resumeStream。

---

## 八、后续细化 TODO

- [ ] `.dowhile` 停止条件的完整逻辑：`isTaskCompleteStep` 怎么影响它？maxSteps 在哪拦？
- [ ] `llm-execution-step.ts`（2179 行）：prompt 怎么拼、active tools 怎么选
- [ ] `tool-call-step.ts`（1298 行）：工具挂起、错误、超时怎么处理
- [ ] `resolveToolCallConcurrency` 的完整决策矩阵
- [ ] 多工具并发的实际行为（`.foreach` 的 concurrency）
