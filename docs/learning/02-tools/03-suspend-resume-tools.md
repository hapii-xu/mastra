# 02.3 工具级 suspend/resume —— HITL 的另一半

> 源码：`tool.ts:332-345`（suspend 包装）；`:436-444`（resumeData 校验）；`:449-454`（suspendSchema 校验）
> 示例：[`examples/03-suspend-resume-tools.test.ts`](./examples/03-suspend-resume-tools.test.ts)
> 跑：`cd docs/learning/02-tools/examples && npx vitest run 03`

05.3 学的是 **workflow 级**的 suspend/resume（品牌类型、resume 要存储）。这里是 **tool 自己的** suspend/resume schema——工具可以声明「挂起时传什么」「恢复时收什么」，独立于外层 workflow 的挂起机制。

---

## 一、suspendSchema：声明挂起时传什么

```ts
const approve = createTool({
  id: 'approve',
  inputSchema: z.object({ amount: z.number() }),
  outputSchema: z.object({ approved: z.boolean() }),
  suspendSchema: z.object({ amount: z.number(), reason: z.string() }),
  execute: async (inputData, context) => {
    if (!context?.resumeData) {
      return context.suspend({ amount: inputData.amount, reason: '金额超过阈值' })
    }
    return { approved: true }
  },
})
```

**⚠️ `suspendData` 会按 `suspendSchema` 校验**（`tool.ts:449-454`）——漏传 schema 要求的字段（如 `reason`）会返回 `ValidationError`，而不是静默通过。

---

## 二、resumeData：恢复时收到什么

```ts
resumeSchema: z.object({ approved: z.boolean() }),
execute: async (inputData, context) => {
  if (context?.resumeData) {
    return { approved: context.resumeData.approved };
  }
  return context.suspend({ amount: inputData.amount });
}
```

`resumeData` 同样会按 `resumeSchema` 校验（`tool.ts:439-444`）——类型不对（比如传字符串而非 boolean）会被拦截。

---

## 三、requireApproval：静态与条件式

```ts
// 静态：一律需要审批
requireApproval: true

// 条件式：dry-run 不需要审批
requireApproval: async ({ isDryRun }) => !isDryRun
```

`tool.ts:126-146`。不设置时默认 `false`（`tool.ts:286`）。

`needsApprovalFn`（`tool.ts:156`）是运行时解析后的版本——**不是你自己设置的**，而是框架在 `requireApproval` 是函数时自动生成，或由 MCP client 包装 server 级 `requireToolApproval` 时设置。文档注释明确说"prefer the `requireApproval` option"。

---

## 四、和 workflow 级 suspend 的关系

```
workflow 级 suspend（05.3）：整个 step 挂起，品牌类型防伪造，resume 要存储
tool 级 suspend（本篇）：   工具内部调 context.suspend()，有自己的 schema
```

**工具的 `context.suspend` 最终会调用外层 workflow/loop 提供的挂起机制**——tool 级只是加了一层 schema 校验和数据组织，底层挂起语义仍是 05.3 学的那套。

---

## 五、Debug 断点清单

| 断点              | 观察什么                                                              |
| ----------------- | --------------------------------------------------------------------- |
| `tool.ts:332-345` | suspend 包装：`suspendData` 怎么被记录                                |
| `tool.ts:449-454` | `validateToolSuspendData`：suspendSchema 校验                         |
| `tool.ts:436-444` | `validateToolInput(this.resumeSchema, resumeData)`：resumeSchema 校验 |

**推荐动作**：跑 `examples/03` 的「suspendData 不符合 suspendSchema」用例，在 `tool.ts:449` 打断点，看校验失败时返回的 `ValidationError` 结构。

---

## 六、设计取舍与坑

- **suspendSchema/resumeSchema 是可选的**：不设置就不校验，suspendData/resumeData 原样传递。
- **企业级 HITL 的正确姿势**：危险操作（删除、退款、发送）配 `requireApproval` + `suspendSchema`（把审批所需信息结构化传出去，而不是塞进自由文本）。
- **`needsApprovalFn` 不要自己设置**：它是运行时产物，配置层面用 `requireApproval` 就够了。

---

## 七、后续细化 TODO

- [ ] tool 级 suspend 和 07-loop 的工具并发度决策（`resolveToolCallConcurrency`）的交互——审批工具怎么让整批工具串行
- [ ] `context.suspend` 的完整实现链路：从 tool.ts 一路到 workflow 的 suspend 机制
- [ ] 多个工具同时需要审批时的 UI/UX 设计模式
