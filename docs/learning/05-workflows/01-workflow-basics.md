# 05.1 Workflow 基础 —— 定义、提交、运行

> 源码：`packages/core/src/workflows/workflow.ts`（4546 行）；`workflows/create.ts`（工厂）
> 示例：[`examples/01-workflow-basics.test.ts`](./examples/01-workflow-basics.test.ts)
> 跑：`cd docs/learning/05-workflows/examples && npx vitest run 01`

**workflows 是整个框架的执行底座。** 最重要的认知：**agent 运行时就是三层嵌套 workflow**。学懂这一节，06-agent 那一万行才能读懂。

---

## 一、三个核心概念

| 概念         | 类             | 位置               | 说明                                                   |
| ------------ | -------------- | ------------------ | ------------------------------------------------------ |
| **Workflow** | `Workflow`     | `workflow.ts:1544` | **定义**：步骤图结构。一个 Workflow 可复用产生多个 Run |
| **Run**      | `Run`          | `workflow.ts:2978` | **一次执行**：有 runId、状态、快照                     |
| **Step**     | `createStep()` | `workflow.ts:207`  | 把一段逻辑变成图里的节点                               |

### 最小例子

```ts
const a = createStep({ id: 'a', execute: async ({ inputData }) => ({ fromInput: inputData.v, a: 1 }) })
const b = createStep({ id: 'b', execute: async ({ inputData }) => ({ fromA: inputData.a, b: 2 }) })

const wf = createWorkflow({ id: 'chain', inputSchema, outputSchema, steps: [] }).then(a).then(b).commit()

const run = await wf.createRun()
const res = await run.start({ inputData: { v: 'hello' } })
```

**链式数据流**：`input.v` → step a 输出 `{fromInput:'hello', a:1}` → 成为 step b 的 `inputData` → b 输出 `{fromA:1, b:2}`。

---

## 二、结果形状（实测，不是猜的）

`run.start()` 返回的 `WorkflowResult`：

| 字段                         | 内容                                              |
| ---------------------------- | ------------------------------------------------- |
| `res.status`                 | `'success'` / `'suspended'` / `'failed'`          |
| **`res.result`**             | **最后一步的输出**（整体结果）                    |
| **`res.steps.<id>.output`**  | **每一步的输出**                                  |
| `res.steps.<id>.status`      | 每一步的状态                                      |
| `res.input`                  | 工作流输入                                        |
| `res.stepExecutionPath`      | 实际执行路径                                      |
| `res.traceId` / `res.spanId` | 可观测性标识（没配 observability 时为 undefined） |

⚠️ **`runId` 在 `Run` 实例上，不在 `res` 上**：`run.runId`，不是 `res.runId`。

```ts
expect(res.result).toEqual({ fromA: 1, b: 2 }) // 最后一步
expect(res.steps.a.output).toEqual({ fromInput: 'hello', a: 1 })
expect(run.runId).toBe('my-id') // runId 属于 Run
```

---

## 三、`.commit()` 是必须的

```ts
const wf = createWorkflow({...}).then(a);   // 没 commit
await wf.createRun();  // ❌ 抛 "Uncommitted step flow changes detected. Call .commit()"
```

`.commit()` 把链式构建的 `stepFlow` 编译成 `executionGraph`（`workflow.ts:2289`）。所有控制流方法（`.then/.parallel/.branch/...`）都返回 `this`，最后必须 `.commit()`。

---

## 四、Workflow（定义） vs Run（执行）—— 一对多

```ts
const run1 = await wf.createRun()
const run2 = await wf.createRun()
expect(run1.runId).not.toBe(run2.runId) // 两个独立执行
```

**同一个 Workflow 定义可以产生任意多个独立 Run**，互不干扰（`examples/01` 有用例）。

### `createRun({ runId })` 复用 Run 实例

`createRun` 内部用 `#runs: Map<runId, Run>` 缓存（`workflow.ts:2347/2369`）：

```ts
const r1 = await wf.createRun({ runId: 'fixed' })
const r2 = await wf.createRun({ runId: 'fixed' })
expect(r1).toBe(r2) // 同一个实例
```

