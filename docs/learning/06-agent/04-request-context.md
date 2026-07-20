# 06.4 requestContext 流进 Agent 与工具

> 源码：`agent.ts` generate/stream 都接 requestContext；`tools/types.ts` 的 `ToolExecutionContext`
> 示例：[`examples/04-request-context.test.ts`](./examples/04-request-context.test.ts)
> 跑：`cd docs/learning/06-agent/examples && npx vitest run 04`

**这是 01.1 学的请求级数据总线在 agent 层的应用。** requestContext 从 `agent.stream({ requestContext })` 进来，贯穿到 memory / tool / processor。

---

## 一、调用链

```
agent.stream(messages, { requestContext })
  └─ #execute (agent.ts:6467)
       └─ execution-workflow → agentic-loop → agentic-execution
            └─ toolCallStep → tool.execute({ context: { ..., requestContext, mastra } })
```

requestContext 一路流到工具的 `execute` 参数（`ToolExecutionContext`，`tools/types.ts`）。

---

## 二、工具能拿到 requestContext

```ts
const whoami = createTool({
  id: 'whoami',
  inputSchema: z.object({}),
  outputSchema: z.object({ tenant: z.string() }),
  execute: async ({ context }) => {
    // context 里有 requestContext、mastra 等
    return { tenant: context.requestContext?.get('tenantId') }
  },
})

const ctx = new RequestContext()
ctx.set('tenantId', 'Acme')
await agent.stream('我是谁', { requestContext: ctx })
```

⚠️ 工具 `context` 里 requestContext 的具体字段位置见 `ToolExecutionContext`（`tools/types.ts`）。**断点打在工具 execute 里看实际形状**——比记文档可靠。

---

## 三、⭐ 保留键的越权防护（关联 01.1 §六）

认证中间件把真实用户写进 `MASTRA_RESOURCE_ID_KEY`（`server/auth/helpers.ts:473`），它**优先于客户端传值**——防止攻击者假冒身份读别人记忆：

```ts
// server/handlers/utils.ts:77
const effectiveResourceId = contextResourceId || clientResourceId // 中间件设的恒赢
```

**企业级第一件事**：配认证中间件，把用户身份写进 requestContext。不配 = 客户端可以随便声称自己是谁。

---

## 四、不传 requestContext 时自动建空的

agent.ts 里约 40 处 `requestContext = new RequestContext()` 默认参数。**不传也能跑**（用空 context）：

```ts
await agent.stream('hi') // 内部 new RequestContext()
```

但动态解析（06.2）就读不到租户信息了——多租户场景必须显式传。

---

## 五、Debug 断点清单

| 断点                                    | 观察什么                            |
| --------------------------------------- | ----------------------------------- |
| `agent.ts:6467` `#execute`              | requestContext 怎么合并进 options   |
| `tools/types.ts` `ToolExecutionContext` | 工具 context 的形状                 |
| 工具 execute 第一行                     | context.requestContext 里实际有什么 |
| `server/handlers/utils.ts:77`           | 越权防护（需 server，见 14）        |

**推荐动作**：跑 `examples/04`，在工具 execute 里打断点，展开 `context` 看 requestContext 和 mastra 都在。

---

## 六、设计取舍与坑

- **requestContext 贯穿全链路**：agent → loop → tool → memory → processor。
- **可变共享、无 fork**（01.1 §三）：工具里别改它，只读。
- **越权防护靠中间件设保留键**：不配认证 = 身份可伪造。
- **不传 = 空 context**：动态解析读不到租户。
- **工具 context 形状以源码为准**：`ToolExecutionContext`，断点看比记文档可靠。

---

## 七、后续细化 TODO

- [ ] `ToolExecutionContext` 的完整字段（requestContext/mastra/...）
- [ ] 多租户实战：租户 ID 从 HTTP → 认证中间件 → requestContext → memory 隔离
- [ ] `MASTRA_RESOURCE_ID_KEY` / `MASTRA_THREAD_ID_KEY` 在 agent.ts 的读取点（5728/6398/7119...）
- [ ] requestContext 在 processor 层的可见性（见 08）
