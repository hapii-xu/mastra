# 09.3 Working Memory vs 消息历史 —— 两条独立的记忆轨道

> 源码：`memory.ts:641`（`getWorkingMemory`）；`:657`（`getWorkingMemoryTemplate`）；`:663`（`updateWorkingMemory`）
> 示例：[`examples/03-working-memory-vs-history.test.ts`](./examples/03-working-memory-vs-history.test.ts)
> 跑：`cd docs/learning/09-memory/examples && npx vitest run 03`

---

## 一、四种记忆机制速查

| 机制                 | 特点                        | 实现位置                               |
| -------------------- | --------------------------- | -------------------------------------- |
| 消息历史             | 完整记录，累积增长          | `processors/memory/message-history.ts` |
| 语义召回             | 向量检索相关历史            | `processors/memory/semantic-recall.ts` |
| **工作记忆**（本篇） | **固定位置，覆盖式更新**    | `processors/memory/working-memory.ts`  |
| 观察记忆             | 后台 agent 持续提炼长期记忆 | `@mastra/memory`（独立包）             |

**前三种是同步的**（在请求链路里直接生效），**观察记忆是异步的**（后台 agent，额外的模型调用成本）。

---

## 二、⭐ 核心区别：working memory 不会随对话增长

```ts
// 存 5 条消息 —— 消息历史累积到 5
for (let i = 0; i < 5; i++) {
  await memory.saveMessages({ messages: [...] });
}
await memory.updateWorkingMemory({ threadId, resourceId, workingMemory: '固定的用户画像' });

const recalled = await memory.recall({ threadId, resourceId });
const wm = await memory.getWorkingMemory({ threadId, resourceId });

recalled.total  // === 5（消息历史累积了）
wm              // === '固定的用户画像'（working memory 依然只是一份，不会变成 5 份）
```

`examples/03` 实测验证了这个对比——**消息历史是「追加」模式，working memory 是「覆盖/合并」模式**。

---

## 三、getWorkingMemoryTemplate 的默认值

```ts
await memory.getWorkingMemoryTemplate({}) // → null（没配置模板时）
```

配置了模板后（生产实现里），这个方法会返回描述 working memory 结构的 schema/模板，供模型知道该往里面填什么格式的内容。

---

## 四、多次更新是覆盖还是合并？

`examples/03` 里连续两次 `updateWorkingMemory`，第二次的内容完全替换了第一次——这是 `MockMemory` 的行为。**真实的 `@mastra/memory` 实现有 `deepMergeWorkingMemory` 做结构化合并**（不是简单替换），具体语义：

- `null` 值删除对应的 key
- 其他值按字段合并，不是整体替换

这是 mock 与生产实现的一处已知差异——学习契约用 mock，理解生产行为要看 `@mastra/memory` 包源码。

---

## 五、Debug 断点清单

| 断点                                                                     | 观察什么        |
| ------------------------------------------------------------------------ | --------------- |
| `memory.ts:663` `updateWorkingMemory`                                    | mock 的覆盖逻辑 |
| `memory.ts:641` `getWorkingMemory`                                       | 取值的实现      |
| `@mastra/memory` 的 `deepMergeWorkingMemory`（生产实现，需查看该包源码） | 真实的合并语义  |

**推荐动作**：跑 `examples/03` 的对比用例，观察消息历史和 working memory 在同一个 thread 上的不同增长模式。

---

## 六、设计取舍与坑

- **working memory 适合存「稳定的用户画像」**：偏好、身份信息、长期目标——这些不需要在每条消息里重复，用 working memory 一次写入、持续复用。
- **消息历史适合存「对话上下文」**：需要按时间顺序理解的交流内容。
- **别把 working memory 当长文本仓库**：它设计上是「一块」内容，塞入大量非结构化文本会让模型难以有效利用；结构化的 JSON/模板化文本效果更好。
- **观察记忆是另一个数量级的成本**：它需要额外的后台 agent 持续运行，做企业级成本预算时不能忽略。

---

## 七、后续细化 TODO

- [ ] `@mastra/memory` 里 `deepMergeWorkingMemory` 的精确合并规则（null 删除、数组如何处理）
- [ ] working memory 模板（schema）的定义方式与验证
- [ ] observational memory 的完整链路：observer-agent 怎么提炼、多久跑一次、成本模型
- [ ] 语义召回（semantic-recall）的实测——需要 embedding 模型，本模块未覆盖，值得单独探索
