# 06.2 ⭐ 动态解析（DynamicArgument）—— 多租户的关键

> 源码：`agent.ts` 的 `getLLM`(2665)、`getMemory`(1905)、`getInstructions`、`getMetadata` 等
> 示例：[`examples/02-dynamic-resolution.test.ts`](./examples/02-dynamic-resolution.test.ts)
> 跑：`cd docs/learning/06-agent/examples && npx vitest run 02`

**这是 Agent 模块最值钱的企业级特性。** `model` / `memory` / `instructions` / `tools` 都是 `DynamicArgument<T, TRequestContext>`——**可以是值，也可以是「按请求解析的函数」**。

---

## 一、为什么重要

多租户场景：不同租户用不同模型、不同记忆库、不同工具集、不同系统提示词。**靠 requestContext 分流，一个 Agent 定义服务所有租户**——不用为每个租户 new 一个 Agent。

```ts
model: async ({ requestContext }) => {
  const plan = requestContext.get('plan')
  return plan === 'pro' ? proModel : cheapModel
}
```

---

## 二、动态 model（按请求选模型）

```ts
const agent = new Agent({
  name: 'router',
  instructions: 'x',
  model: async ({ requestContext }) => {
    return requestContext.get('plan') === 'pro' ? proModel : cheapModel
  },
})

// free 用户 → cheap 模型
const ctxFree = new RequestContext()
ctxFree.set('plan', 'free')
await agent.stream('hi', { requestContext: ctxFree })

// pro 用户 → pro 模型
const ctxPro = new RequestContext()
ctxPro.set('plan', 'pro')
await agent.stream('hi', { requestContext: ctxPro })
```

**成本路由**：简单任务走便宜模型，复杂任务走贵模型。解析发生在 `getLLM()`（`agent.ts:2665`）。

---

## 三、动态 instructions（按请求生成提示词）

```ts
instructions: async ({ requestContext }) => {
  const tenant = requestContext.get('tenantId') ?? 'guest'
  return `你是 ${tenant} 公司的专属助手`
}
```

---

## 四、静态值 vs 动态函数 都合法

```ts
model: someModel                          // ✅ 静态对象（最常见）
model: async ({requestContext}) => ...    // ✅ 动态函数（多租户/AB）
```

`DynamicArgument` 是两者的联合类型。所有解析器（`getLLM`/`getMemory`/`getInstructions`/`getMetadata`）都接 `requestContext`，按需解析。

---

## 五、⭐ 多租户模式：一个 Agent 服务多租户

```ts
const agent = new Agent({
  name: 'multi-tenant',
  instructions: async ({ requestContext }) => `服务于 ${requestContext.get('tenant')}`,
  model: async ({ requestContext }) => pickModelFor(requestContext.get('tenant')),
  // memory: async ({requestContext}) => pickMemoryFor(...)   // 同理
})

for (const tenant of ['Acme', 'Globex']) {
  const ctx = new RequestContext()
  ctx.set('tenant', tenant)
  await agent.stream('hi', { requestContext: ctx })
}
```

`examples/02` 验证：同一 Agent，不同 requestContext → 不同模型/指令。

---

## 六、关联 01.1 的 requestContext

动态解析全靠 `requestContext`（01.1 学的可变共享容器）。解析函数收到 `{ requestContext }`，从中读租户/用户/实验分组。

⚠️ **requestContext 可变共享、无 fork**（01.1 §三）——动态解析函数里别改它，只读。

---

## 七、Debug 断点清单

| 断点                         | 观察什么                       |
| ---------------------------- | ------------------------------ |
| `agent.ts:2665` `getLLM`     | 模型解析：静态对象还是函数调用 |
| `agent.ts:1905` `getMemory`  | 记忆解析                       |
| `agent.ts` `getInstructions` | 指令解析                       |
| 动态函数体内                 | requestContext 里实际有什么    |

**推荐动作**：跑 `examples/02` 的「多租户」用例，在你的动态 model 函数里打断点，看两个租户分别走到哪个分支。

---

## 八、设计取舍与坑

- **DynamicArgument 是多租户的正解**：一个 Agent 定义 + requestContext 分流，比为每租户建 Agent 高效。
- **每次调用都重新解析吗？** 解析器在每次 generate/stream 时跑——动态值是 per-request 的。高频场景注意解析开销。
- **解析函数只读 requestContext**：别在里面 set（可变共享，见 01.1）。
- **静态和动态混用**：model 动态、memory 静态，完全合法。
- **`memory` 也能动态**：`getMemory()`（`agent.ts:1905`）接 requestContext——多租户记忆隔离靠这个。

---

## 九、后续细化 TODO

- [ ] `DynamicArgument` 的完整类型定义与解析时机
- [ ] 动态解析的性能：每次调用都跑？有缓存吗？
- [ ] 动态 memory + requestContext 的 resourceId/threadId 多租户隔离实战
- [ ] AB 实验：用 requestContext 的 experiment 分组选模型
- [ ] `getLLM`(2665)/`resolveModelConfig`(2743) 的模型解析完整链路（关联 03）
