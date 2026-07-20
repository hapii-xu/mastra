# 05.3 Suspend / Resume —— 人机协作（HITL）的基础

> 源码：`workflows/step.ts`（品牌类型 `:19-22`）；`workflows/workflow.ts`（`resume :3864`，`_resume ~3985`）；`workflows/types.ts`（`suspendedPaths:351, resumeLabels:352`）
> 示例：[`examples/03-suspend-resume.test.ts`](./examples/03-suspend-resume.test.ts)
> 跑：`cd docs/learning/05-workflows/examples && npx vitest run 03`

企业级刚需：**危险操作要人工确认、需要补充信息**。suspend 让 workflow 挂起，等人类响应后 resume 继续。

---

## 一、⭐ 品牌类型：伪造不了挂起结果

`workflows/step.ts:19-22`：

```ts
declare const SuspendBrand: unique symbol
export type InnerOutput = void & { readonly [SuspendBrand]: never }
```

`suspend()` 的返回类型带一个**只存在于类型层的品牌符号**。业务代码**无法伪造**一个「挂起结果」——只能真的调 `suspend()`。类型系统保证了挂起语义不被绕过。

```ts
execute: async ({ suspend, resumeData }) => {
  if (resumeData?.approved) return { done: true } // 正常返回
  return suspend({ question: '审批通过吗？' }) // 只能这样挂起
}
```

---

## 二、suspend → status: 'suspended'

```ts
const run = await w.createRun()
const res = await run.start({ inputData: {} })
expect(res.status).toBe('suspended') // 挂起
```

挂起状态记录在快照里（`types.ts`）：

| 字段             | 类型                                        | 含义                                 |
| ---------------- | ------------------------------------------- | ------------------------------------ |
| `suspendedPaths` | `Record<string, number[]>`                  | 挂在步骤图的哪条路径（数字是图索引） |
| `resumeLabels`   | `Record<string, { stepId, forEachIndex? }>` | 恢复标签                             |

---

## 三、resume —— 恢复执行

```ts
const res = await run.resume({ resumeData: { approved: true }, step: askStep })
expect(res.status).toBe('success')
```

**4 种定位恢复点的方式**（`workflow.ts:3864` 的 `step` 参数）：

- step 对象（最常见）
- 路径数组（step path）
- 字符串 id
- label

### `resumeData` 怎么进 step

resume 时，step 的 `execute` 再次执行，这次 `resumeData` 有值：

```ts
execute: async ({ resumeData, suspend }) => {
  if (resumeData?.approved) return { done: true } // ← resume 时走这里
  return suspend({ q: 'ok?' }) // ← start 时走这里
}
```

### ⚠️ resume 时 step 的返回值流向下游

**恢复后 step 的输出会替换流向下游的数据。** 如果下游 step 依赖原始输入的某些字段，恢复时必须把它们带出去：

```ts
execute: async ({ inputData, resumeData, suspend }) => {
  if (resumeData?.approved) {
    return { approved: true, amount: inputData.amount } // ← 必须带 amount，下游要用
  }
  return suspend({ amount: inputData.amount })
}
```

`examples/03` 的「退款 workflow」用例演示了不带字段出去会怎样（refund 拿到 `amount: undefined`）。

---

## 四、⚠️ resume 必须有存储（关键约束）

**裸 workflow（没注册到 Mastra）能 start，但 resume 会抛 "No snapshot found"。**

`_resume`（`workflow.ts:3985`）的实现：

```ts
const workflowsStore = await this.#mastra?.getStorage()?.getStore('workflows')
const snapshot = await workflowsStore?.loadWorkflowSnapshot({ workflowName, runId })
if (!snapshot) throw new Error('No snapshot found for this workflow run: ...')
```

**suspend 把 run 留在内存 `#runs` Map 里，但 resume 从存储读快照。** 没 mastra = 没存储 = resume 找不到。

**结论：HITL 场景必须把 workflow 注册到 `new Mastra({ workflows })`。**

---

## 五、为什么 suspend 不需要存储、resume 需要？

