# 05.2 控制流原语

> 源码：`packages/core/src/workflows/workflow.ts`（全部链式方法）；实现分派在 `workflows/handlers/control-flow.ts`
> 示例：[`examples/02-control-flow.test.ts`](./examples/02-control-flow.test.ts)
> 跑：`cd docs/learning/05-workflows/examples && npx vitest run 02`

全部链式方法，全部返回 `this`，全部最后要 `.commit()`。

**回顾：agent 的三层嵌套 workflow 用的就是这些原语：**

- `execution-workflow`：`.parallel().map().then()`
- `agentic-loop`：`.dowhile()`
- `agentic-execution`：`.then().map().foreach().then()...`

---

## 原语清单（带行号）

| 原语                     | 行   | 作用                  | handler               |
| ------------------------ | ---- | --------------------- | --------------------- |
| `.then(step)`            | 1690 | 顺序                  | `step.ts:70`          |
| `.sleep(ms)`             | 1735 | 等待时长              | `sleep.ts`            |
| `.sleepUntil(date)`      | 1774 | 等到时刻              | `sleep.ts`            |
| `.waitForEvent(...)`     | 1810 | 等外部事件            | —                     |
| `.map(config)`           | 1825 | 数据变换（隐式 step） | —                     |
| `.parallel([steps])`     | 2006 | 并发                  | `control-flow.ts:69`  |
| `.branch([[cond,step]])` | 2069 | 条件分支              | `control-flow.ts:270` |
| `.dowhile(step, cond)`   | 2125 | 先执行后判断循环      | `control-flow.ts:596` |
| `.dountil(step, cond)`   | 2173 | 循环直到条件成立      | `control-flow.ts:596` |
| `.foreach(step)`         | 2221 | 遍历数组              | `control-flow.ts:865` |
| `.commit()`              | 2289 | 收尾（必须）          | —                     |

---

## .then() —— 顺序（1690）

前一步的返回值 = 后一步的 `inputData`。

```ts
const a = createStep({ id: 'a', execute: async () => ({ n: 1 }) })
const b = createStep({ id: 'b', execute: async ({ inputData }) => ({ doubled: inputData.n * 2 }) })
wf.then(a).then(b).commit()
// b.inputData = { n: 1 }（a 的输出）→ { doubled: 2 }
```

---

## .parallel() —— 并发（2006）

多个 step 并发执行，各自的输出都进 `res.steps`。

```ts
wf.parallel([
  createStep({ id: 'a', execute: async () => ({ a: 1 }) }),
  createStep({ id: 'b', execute: async () => ({ b: 2 }) }),
]).commit()
// res.steps.a.output = { a: 1 }, res.steps.b.output = { b: 2 }
```

**agent 用法**：`execution-workflow` 用 `.parallel([prepareToolsStep, prepareMemoryStep])` 同时准备工具和记忆。

---

## ⚠️ .branch() —— 条件分支（2069）

**API 是 `[conditionFn, step]` 元组数组**，不是 `{when, then}`（容易记错）：

```ts
wf.branch([
  [({ inputData }) => inputData.go === 'yes', yesStep],
  [({ inputData }) => inputData.go === 'no', noStep],
]).commit()
```

条件为真的分支执行，假的跳过。`workflow.ts:2079` 用 `steps.map(([_cond, step]) => ...)` 解构元组。

---

## ⭐ .dowhile() / .dountil() —— 循环（2125 / 2173）

**这是 agent「自主循环」的全部秘密。** agentic-loop 就是一个 `.dowhile()`：

```ts
wf.dowhile(incStep, async ({ inputData }) => inputData.count < 3).commit()
```

先执行 step，再用 step 的输出判断是否再来一轮。**没有神秘的推理引擎——就是循环 + 停止条件。**

`dountil` 反过来：循环直到条件成立。两者共用 `control-flow.ts:596 executeLoop`。

---

## .foreach() —— 遍历（2221）

对上游产出的数组的每个元素执行一次 step。

```ts
wf.then(toArrayStep).foreach(handleOneStep).commit()
// toArrayStep 输出 { items: ['x','y','z'] } → foreach 对每个元素跑 handleOneStep
```

**agent 用法**：`agentic-execution` 用 `.foreach(toolCallStep)` 对模型返回的多个工具调用并发执行。并发度由 `resolveToolCallConcurrency` 决定（见 07）。

---

## .map() —— 数据变换（1825）

`.map(fn)` 传函数时，**创建一个隐式 step**（`workflow.ts:1847`），execute 就是那个函数。用于改写流向下游的数据，不必显式定义 step。

```ts
wf.map(async ({ inputData }) => ({ upper: inputData.s.toUpperCase() })).then(checkStep)
```

**agent 用法**：`agentic-execution` 用 `.map(map-tool-calls)` 在工具执行前算并发度。

⚠️ `.map` 还接受对象配置（`{key: {step, path}}` 等，`workflow.ts:1827-1870`），用于从特定 step 取值重组数据。函数形式最常用。

---

## 组合：模拟 agent 的 execution-workflow 形状

```ts
wf.parallel([prepToolsStep]) // 并发准备
  .map(async () => ({ tools: 2 })) // 整理结果
  .then(streamStep) // 主流程
  .commit()
```

这就是 `agent/workflows/prepare-stream/index.ts:184` 的形状（简化）。跑通它，你就理解了 agent 内部 workflow 的骨架。

---

## Debug 断点清单

| 断点                                   | 观察什么                                   |
| -------------------------------------- | ------------------------------------------ |
| `workflow.ts:1690/2006/2069/2125/2221` | 每个原语如何 push 进 stepFlow              |
| `handlers/control-flow.ts:69`          | `executeParallel` 怎么并发                 |
| `handlers/control-flow.ts:270`         | `executeConditional` 怎么判分支            |
| **`handlers/control-flow.ts:596`**     | **`executeLoop`——agentic 循环的核心**      |
| `handlers/control-flow.ts:865`         | `executeForeach` 怎么遍历                  |
| `workflow.ts:2289`                     | `commit` 把 stepFlow 编译成 executionGraph |

**推荐动作**：跑 `examples/02` 的 `dowhile` 用例，在 `control-flow.ts:596` 打断点，看循环条件怎么求值、循环体怎么重复进。这是理解「agent 自主循环」最直接的入口。

---

## 设计取舍与坑

- **`.branch` 是元组不是对象**：`[[cond, step]]`，最容易记错的一个。
- **`.dowhile` 是 agent 的心脏**：理解了它，agent 祛魅一半。
- **`.map(fn)` 是隐式 step**：不是纯函数变换，它真的建了一个 step（有 id、出现在 steps 里）。
- **`.foreach` 的并发**：默认对数组元素并发执行（受 concurrency 选项控制）。
- **数据流是「上一步输出 = 下一步 inputData」**：但 parallel/branch/foreach 的具体合并规则要查 handler 实现，别假设。
- **链式方法返回 `this`**：所以可以无限串，但忘了 `.commit()` 一切白搭。

---

## 后续细化 TODO

- [ ] `parallel` 多分支输出的合并规则（是 merge 还是各存各的）
- [ ] `branch` 多个条件同时为真时的行为
- [ ] `.dowhile` 的最大迭代次数保护（防死循环）
- [ ] `.foreach` 的 concurrency 选项与错误处理（一个元素失败全停？）
- [ ] `.map` 对象配置形式的 `{step, path}` / `{value, schema}` 用法
- [ ] `.sleep` / `.sleepUntil` / `.waitForEvent` 在 evented 引擎下的实现（定时唤醒）
- [ ] `handlers/control-flow.ts`（1378 行）逐个函数精读