这正是 **suspend 后 resume 能找回同一个 Run** 的基础（见 05.3）。

---

## 五、Run 的状态

| status        | 含义                        |
| ------------- | --------------------------- |
| `'success'`   | 正常完成                    |
| `'suspended'` | 挂起（等恢复，见 05.3）     |
| `'failed'`    | 出错（或重试耗尽，见 05.4） |

step 抛错 → `status: 'failed'`（默认会重试，重试机制见 05.4）。

---

## 六、注册到 Mastra：拿到存储/日志/可观测性

**裸 `createWorkflow` 没有 mastra**——能 `start`，但 **resume 会失败**（见 05.3）。注册到 `new Mastra({ workflows })` 后，自动获得 `InMemoryStore` 等基础设施。

```ts
const wf = createWorkflow({...}).then(a).commit();
const m = new Mastra({ workflows: { myWf: wf } });
const w = m.getWorkflow('myWf');   // 带存储/日志的实例
```

`Mastra` 构造时给每个 workflow 调 `__registerMastra(this)`（`mastra/index.ts:1310/1332`，见 11）。

---

## 七、createWorkflow 的形状

`createWorkflow` 在 `workflows/create.ts:26`（不是 `workflow.ts`——单独拆出来打破 ESM 循环 `workflow.ts → agent.ts → workflow.ts`）。

```ts
createWorkflow({
  id,
  inputSchema,       // zod schema，工作流输入
  outputSchema,      // zod schema，工作流输出
  steps: [],         // 初始 steps（通常空，用 .then 加）
  retryConfig?,      // { attempts, delay }，见 05.4
  // ...
})
```

⚠️ **`retryConfig` 的字段是 `attempts` 不是 `retries`**（`default.ts:769` 读的是 `attempts`）。写错字段名 → 静默不重试。

---

## 八、Debug 断点清单

| 断点                         | 观察什么                                            |
| ---------------------------- | --------------------------------------------------- |
| `workflows/create.ts:26`     | `createWorkflow` 工厂                               |
| `workflows/workflow.ts:1544` | `Workflow` 类                                       |
| `workflows/workflow.ts:2978` | `Run` 类                                            |
| `workflows/workflow.ts:2320` | `createRun`：runId 生成、`#runs` 缓存、快照条件读取 |
| `workflows/workflow.ts:3231` | `_start`：校验 + 调 engine.execute                  |
| `workflows/workflow.ts:2289` | `commit`：stepFlow → executionGraph                 |

**推荐动作**：跑 `examples/01`，在 `workflow.ts:2320`（createRun）打断点，看 `executionGraph` 长什么样——你链式写的 `.then().then()` 编译成了什么数据结构。

---

## 九、设计取舍与坑

- **定义/执行分离**：Workflow 是定义（可复用），Run 是执行（有状态）。这是 suspend/resume、并发、监控的基础。
- **`commit()` 不可忘**：没 commit 就 createRun 直接抛错（好消息是抛得早）。
- **结果形状**：`res.result`（最终）vs `res.steps.<id>.output`（每步）。`runId` 在 Run 不在 res。
- **裸 workflow 没 mastra**：start 能跑，resume 会抛 "No snapshot found"。HITL 场景必须注册到 Mastra。
- **`retryConfig.attempts`** 不是 `retries`——常见笔误，静默不重试。
- **`__MASTRA_VERSION__`**：core 源码里有个编译期常量，examples 的 vitest config 用 `define` 注入了 `'0.0.0'`。

---

## 十、后续细化 TODO

- [ ] `executionGraph` / `serializedStepGraph` 的完整数据结构
- [ ] `WorkflowResult` 全部字段（`stepExecutionPath`、`input`）
- [ ] `inputSchema` / `outputSchema` 的校验时机（validateInputs 选项）
- [ ] `createRun` 的 `resourceId` / `disableScorers` / `pubsub` 参数
- [ ] 一个 Workflow 注册到多个 Mastra 实例的隔离性
