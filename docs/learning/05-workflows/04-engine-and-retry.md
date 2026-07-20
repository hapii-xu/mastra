# 05.4 执行引擎、重试、事件流

> 源码：`workflows/default.ts`（`DefaultExecutionEngine:55`，`execute:712`）；`workflows/handlers/`
> 示例：[`examples/04-execution-engine.test.ts`](./examples/04-execution-engine.test.ts)
> 跑：`cd docs/learning/05-workflows/examples && npx vitest run 04`

---

## 一、两套执行引擎

| 引擎               | 类                       | 位置                             | 用途               |
| ------------------ | ------------------------ | -------------------------------- | ------------------ |
| **direct（默认）** | `DefaultExecutionEngine` | `default.ts:55`                  | 进程内执行         |
| **evented**        | `EventedExecutionEngine` | `evented/execution-engine.ts:19` | 跨进程 pubsub 协调 |
| （抽象）           | `ExecutionEngine`        | `execution-engine.ts:59`         | 基类               |

### 切换方式

1. 环境变量 `MASTRA_EVENTED_EXECUTION=true`
2. **声明 `schedule` 自动转 evented**（`create.ts:34`）——这个隐式行为容易让人困惑

### ⚠️ 为什么默认 direct

evented 路径会把 `requestContext` 做 **JSON round-trip**，**丢函数和循环引用**（见 01.1 §四）。direct 保留所有运行时对象。这也正是 agent 的 `runScope` 存在的理由（见 07）。

---

## 二、执行链路（direct）

```
run.start()                              workflow.ts:3328
  └─ _start()                            workflow.ts:3231
       ├─ getOrCreateSpan(WORKFLOW_RUN)
       ├─ 校验 input / initialState / requestContext
       └─ executionEngine.execute()      default.ts:712
            └─ executeEntry()            default.ts:1105 → handlers/entry.ts:242
                 ├─ 按 StepFlowEntry 类型分派：
                 │    parallel    → handlers/control-flow.ts:69
                 │    conditional → handlers/control-flow.ts:270
                 │    loop        → handlers/control-flow.ts:596
                 │    foreach     → handlers/control-flow.ts:865
                 │    普通 step   → handlers/step.ts:70
                 ├─ executeStepWithRetry()  default.ts:425
                 └─ persistStepUpdate()     handlers/entry.ts:142
```

`DefaultExecutionEngine` 的 `executeParallel` 等方法（`default.ts:1085-1105`）全是一行转发到 `handlers/`。**读实现直接去 `handlers/`。**

---

## 三、⭐ 重试机制（`retryConfig`）

```ts
createWorkflow({ id, ..., retryConfig: { attempts: 3, delay: 0 } })
```

⚠️ **字段是 `attempts`，不是 `retries`**（`default.ts:769` 读的是 `attempts`）。写错 → 静默不重试。

### 重试循环（`default.ts:425` `executeStepWithRetry`）

```ts
for (let i = 0; i < params.retries + 1; i++) {     // :450
  try { return await execute(); }
  catch (e) {
    const isNonRetryable = e instanceof MastraNonRetryableError;   // :458
    if (isNonRetryable || i === params.retries) { ... break; }     // :460
    // 否则等 delay 后重试
  }
}
```

`examples/04` 验证：普通错误重试到上限（`attempts=3` 表示首次+2次重试），耗尽则 `failed`。

---

## 四、⭐ `MastraNonRetryableError` —— 重试逃生舱

**抛它 → 第一次就放弃，不重试。** 关联 01.2 §五的「原型链三连」：

```
setPrototypeOf (error/index.ts:151)
  → instanceof MastraNonRetryableError (default.ts:458)
  → 跳过重试 (default.ts:460)
  → 结果打 nonRetryable: true (default.ts:491)
```

```ts
execute: async () => {
  throw new MastraNonRetryableError('参数非法，重试也没用') // 只执行 1 次
}
```

**实战含义**：工具遇到「重试无意义」的错（参数非法、权限不足、资源不存在），抛 `MastraNonRetryableError` 而非普通 `Error`，省下无意义的重试和成本。evented 引擎在 `evented/step-executor.ts:328` 镜像了同样逻辑。

⚠️ **判重试必须用原始 `e`**，不能用 `getErrorFromUnknown(e)` 之后的值（后者对非 Error 入参会丢原型链，见 01.2）。

---

## 五、watch() —— 事件流（`workflow.ts:3809`）

`run.watch(cb)` 订阅执行事件，返回 unsubscribe 函数：

```ts
const unsub = run.watch(event => {
  // event.type: step 开始/结束等（WorkflowStreamEvent，见 types.ts）
})
await run.start({ inputData: {} })
unsub()
```

`stream()`（`workflow.ts:3553`）也基于 watch，把事件包成 `ReadableStream<WorkflowStreamEvent>`。这是 workflow 流式输出的基础。

---

## 六、span 生命周期（坑）

`_start`（`workflow.ts:3231`）创建 `WORKFLOW_RUN` span，但 **span 在 `executionEngine.execute()` 内部结束，不在 `_start`**。排查 trace 不闭合时要注意这点（见 12）。

---

## 七、Debug 断点清单

| 断点                    | 观察什么                                          |
| ----------------------- | ------------------------------------------------- |
| `default.ts:712`        | `execute`：拿到的 `ExecutionGraph` 长什么样       |
| `handlers/entry.ts:242` | **核心分派点**：每个 entry 的 kind 怎么选 handler |
| `handlers/entry.ts:142` | `persistStepUpdate`：每步后写快照                 |
| **`default.ts:425`**    | **`executeStepWithRetry` 重试循环**               |
| `default.ts:458`        | `instanceof MastraNonRetryableError` 判重试       |
| `default.ts:769`        | `attempts` 字段读取（为什么不是 retries）         |
| `workflow.ts:3809`      | `watch` 事件订阅                                  |

**推荐动作**：跑 `examples/04` 的两个重试对比用例（普通错 vs NonRetryable），在 `default.ts:425` 打断点，单步走完循环。`attempts` 差异（3 vs 1）一眼看懂重试。

---

## 八、设计取舍与坑

- **`retryConfig.attempts` 不是 `retries`**：常见笔误，静默不重试。
- **默认 direct 不是 evented**：因为 evented 丢 requestContext 里的函数。多实例部署前必须搞清这个取舍。
- **声明 `schedule` 隐式转 evented**（`create.ts:34`）：不知道这点会困惑「为什么我的函数丢了」。
- **span 跨模块结束**：trace 不完整时往这查。
- **`MastraNonRetryableError` 靠 instanceof**：所以原型链修复（`setPrototypeOf`）是 load-bearing 的。
- **evented 引擎镜像了重试逻辑**（`step-executor.ts:328`）：两套引擎都要维护，改一处别忘另一处。
- **`resumeAsync` 命名混乱**：HTTP 暴露为 `resume-no-wait`，统一推迟 v2。

---

## 九、后续细化 TODO

- [ ] `retryConfig.delay` 的退避策略（线性？指数？）
- [ ] `WorkflowEventProcessor`（evented，2853 行大 switch）的事件流转
- [ ] direct vs evented 的完整能力差异矩阵——**决定部署架构**
- [ ] step 级 `retryConfig` vs workflow 级的优先级
- [ ] `runScorersForStep`（`handlers/step.ts:549`）每步后跑 scorer 的性能影响（见 13）
- [ ] watch 事件的完整类型（`WorkflowStreamEvent`）
- [ ] span 内部标记（`tracingPolicy.internal`）怎么打开调试（见 12）
