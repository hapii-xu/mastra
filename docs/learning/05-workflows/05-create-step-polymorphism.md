# 05.5 createStep 多态 —— 万物皆可成 step

> 源码：`workflows/workflow.ts:207-338`（6 个重载）；`workflow.ts:608 createStepFromTool`
> 示例：[`examples/05-create-step-polymorphism.test.ts`](./examples/05-create-step-polymorphism.test.ts)
> 跑：`cd docs/learning/05-workflows/examples && npx vitest run 05`

**这是整个框架组合性的来源。** `createStep` 接受 4 种东西：

| 传入           | 重载行  | 说明                             |
| -------------- | ------- | -------------------------------- |
| 普通 step 配置 | 207     | 最常见                           |
| **Agent**      | 239/251 | agent 变 step（需 model，见 06） |
| **Tool**       | 264     | 工具变 step（本节）              |
| **Processor**  | 281     | 处理器变 step（见 08）           |
| **Workflow**   | 305     | 嵌套 workflow 变 step（本节）    |

**agent run 本身就是 workflow，而 workflow 里又能嵌套 agent/tool/workflow/processor** —— 无限组合。

---

## 一、Tool 作为 step

```ts
const myTool = createTool({
  id: 'addOne',
  inputSchema: z.object({ n: z.number() }),
  outputSchema: z.object({ result: z.number() }),
  execute: async input => ({ result: input.n + 1 }), // ⚠️ 位置参数
})
wf.then(createStep(myTool)).commit()
```

### ⭐ v1.0 breaking change（最重要的坑）

`createStepFromTool`（`workflow.ts:608`）调用方式是 **`tool.execute(inputData, toolContext)`**——**位置参数**，不是 `{ context }`。源码注释原文（`workflow.ts:655` 附近）：

> BREAKING CHANGE v1.0: Pass raw input as first arg, context as second

所以 **tool 作为 step 时，execute 读第一个位置参数（inputData）**：

```ts
// ❌ 作为 step 用时这样会拿到 context = undefined
execute: async ({ context }) => ({ result: context.n + 1 })

// ✅ 位置参数
execute: async input => ({ result: input.n + 1 })
```

⚠️ **同一个 tool，给 agent 直接用 vs 给 workflow 当 step，execute 签名不一样**。这是个真实的移植陷阱。

### tool 必须有 inputSchema 和 outputSchema

`createStepFromTool`（`workflow.ts:613`）：

```ts
if (!params.inputSchema || !params.outputSchema) {
  throw new Error('Tool must have input and output schemas defined')
}
```

`{} as any` 不行——schema 要真实描述入参，否则 inputData 不会流进 execute。

---

## 二、Workflow 作为 step（嵌套）

```ts
const child = createWorkflow({ id: 'child', ... })
  .then(createStep({ id: 'double', execute: async ({ inputData }) => ({ doubled: inputData.n * 2 }) }))
  .commit();

const parent = createWorkflow({ id: 'parent', ... })
  .then(createStep(child))    // ← 子 workflow 变 step
  .commit();
```

判定与执行：`default.ts:130 isNestedWorkflowStep`、`:248 executeWorkflowStep`。子 workflow 的输出出现在父的 `res.steps.<childId>` 里。

---

## 三、组合：Tool + Workflow 混搭

```ts
const pipeline = createWorkflow({ id: 'pipe', ... })
  .then(createStep(addOneTool))      // tool
  .then(createStep(timesTenWf))      // 子 workflow
  .commit();
```

一个 workflow 里能任意混搭 tool / workflow / processor / agent。

---

## 四、Processor / Agent 作为 step（预告）

- **Processor**（重载 `:281`）：处理器变 step。`combineProcessorsIntoWorkflow`（`agent.ts:1455`）就是用这个把 processor 列表编译成 workflow。详见 08。
- **Agent**（重载 `:239/251`）：agent 变 step。需要 model，详见 06。这是「子 agent 委派」的一种形式。

---

## 五、Debug 断点清单

| 断点                  | 观察什么                                                       |
| --------------------- | -------------------------------------------------------------- |
| `workflow.ts:207-338` | 6 个 `createStep` 重载                                         |
| `workflow.ts:345`     | `isToolStep` 判别 → `createStepFromTool`                       |
| **`workflow.ts:608`** | **`createStepFromTool`：位置参数调用、schema 校验**            |
| `workflow.ts:655`     | `params.execute(inputData, toolContext)`——v1.0 breaking change |
| `default.ts:130`      | `isNestedWorkflowStep`                                         |
| `default.ts:248`      | `executeWorkflowStep` 嵌套执行                                 |

**推荐动作**：跑 `examples/05`，在 `workflow.ts:608` 打断点，看 tool 怎么被包成 step；在 `:655` 看 execute 怎么被位置参数调用。

---

## 六、设计取舍与坑

- **tool-as-step 的位置参数**是 v1.0 breaking change——tool 在 agent 和 workflow 里 execute 签名不同，移植时注意。
- **tool 必须有 inputSchema/outputSchema**，否则 `createStepFromTool` 抛错。
- **嵌套 workflow 没有深度限制**（理论上），但每层都有 span/快照开销。
- **`createStep` 是组合性核心**：理解了它，就理解了为什么「agent run 是 workflow，workflow 里又能嵌 agent」。
- **Agent-as-step 需要 model**：本节不演示（要 mock 模型），见 06。
- **Processor-as-step 是 08 的基础**：processor 列表→workflow 编译全靠它。

---

## 七、后续细化 TODO

- [ ] Agent-as-step 完整示例（带 mock model，见 06）
- [ ] Processor-as-step 与 `combineProcessorsIntoWorkflow`（见 08）
- [ ] 嵌套 workflow 的快照/重试隔离：子 workflow 失败要不要重试父？
- [ ] tool 在 agent-use 和 step-use 下的统一签名（为什么 v1.0 做了这个 breaking change）
- [ ] `createStep` 的 `agentOrToolOptions`（第二个参数）有什么
- [ ] 嵌套深度的性能/可观测性影响
