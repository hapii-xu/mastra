# 07.3 steps 数组、runScope、network

> 源码：`loop/workflows/agentic-loop/`、`loop/run-scope-*.ts`、`loop/network/index.ts`
> 示例：[`examples/03-loop-steps.test.ts`](./examples/03-loop-steps.test.ts)
> 跑：`cd docs/learning/07-loop/examples && npx vitest run 03`

---

## 一、output.steps：loop 的脚印

每次 `getFullOutput()` 的 `output.steps` 记录了 loop 的每一轮——**每轮循环一个 step**：

| 场景                 | step 数 |
| -------------------- | ------- |
| 不调工具（直接回答） | 1       |
| 调 1 次工具再回答    | 2       |
| 调 2 次工具再回答    | 3       |

```ts
// examples/03 验证
expect(output.steps.length).toBe(2) // 调 1 次工具 = 2 轮
```

**调试循环次数的第一现场**：agent 跑了多少轮，看 `output.steps.length`。

### 每轮 step 的内容

工具轮的 step 同时有 `toolCalls` 和 `toolResults`：

```ts
step.toolCalls[0] = { type: 'tool-call', payload: { toolCallId, toolName, args } }
step.toolResults[0] = { type: 'tool-result', payload: { args, toolCallId, toolName, result } }
```

`output.totalUsage` 累加所有轮次的 token（成本核算）。

---

## 二、⭐ runScope —— 跨 step 传 class 实例（全框架最易混的一处）

### 问题

workflow step 之间的数据要过 JSON（evented 引擎下），但 `MessageList`、Tools、闭包**过不去**。

### 解法：用 scope 对象在闭包里传

`loop/run-scope-keys.ts`、`run-scope-access.ts`、`hydrate-run-scope.ts`。

### ⚠️ 有两个不同的 scope，极易混淆

`agent/workflows/prepare-stream/index.ts:86-99` 的注释专门解释了这点：

| scope                    | 归属                                          | 特征                             |
| ------------------------ | --------------------------------------------- | -------------------------------- |
| **prepare-stream scope** | `agent/workflows/prepare-stream/run-scope.ts` | 闭包局部                         |
| **agentic loop scope**   | `loop/run-scope-*.ts`                         | **Mastra 注册的、按 runId 索引** |

桥接：`hydrateRunScopeFromInternal`（`loop/workflows/stream.ts`）。

**看到 `runScope` 先确认是哪个**。这是 `MASTRA_EVENTED_EXECUTION` 默认 direct 的根本原因——evented 路径 JSON round-trip 会丢这些对象。

---

## 三、network —— 多 Agent 协作

`loop/network/index.ts`（2708 行）。入口 `agent.network()`（`agent.ts:7102`）/ `agent.resumeNetwork()`。

### 核心机制：合成「Routing Agent」调度

- `getRoutingAgent()` —— `loop/network/index.ts:169`
- `new Agent({ name: 'Routing Agent' })` —— `:249`
- `createNetworkLoop()` —— network 自己的 workflow
- 校验 `loop/network/validation.ts`（824 行）

### ⚠️ 已知限制（源码硬编码）

`loop/network/index.ts:58` 原文：

> Observational Memory is not supported with agent network. Agent network does not propagate the threadId/resourceId context Observational Memory requires. Disable observationalMemory before using agent.network().

**用 network 就不能用 observational memory**（见 09）。企业级选型要知道这个取舍。

输出：`MastraAgentNetworkStream`（`stream/MastraAgentNetworkStream.ts`，见 04）。

---

## 四、子 Agent 的三种形态（到这里可以对比了）

| 形态              | 实现                                | 特点                             |
| ----------------- | ----------------------------------- | -------------------------------- |
| **Agent as tool** | `listAgentTools`（`agent.ts:4490`） | 父 agent 主导，子 agent 是个工具 |
| **SubAgent 接口** | `agent/subagent.ts`                 | 比完整 Agent 轻的契约            |
| **Network**       | `loop/network/index.ts`             | Routing Agent 动态调度           |

---

## 五、network 没有独立导出（过期信息）

**不存在 `agent/network/` 目录**（实现在 `loop/network/`）。`package.json` 的 `./network/vNext` 导出**已失效**——指向 `dist/network/vNext/`，但 `src/network/` 不存在。network 目前只能通过 `agent.network()` 用。

---

## 六、Debug 断点清单

| 断点                                                            | 观察什么                                |
| --------------------------------------------------------------- | --------------------------------------- |
| `output.steps` 组装处（`stream/base/output.ts`）                | 每轮循环怎么变成一个 step               |
| **`loop/workflows/stream.ts` 的 `hydrateRunScopeFromInternal`** | **两个 scope 怎么桥接**——搞懂这个就通了 |
| `loop/network/index.ts:169` `getRoutingAgent`                   | network 的合成 Routing Agent            |
| `loop/network/index.ts:58`                                      | observational memory 互斥的报错         |

**推荐动作**：跑 `examples/03` 的「调 1/2 次工具」用例，对比 `output.steps.length`（2 vs 3），在 dowhile 条件打断点看求值次数。

---

## 七、设计取舍与坑

- **`output.steps` 是 loop 的脚印**：循环次数、每轮的 toolCalls/toolResults 都在这。
- **两个 runScope 极易混淆**：prepare-stream（闭包局部）vs loop（Mastra 注册、按 runId）。这是全框架最该单开一篇的点。
- **network 与 observational memory 互斥**：硬约束，选型前必须知道。
- **`MASTRA_EVENTED_EXECUTION` 默认 false 的根因**：runScope 里的 class 实例过不了 JSON。
- **network 没有独立导出**：只能 `agent.network()`。

---

## 八、后续细化 TODO

- [ ] **两个 runScope 的完整对照** + `hydrateRunScopeFromInternal` 桥接（跨 06/07，最值得单开一篇）
- [ ] `output.steps` 每轮的完整字段（content、sources、files...）
- [ ] network 全套：Routing Agent 的 prompt、调度决策、`run-command-tool`
- [ ] `signalDrainStep` + `agent/signals.ts` 的信号系统
- [ ] `backgroundTaskCheckStep` + `background-tasks/` 的关系
- [ ] `goalStep` + `agent/goal/` 的目标驱动（关联 13）
