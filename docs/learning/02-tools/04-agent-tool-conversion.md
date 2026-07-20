# 02.4 工具从定义到被模型调用的转换链

> 源码：`agent.ts:5696 getToolsForExecution` → `:5751 convertTools` → `tools/tool-builder/builder.ts`
> 示例：[`examples/04-agent-tool-conversion.test.ts`](./examples/04-agent-tool-conversion.test.ts)
> 跑：`cd docs/learning/02-tools/examples && npx vitest run 04`

**你写的 Zod schema 不是模型直接看到的东西。** 中间经过 `CoreToolBuilder` 转换成 `CoreTool` 格式。排查「模型传错参数」的第一现场就是对比这两个形状。

---

## 一、转换后的形状（实测）

```ts
const tools = await agent.getToolsForExecution({});
// tools.calc 不再是 Tool 类实例，而是：
{
  type: ...,           // CoreTool 的类型标记
  description: '加法',
  parameters: {...},   // JSON Schema 化的 inputSchema
  execute: [Function],
  requireApproval: false,
  needsApprovalFn: undefined,
  hasSuspendSchema: false,
  id: 'calc',
}
```

⚠️ **`getToolsForExecution({})` 要传 options 对象**（见 06.1）——不传会抛 `Cannot read properties of undefined (reading 'requestContext')`。

---

## 二、端到端验证：模型真的能调用转换后的工具

**最有说服力的验证不是检查形状，是让模型真的调用它**：

```ts
const multiply = createTool({
  id: 'multiply',
  inputSchema: z.object({ x: z.number(), y: z.number() }),
  outputSchema: z.object({ product: z.number() }),
  execute: async inputData => ({ product: inputData.x * inputData.y }),
})

const agent = new Agent({
  model: mockModel([
    { kind: 'tool-call', toolCallId: 'c1', toolName: 'multiply', input: { x: 6, y: 7 } },
    { kind: 'text', text: '答案是 42' },
  ]),
  tools: { multiply },
})

// 验证工具真的算出了 42（6*7），不是模型文本巧合对上
const step = output.steps.find(s => s.toolResults?.length)
expect(step.toolResults[0].payload.result).toEqual({ product: 42 })
```

**这条断言直接钉在工具计算结果上，不依赖 mock 的最终文本**——呼应 02.1 学到的教训。

---

## 三、多工具同时注册

```ts
new Agent({ tools: { add, sub }, ... })
const tools = await agent.getToolsForExecution({});
// Object.keys(tools) 包含 'add' 和 'sub'
```

---

## 四、转换发生的位置（回顾 tools.md 索引）

```
Agent.getToolsForExecution()          agent.ts:5696
  └─ 11 × list*Tools()                agent.ts:4227 起
  └─ convertTools()                   agent.ts:5751
       └─ new CoreToolBuilder()       tools/tool-builder/builder.ts:233
            └─ .build()               tools/tool-builder/builder.ts:894
                 └─ createExecute()   tools/tool-builder/builder.ts:521
  └─ wrapToolsWithHooks()             agent.ts:5959
  └─ formatTools()                    agent.ts:6005
```

`createExecute`（`builder.ts:521`）是真正调用你的 `tool.execute` 的地方——它包了日志、错误处理、上下文注入。

---

## 五、Debug 断点清单

| 断点                                          | 观察什么                                       |
| --------------------------------------------- | ---------------------------------------------- |
| `agent.ts:5751` `convertTools`                | 11 个来源汇总后的工具列表                      |
| `tool-builder/builder.ts:894` `build()`       | **你的 Zod schema 变成了什么样的 JSON Schema** |
| `tool-builder/builder.ts:521` `createExecute` | 你的 execute 被包了几层                        |

**推荐动作**：跑 `examples/04` 的端到端用例，在 `builder.ts:894` 打断点，对比入参的 Mastra tool 和返回的 CoreTool 形状。

---

## 六、设计取舍与坑

- **schema 转换是有损的**：不同模型对 JSON Schema 的支持度不同，`CoreToolBuilder` 会做降级（见 tools.md 索引）。
- **端到端测试比形状检查更可靠**：写工具测试时，优先断言「工具执行的实际结果」，而不只是「工具存在」或「模型说了什么」。
- **`getToolsForExecution({})` 的空对象参数容易被忘记**。

---

## 七、后续细化 TODO

- [ ] Schema 降级的完整规则表：哪些模型触发哪种降级
- [ ] `wrapToolsWithHooks` 的 hooks 机制
- [ ] `formatTools` 最后一步做了什么整理
- [ ] provider 原生工具（`buildProviderTool`）与普通 Mastra 工具的转换差异
