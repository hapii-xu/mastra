# 03.1 模型 ID 解析 —— parseModelRouterId

> 源码：`packages/core/src/llm/model/gateway-resolver.ts:8`
> 示例：[`examples/01-model-id-parsing.test.ts`](./examples/01-model-id-parsing.test.ts)
> 跑：`cd docs/learning/03-llm/examples && npx vitest run 01`

把 `"openai/gpt-4o"` 这种字符串拆成 `{ providerId, modelId }`。**纯函数，无网络调用**，是模型路由的第一步。

---

## 一、标准格式：3 段 `provider/model`

```ts
parseModelRouterId('openai/gpt-4o')
// → { providerId: 'openai', modelId: 'gpt-4o' }
```

`modelId` 本身可以带斜杠——`idParts.slice(...).join('/')` 会把多段拼回去：

```ts
parseModelRouterId('openai/org/gpt-4o')
// → { providerId: 'openai', modelId: 'org/gpt-4o' }
```

---

## 二、带 gatewayPrefix 的场景

```ts
parseModelRouterId('netlify/openai/gpt-4o', 'netlify')
// → { providerId: 'openai', modelId: 'gpt-4o' }
```

⚠️ 前缀不匹配会抛错：

```ts
parseModelRouterId('wrong-prefix/openai/gpt-4o', 'netlify') // throws
```

---

## 三、⭐ 两个 2 段格式特例

### Azure OpenAI：`azure-openai/deployment`

```ts
parseModelRouterId('azure-openai/my-deployment', 'azure-openai')
// → { providerId: 'azure-openai', modelId: 'my-deployment' }
```

源码注释：_"Azure OpenAI uses 2-part format (azure-openai/deployment), others use 3-part (gateway/provider/model)"_。

### provider-equals-gateway：`gateway/model`

某些网关的 provider id 就是网关 id 本身（如 `amazon-bedrock`），没有独立的 provider 段：

```ts
parseModelRouterId('amazon-bedrock/claude-3', 'amazon-bedrock')
// → { providerId: 'amazon-bedrock', modelId: 'claude-3' }
```

---

## 四、⚠️ 容易误判的边界情况

**`'netlify/openai'`（只有 2 段）配合 `gatewayPrefix='netlify'` 时不会报错**——因为它命中了 provider-equals-gateway 分支（`idParts[0] === gatewayPrefix`）：

```ts
parseModelRouterId('netlify/openai', 'netlify')
// → { providerId: 'netlify', modelId: 'openai' }  // 不是报错！
```

真正触发"段数不足"报错的，是**第一段和 gatewayPrefix 不同名**的 2 段输入：

```ts
parseModelRouterId('netlify/onlyOneMore', 'other-gateway') // throws
```

**这是一个容易在 debug 时误判的地方**：看到 2 段输入不要假设一定报错，要先看第一段是否等于 gatewayPrefix。

---

## 五、Debug 断点清单

| 断点                             | 观察什么                              |
| -------------------------------- | ------------------------------------- |
| `gateway-resolver.ts:8` 函数入口 | routerId 和 gatewayPrefix 的原始值    |
| azure-openai 分支判定            | 是否命中 2 段格式                     |
| provider-equals-gateway 分支判定 | `idParts[0] === gatewayPrefix` 的判断 |

**推荐动作**：跑 `examples/01` 全部用例，特别关注两个 2 段格式特例和「容易误判的边界」用例——它们是最容易在实际调试中搞混的地方。

---

## 六、设计取舍与坑

- **这是纯函数**：没有 I/O，测试成本极低，是排查「模型 ID 解析错误」的第一现场。
- **2 段 vs 3 段的判定顺序很微妙**：先判 azure-openai，再判 provider-equals-gateway，最后才是标准 3 段——顺序决定了哪些边界情况走哪条路径。
- **modelId 允许带斜杠，providerId 不允许**：这是非对称的设计，写自定义网关适配时要注意。

---

## 七、后续细化 TODO

- [ ] `ResolvedModelConfig` 类型的完整使用场景
- [ ] `provider-registry.ts`（899 行）里注册了哪些网关前缀
- [ ] 自定义网关接入时，`gatewayPrefix` 的选择规则
