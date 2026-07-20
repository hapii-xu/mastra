# 09.1 MastraMemory 契约 —— Thread / Message / Working Memory

> 源码：`packages/core/src/memory/memory.ts:114`（`abstract class MastraMemory`）；`memory/mock.ts:75`（`MockMemory`）
> 示例：[`examples/01-memory-contract.test.ts`](./examples/01-memory-contract.test.ts)
> 跑：`cd docs/learning/09-memory/examples && npx vitest run 01`

**core 只定义抽象契约**（13 个抽象方法），真正的实现在 `@mastra/memory` 包（embedding 语义召回、LRU 缓存、observational memory）。`MockMemory` 是学习契约本身最好的入口——纯内存、零依赖、零构建。

核心概念只有两个：**Thread**（会话）和 **Message**（消息），外加一个正交的 **Working Memory**（工作记忆）。

---

## 一、createThread —— 具体方法，不是抽象的

```ts
const thread = await memory.createThread({ resourceId: 'r1', title: '我的会话' })
```

`memory.ts` 里 `createThread` **不是** abstract，它组装好 thread 对象后调用（abstract 的）`saveThread`。不传 `threadId` 会自动生成一个。

---

## 二、saveMessages + recall

```ts
await memory.saveMessages({ messages: [...] });
const recalled = await memory.recall({ threadId, resourceId });
// recalled.total / recalled.messages / recalled.hasMore
```

不同 thread 之间的消息互不干扰——`examples/01` 验证了在 t2 上 recall 返回 0 条，即使 t1 已经存了消息。

---

## 三、⚠️ 实测：MockMemory 的 listThreads 不按 resourceId 过滤

```ts
await memory.createThread({ resourceId: 'r1' })
await memory.createThread({ resourceId: 'r1' })
await memory.createThread({ resourceId: 'r2' }) // 不同 resource

const list = await memory.listThreads({ resourceId: 'r1' })
list.threads.length // === 3，不是预期的 2！
```

**这是本次写作过程中的一次真实教训**：我最初假设 `listThreads({resourceId})` 会过滤，写了断言 `toBe(2)`，实测发现 `MockMemory` 返回了全部 3 个 thread（底层 `InMemoryStore` 没有按 resourceId 过滤）。

**结论：mock 实现不完全代表生产存储（PG/LibSQL 适配器等）的过滤行为。** 自己实现存储适配器时，别假设 mock 的行为就是契约要求的行为——以 `storage/types.ts` 的类型声明和生产适配器自己的测试为准，不要照抄 mock 的实现细节。

---

## 四、deleteThread

```ts
await memory.deleteThread(thread.id)
await memory.getThreadById({ threadId: thread.id }) // → null
```

---

## 五、Working Memory 三个方法

```ts
memory.getWorkingMemory({ threadId, resourceId })          // 取当前内容
memory.getWorkingMemoryTemplate({ ... })                    // 取模板（无配置时为 null）
memory.updateWorkingMemory({ threadId, resourceId, workingMemory })  // 更新
```

初始 `getWorkingMemoryTemplate` 返回 `null`（没有配置模板时）——`examples/01` 验证了这一点。

---

## 六、Debug 断点清单

| 断点                                  | 观察什么                                                    |
| ------------------------------------- | ----------------------------------------------------------- |
| `memory.ts:114` `MastraMemory` 抽象类 | 13 个抽象方法的完整签名                                     |
| `memory/mock.ts:145` `listThreads`    | 委托给 `InMemoryStore` 的过滤逻辑（此处发现了不过滤的行为） |
| `memory.ts` 里的 `createThread`       | 具体实现如何调用抽象的 `saveThread`                         |

**推荐动作**：跑 `examples/01`，特别关注「listThreads 不过滤」这个用例——这是排查「为什么我查出来的会话比预期多」时的第一现场。

---

## 七、设计取舍与坑

- **抽象契约与实现分离**：想自己实现一套记忆系统？继承 `MastraMemory` 实现 13 个方法即可，不需要碰 `@mastra/memory` 的具体实现。
- **⚠️ mock 的过滤行为不可靠**：别把 mock 实现的具体过滤/排序细节当作契约保证，生产存储适配器可能有不同（更严格）的行为。
- **Working Memory 和消息历史是两条轨道**：详见 09.3。

---

## 八、后续细化 TODO

- [ ] `storage/types.ts` 里 `StorageListThreadsInput` 的完整过滤字段声明（判断 resourceId 过滤是否是「契约要求」还是「实现细节」）
- [ ] 生产适配器（LibSQL/PG）的 `listThreads` 实现是否真的按 resourceId 过滤（对照测试）
- [ ] `cloneThread`（抽象方法之一）的用途与实现
- [ ] `deleteMessages` 的批量删除语义
