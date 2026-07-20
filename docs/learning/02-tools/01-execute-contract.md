# 02.1 ⭐ Tool.execute 的真实调用约定

> 源码：`packages/core/src/tools/tool.ts`（`Tool` 构造函数 `:276-468`）
> 示例：[`examples/01-execute-contract.test.ts`](./examples/01-execute-contract.test.ts)
> 跑：`cd docs/learning/02-tools/examples && npx vitest run 01`

**全仓库最容易踩的一个坑，本次写文档时在自己的示例里踩中过两次（06-agent、07-loop 的初版都写错了，后来发现并修正）。** 这篇文档存在的意义就是替你踩过这个坑。

---

## 一、真实签名：位置参数，不是解构

```ts
// tool.ts:303-305
this.execute = async (inputData: TSchemaIn, context?: any) => { ... }

// tool.ts:447 —— 你写的 execute 被这样调用
const output = await originalExecute(data, organizedContext);
```

**第一个参数是校验后的输入，第二个参数才是执行上下文。**

```ts
// ✅ 正确
execute: async (inputData) => ({ sum: inputData.a + inputData.b })

// ✅ 正确（需要上下文时）
execute: async (inputData, context) => {
  const storage = context?.mastra?.getStorage();
  ...
}
```

---

## 二、⭐ 为什么 `({ context })` 解构「看起来能跑」

```ts
// ❌ 错误，但不会立刻报错
execute: async ({ context }) => ({ sum: context.a + context.b })
```

JS 对象解构对**任意对象**都合法——哪怕该字段不存在，也只是拿到 `undefined`，不会抛异常。`inputData`（比如 `{a: 2, b: 3}`）里根本没有 `context` 字段，于是：

```
{ context } = { a: 2, b: 3 }   →   context === undefined
context.a + context.b          →   undefined + undefined = NaN
```

**`NaN` 不会立刻报错**，只有在 `outputSchema` 校验时才会被拦截成 `{ error: true, message: '...' }`。如果 `outputSchema` 宽松（比如 `z.any()`），**这个 bug 会完全不被发现，静默产出错误数据**。

```ts
// examples/01 的用例：宽松 schema 下 bug 完全隐身
outputSchema: z.any(),
execute: async ({ context }) => ({ sum: context?.a + context?.b }),
// → { sum: NaN }，没有任何报错
```

**⚠️ 本次写作过程中的真实教训**：07-loop 的一个示例最初就是这么写的，测试依然「通过」——因为 mock 模型的最终文本是硬编码的 `'结果是 5'`，和工具算出的 `NaN` 无关。后来加了一条直接断言 `toolResults[0].payload.result` 的用例，才揭穿了这个 bug。**教训：断言要打在数据本身上，不能只信任模型的最终文本。**

---

## 三、第二个参数：执行上下文

```ts
execute: async (inputData, context) => {
  context.mastra // Mastra 实例（agent 执行时）
  context.requestContext // 请求级上下文（见 01.1）
  context.suspend // HITL 挂起函数（见 02.3）
  context.resumeData // 恢复时的数据（见下）
}
```

具体字段因执行来源而异（agent 调用 vs workflow step vs 直接调用），组织逻辑在 `tool.ts:348-433`——区分 `isAgentExecution`（有 `toolCallId` + `messages`）和 `isWorkflowExecution`（有 `workflow`/`workflowId`），分别把相关字段收纳进 `context.agent` 或 `context.workflow` 子对象。

---

## 四、resume 时跳过输入校验

`tool.ts:306-320`：

```ts
const isResuming = !!(context?.resumeData || context?.agent?.resumeData);
if (!isResuming) {
  // 只有非 resume 时才校验 inputData
  const validationResult = validateToolInput(this.inputSchema, inputData, this.id);
  ...
}
```

**原因**：resume 时原始参数已经在首次执行时验证过了，工具的 `execute` 这时通常只看 `resumeData` 并提前返回，不再需要 `inputData`。`examples/01` 验证：resume 时故意传不合规的 `inputData` 也不会报错。

---

## 五、⚠️ 05-workflows 里的另一个坑：tool-as-step 的位置参数不同

05.5 学过：**tool 作为 workflow step 时**，`createStepFromTool`（`workflow.ts:608`）调用方式是 `tool.execute(inputData, toolContext)`——**同样是位置参数**，这点和这里一致。但注意：

- **直接创建的 Tool**（本篇）：`execute(inputData, context)`
- **Tool 被 agent 使用**（经 `CoreToolBuilder`，见 02.4）：最终也是位置参数
- **Tool 被 workflow 当 step 用**（05.5）：`createStepFromTool` 明确用位置参数调用（v1.0 breaking change 的说明就是强调这点）

**三条路径都是位置参数——记住这一条规则就够了，不用分别记。**

---

## 六、Debug 断点清单

| 断点              | 观察什么                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `tool.ts:303`     | `this.execute` 包装函数入口                                                                  |
| **`tool.ts:447`** | **`originalExecute(data, organizedContext)`——对比 `data` 和你的 execute 第一参解构出的东西** |
| `tool.ts:310`     | `isResuming` 判定                                                                            |
| `tool.ts:348-433` | agent/workflow context 的组织逻辑                                                            |

**推荐动作**：跑 `examples/01` 的「静默产出错误结果」用例，在 `tool.ts:447` 打断点，展开 `data` 看真实的 inputData 形状，和你 execute 里解构出来的东西对比。

---

## 七、设计取舍与坑

- **位置参数是唯一真理**：`execute(inputData, context)`，任何看起来能解构成功的写法都要怀疑。
- **宽松 outputSchema 会掩盖这个 bug**：写工具时 outputSchema 尽量严格，能帮你在开发阶段就抓到这个错误。
- **测试断言要打在数据本身**：不能只验证「跑通了」或「模型说了什么」，要验证工具产出的具体值。
- **TypeScript 帮不上忙**：`execute: async (inputData) => ...` 里如果 `inputData` 类型是 `any`（很多示例代码为了简洁都这样写），解构错误不会有类型报错。写生产代码时让 `inputData` 保持强类型。

---

## 八、后续细化 TODO

- [ ] `organizedContext` 的完整字段清单（agent/workflow 两种模式下分别有什么）
- [ ] 直接调用 tool（不经 agent/workflow）时 context 的默认形状
- [ ] 这个坑是否值得给 `createTool` 加运行时警告（比如检测第一参有没有 `.context` undefined 访问）
