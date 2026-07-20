# 03.2 ⭐ 服务端 fallback —— 你请求 A 模型，网关可能实际用了 B

> 源码：`packages/core/src/llm/model/server-side-fallback.ts`
> 示例：[`examples/02-server-side-fallback.test.ts`](./examples/02-server-side-fallback.test.ts)
> 跑：`cd docs/learning/03-llm/examples && npx vitest run 02`

**这条容易被忽略，但直接关系到成本核算的准确性。**

---

## 一、机制

当配置了 `providerOptions.anthropic.fallbacks` 且主模型的安全分类器拒绝了某轮对话，Anthropic API 会**透明地**在 fallback 模型上重试，并把替换信息报告在 `providerMetadata.anthropic.iterations` 里（`fallback_message` 类型的条目）。

**你的应用完全感知不到这次切换**——除非主动去解析 `providerMetadata`。

---

## 二、`getServerSideFallbackInfo`：提取 fallback 信息

```ts
getServerSideFallbackInfo(providerMetadata)
// 没有 fallback → undefined
// 有 fallback   → { model: 'claude-fallback-model-id' }
```

```ts
const providerMetadata = {
  anthropic: {
    iterations: [
      { type: 'normal_message', model: 'claude-primary' },
      { type: 'fallback_message', model: 'claude-fallback' },
    ],
  },
}
getServerSideFallbackInfo(providerMetadata) // → { model: 'claude-fallback' }
```

⚠️ **多个 `fallback_message` 时取最后一个**（`[...iterations].reverse().find(...)`）——如果一次对话触发了多轮内部 fallback，你拿到的是最终服务这轮对话的模型。

---

## 三、⭐ `resolveResponseModelId`：成本核算要用这个

```ts
resolveResponseModelId(providerMetadata, responseModelId)
// 优先用 fallback 报告的模型 id，没有 fallback 才用 responseModelId
```

**企业级场景**：你请求时声明用 `'claude-opus'`（贵），但服务端因安全策略 fallback 到了 `'claude-haiku'`（便宜）：

```ts
const actualModel = resolveResponseModelId(providerMetadata, 'claude-opus')
// actualModel === 'claude-haiku'，不是 'claude-opus'
```

**如果成本核算按请求参数 `'claude-opus'` 定价，会算错。** 必须用 `resolveResponseModelId` 的结果。

---

## 四、和客户端 fallback（03.3）的区别

|            | 服务端 fallback（本篇）         | 客户端 fallback（03.3）          |
| ---------- | ------------------------------- | -------------------------------- |
| 谁在切换   | Anthropic API 自己              | Mastra agent 配置的模型数组      |
| 你能感知吗 | 不能，除非解析 providerMetadata | 能，配置里明确写了 fallback 列表 |
| 触发条件   | 安全分类器拒绝                  | 模型调用抛异常/超时              |
| 用途       | Anthropic 内部的安全兜底        | 多模型容灾架构                   |

**两者是完全独立的机制，可能同时发生**（客户端配置的某个模型内部又触发了服务端 fallback）。

---

## 五、Debug 断点清单

| 断点                                                  | 观察什么                                           |
| ----------------------------------------------------- | -------------------------------------------------- |
| `server-side-fallback.ts` `getServerSideFallbackInfo` | `providerMetadata.anthropic.iterations` 的原始内容 |
| `resolveResponseModelId` 调用处                       | 最终解析出的模型 id 和请求时声明的是否一致         |

**推荐动作**：跑 `examples/02` 的「企业级用法」用例，观察请求 `claude-opus` 但实际服务是 `claude-haiku` 时，两者的差异。

---

## 六、设计取舍与坑

- **这是 Anthropic 特有的机制**（目前只解析 `providerMetadata.anthropic`）——其他 provider 若有类似机制，需要扩展这个函数。
- **防御性处理很完整**：`iterations` 不是数组、没有 `fallback_message`、`model` 字段缺失，全部安全返回 `undefined` 或 `{}`，不会抛错。
- **成本归因的正确姿势**：日志/追踪系统要记录 `resolveResponseModelId()` 的结果，而不是请求参数里的模型 id。

---

## 七、后续细化 TODO

- [ ] 其他 provider（OpenAI、Google）是否有类似的服务端 fallback 报告机制
- [ ] `providerOptions.anthropic.fallbacks` 的配置方式与生效条件
- [ ] 服务端 fallback 和 12-observability 的追踪集成：span 里怎么记录实际模型
