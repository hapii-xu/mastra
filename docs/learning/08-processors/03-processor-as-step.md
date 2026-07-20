# 08.3 ⭐ Processor 也是 Workflow Step

> 源码：`workflows/workflow.ts:281`（`createStep` 的 Processor 重载）；`agent.ts:1455`（`combineProcessorsIntoWorkflow`，私有）
> 示例：[`examples/03-processor-as-step.test.ts`](./examples/03-processor-as-step.test.ts)
> 跑：`cd docs/learning/08-processors/examples && npx vitest run 03`

**「一切皆 workflow」这一认知在本模块的落地。** processor 不是一个独立的执行阶段，它被编译成了普通的 workflow step，享有 workflow 的全部能力（重试、并行、可观测性），也受 workflow 的全部约束（见 05）。

---

## 一、`createStep(processor)`

```ts
const myProcessor = { id: 'my-proc', processInput: async ({ messages }) => messages }
const step = createStep(myProcessor)
```

回顾 05.5：`createStep` 接受 4 种东西——普通配置、Tool、Workflow、**Processor**。本篇补上 Processor 这一种。

---

## 二、⚠️ step id 会自动加前缀

```ts
createStep({ id: 'my-proc', ... }).id
// → 'processor:my-proc'，不是 'my-proc'
```

**这是实测发现的细节**——`createStep` 会给来自 processor 的 step 自动加上 `processor:` 前缀，用于和其他类型的 step（tool、workflow）在同一张执行图里区分来源。排查 workflow 执行图里某个 id 对应哪个原始对象时，看到 `processor:` 前缀就知道它来自一个 processor。

---

## 三、`combineProcessorsIntoWorkflow`（agent 内部机制）

`agent.ts:1455`，私有方法。Agent 把 `inputProcessors`/`outputProcessors` 列表**编译成一条 workflow**：

```
[p1, p2, p3] → createWorkflow(...).then(createStep(p1)).then(createStep(p2)).then(createStep(p3)).commit()
```

这解释了 08.1 观察到的现象——**处理器顺序执行**正是因为它们被编译成了一条 `.then()` 链。

---

## 四、这解释了什么

- **为什么 processor 有「重试」概念**：因为它是 workflow step，天然继承 workflow 的重试机制（05.4）。
- **为什么 processor 可以抛 `MastraNonRetryableError`**：同样因为它是 workflow step。
- **为什么 evented 引擎的约束也影响 processor**：如果 processor 引用了不可序列化的对象（如 class 实例），在 evented 模式下可能因 JSON round-trip 而出问题（关联 01.1 §四）。

---

## 五、Debug 断点清单

| 断点                                                                          | 观察什么                            |
| ----------------------------------------------------------------------------- | ----------------------------------- |
| `workflow.ts:281` `createStep` 的 Processor 重载                              | id 前缀在哪里被加上                 |
| `agent.ts:1455` `combineProcessorsIntoWorkflow`（需先修构建才能跑 core 测试） | processor 列表怎么变成 `.then()` 链 |

**推荐动作**：跑 `examples/03`，在 `createStep` 内部（`workflow.ts:281` 附近）打断点，观察 id 前缀的拼接逻辑。

---

## 六、设计取舍与坑

- **id 前缀是内部实现细节**：不要在业务代码里依赖 `processor:` 这个具体字符串，它可能随版本变化，本文档记录它是为了帮你在调试执行图时认出来源，不是让你去匹配它。
- **processor 顺序 = workflow 顺序**：想理解「为什么我的 processor 这么排列执行」，答案就是「因为你在 `inputProcessors: []` 数组里就是这么排的，它们被 `.then()` 串起来了」。
- **processor 继承了 workflow 的复杂度**：这既是优点（复用成熟的执行引擎）也是认知负担（需要理解 05 的全部内容才能完全理解 processor 的边界行为）。

---

## 七、后续细化 TODO

- [ ] `combineProcessorsIntoWorkflow` 的完整实现（需要先修好 core 构建）
- [ ] processor workflow 是否共享 agent 主 workflow 的 tracingPolicy（internal span 标记）
- [ ] 多个 output processor 之间能否并行（还是恒定顺序执行）
- [ ] processor workflow 失败时，是否会影响外层 agent workflow 的状态
