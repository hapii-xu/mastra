# 03.3 ⭐ 客户端模型 fallback —— 主模型挂了自动切备用

> 源码：`agent.ts:2665 getLLM`；`:2745 resolveModelConfig`；`:2945 getModelList`；`:2785 normalizeModelFallbacks`
> 示例：[`examples/03-client-fallback.test.ts`](./examples/03-client-fallback.test.ts)
> 跑：`cd docs/learning/03-llm/examples && npx vitest run 03`

**多模型容灾**：主力模型限流/故障时，agent 自动切换到备用模型——不需要应用层写重试逻辑。

---

## 一、配置模型数组

```ts
const agent = new Agent({
  name: 'multi-model',
  instructions: '...',
  model: [
    { id: 'primary', model: primaryModel },
    { id: 'backup', model: backupModel },
  ],
})
```

`getModelList()`（`agent.ts:2945`，公开方法）能取回带 id 的模型列表——`examples/03` 验证了 id 的顺序被保留。

---

## 二、⭐ 实测：主模型失败自动切换

```ts
const agent = new Agent({
  model: [
    { id: 'primary', model: failingModel }, // 抛错
    { id: 'backup', model: workingModel },
  ],
})
const output = await (await agent.stream('hi')).getFullOutput()
// output.text 来自 backup，不是 primary
```

**这是本篇最有价值的验证**：`examples/03` 用一个总是 `throw` 的 mock 模型模拟 provider 故障，确认 agent 会自动尝试列表里的下一个模型，最终成功返回 backup 的结果。

---

## 三、⭐ 所有模型都失败时会怎样

```ts
const agent = new Agent({
  model: [
    { id: 'primary', model: failingModel1 },
    { id: 'backup', model: failingModel2 },
  ],
})
await agent.stream('hi').then(r => r.getFullOutput()) // 最终抛错
```

**fallback 链是有边界的**——不是无限重试，两个都失败就抛出错误。`examples/03` 验证了这一点。

---

## 四、结合动态解析（06.2）：按租户配置不同容灾链

```ts
model: async ({ requestContext }) => {
  const tier = requestContext.get('tier')
  return tier === 'pro'
    ? [
        { id: 'pro-primary', model: proModel },
        { id: 'pro-backup', model: backupModel },
      ]
    : [{ id: 'free', model: cheapModel }]
}
```

06.2 学的是「按 requestContext 选**一个**模型」，本篇是「配置**多个**模型做 fallback」——两者可以结合：动态函数返回一个 fallback 数组，而不是单个模型。

---

## 五、私有方法：normalizeModelFallbacks（`agent.ts:2785`）

标准化用户传入的 `ModelWithRetries[]`，补上默认的 `maxRetries`、`enabled`、随机 `id`（如果没传）。这是内部实现细节，不需要直接调用，但理解它有助于知道：**不传 id 时框架会自动生成一个（`randomUUID()`）**。

---

## 六、Debug 断点清单

| 断点                               | 观察什么                    |
| ---------------------------------- | --------------------------- |
| `agent.ts:2665` `getLLM`           | 模型解析入口                |
| `agent.ts:2945` `getModelList`     | 模型数组的标准化结果        |
| loop 内部模型调用失败处（07-loop） | fallback 切换发生的确切时机 |

**推荐动作**：跑 `examples/03` 的「主模型失败自动切换」用例，在 agent 执行链路上打断点，观察从 `primary` 抛错到 `backup` 被调用之间发生了什么。

---

## 七、设计取舍与坑

- **fallback 链有限**：想清楚兜底策略——最后一个模型也失败了，用户会看到什么错误。
- **每个模型可以有独立的 `maxRetries`**：不是整个链共享一个重试次数。
- **企业级建议**：backup 模型选择时考虑「可用性优先于质量」——backup 存在的意义是保底，不是追求同等质量。
- **和 03.2 服务端 fallback 是两回事**：客户端 fallback 是你自己配置的模型列表，服务端 fallback 是 provider 内部的安全兜底——排查「为什么用了另一个模型」时要分清是哪一层。

---

## 八、后续细化 TODO

- [ ] `resolveModelConfig`（`agent.ts:2743`）的完整解析链路
- [ ] `reorderModels()`/`updateModelInModelList()`：动态调整模型优先级的场景
- [ ] fallback 切换时，message 历史怎么处理（会不会带着 primary 的部分响应一起传给 backup）
- [ ] 模型级重试 × workflow 级重试（05.4）会不会叠加成 N×M 次调用