这是个不对称设计：

- **suspend**：在 `#runs` Map 里留着 Run 实例（`workflow.ts:2369`），`start` 直接返回 `suspended` 状态，不必落盘
- **resume**：跨进程/跨时间恢复，必须从存储读快照重建状态

这解释了为什么 `createRun` 的快照读取是有条件的（`workflow.ts:2380-2383`）——只有 `shouldPersistSnapshot || runId` 时才读存储。

---

## 六、企业级 HITL 实战：退款审批

```ts
const approve = createStep({
  id: 'approve',
  execute: async ({ inputData, resumeData, suspend }) => {
    if (resumeData?.approved) return { approved: true, amount: inputData.amount }
    return suspend({ amount: inputData.amount, userId: inputData.userId })
  },
})
const refund = createStep({
  id: 'refund',
  execute: async ({ inputData }) => ({ refunded: true, amount: inputData.amount }),
})

const m = new Mastra({ workflows: { refundWf: wf.then(approve).then(refund).commit() } })
const w = m.getWorkflow('refundWf')

const run = await w.createRun()
const r1 = await run.start({ inputData: { amount: 100, userId: 'u1' } })
// r1.status === 'suspended' → 把 runId 返给前端，等用户点「批准」

// 用户批准后（可能是另一个请求）：
const r2 = await run.resume({ resumeData: { approved: true }, step: approve })
// r2.status === 'success', r2.steps.refund.output === { refunded: true, amount: 100 }
```

**生产要点**：

- `start` 拿到 `runId`，返给前端
- 前端审批后，用同一个 `runId` 调 `resume`（跨请求/跨进程，靠存储找回状态）
- 所以必须用持久化存储（PG/Redis），不能是内存

---

## 七、Debug 断点清单

| 断点                             | 观察什么                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| `workflows/step.ts:19`           | `SuspendBrand`——品牌类型定义                                           |
| `workflows/workflow.ts:3864`     | `resume` 入口                                                          |
| **`workflows/workflow.ts:3985`** | **`_resume`：`loadWorkflowSnapshot` + `:3989` 抛 "No snapshot found"** |
| `workflows/types.ts:351`         | `suspendedPaths` 结构                                                  |
| `workflows/workflow.ts:2380`     | `createRun` 的快照条件读取                                             |

**推荐动作**：跑 `examples/03` 的「裸 workflow resume 抛错」用例，在 `workflow.ts:3989` 打断点，亲眼看到没 mastra 时 snapshot 为 undefined。这是理解「HITL 需要存储」最直接的方式。

---

## 八、设计取舍与坑

- **品牌类型防伪造**：漂亮的类型设计，`suspend()` 是产生挂起结果的唯一途径。
- **resume 要存储**：suspend 不落盘、resume 读盘——不对称。HITL 必须注册 Mastra + 用持久化存储。
- **resume 后的输出流向下游**：恢复时 step 必须把下游需要的字段带出去，否则下游拿到 undefined。
- **4 种定位方式**：step 对象 / 路径 / id / label。嵌套 foreach 场景用 `label + forEachIndex`。
- **`resumeAsync` 命名混乱**：HTTP 层暴露为 `resume-no-wait`/`resumeNoWait()`（见 05.4），统一推迟到 v2。
- **跨进程 resume**：多实例部署时，resume 请求可能打到另一台机器——全靠存储。这是 evented 引擎存在的理由之一。

---

## 九、后续细化 TODO

- [ ] `suspendedPaths` 的路径索引机制（数字数组怎么对应步骤图）
- [ ] `resumeLabels` + `forEachIndex`：foreach 内部挂起的精确定位
- [ ] 跨进程 resume 的完整链路：HTTP → server → loadSnapshot → resume
- [ ] `shouldPersistSnapshot` 的三态策略（pending/suspended 写、running 不写）
- [ ] resume 的 `label` 机制 vs `step` 定位的区别
- [ ] 多个 suspend 点的 workflow 怎么管理
- [ ] 超时处理：suspend 后永远不 resume 怎么办（保留策略，见 10）
