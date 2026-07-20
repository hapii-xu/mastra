# 09.2 ⭐ Agent + Memory 集成 —— 正确的调用形态

> 源码：`agent/types.ts:909`（`AgentMemoryOption`）；`agent/save-queue/index.ts`（防抖持久化）
> 示例：[`examples/02-agent-memory-integration.test.ts`](./examples/02-agent-memory-integration.test.ts)
> 跑：`cd docs/learning/09-memory/examples && npx vitest run 02`

**⭐⭐⭐ 本次写作过程中最重要的真实陷阱之一。**

---

## 一、⚠️ 顶层 threadId/resourceId 完全不生效

```ts
// ❌ 错误写法：静默失效，不报错
await agent.stream('hello', { threadId: 't1', resourceId: 'r1' })
```

**这段代码能跑，不会抛错，但消息完全不会存进 memory。** `examples/02` 用「等过防抖窗口后查询 memory，total 仍是 0」验证了这个静默失败。

---

## 二、✅ 正确形态：嵌套的 `memory: { thread, resource }`

```ts
// ✅ 正确写法
await agent.stream('hello', { memory: { thread: 't1', resource: 'r1' } })
```

`AgentMemoryOption` 的真实类型（`agent/types.ts:909`）：

```ts
export type AgentMemoryOption = {
  thread: string | (Partial<StorageThreadType> & { id: string })
  resource?: string
  options?: MemoryConfigInternal
}
```

**字段名是 `thread`/`resource`，不是 `threadId`/`resourceId`**，而且要整体嵌套在 `memory` 键下面。

---

## 三、⭐ 跨调用记忆：第二次调用召回第一次的历史

```ts
const memoryOpts = { memory: { thread: 't-conv', resource: 'r-conv' } }

await agent1.stream('第一句话', memoryOpts)
// ... 等待防抖持久化完成 ...
const r2 = await agent2.stream('第二句话', memoryOpts).then(r => r.getFullOutput())

r2.rememberedMessages.length // === 2（第一轮的用户消息 + 助手回复）
```

**这是记忆系统真正生效的证明**：不同的 Agent 实例，只要共享同一个 `memory` 对象和相同的 `thread`/`resource`，就能接续对话历史。

---

## 四、⭐ 消息持久化是防抖的

`agent/save-queue/index.ts`：默认 `debounceMs = 100`。这意味着：

```ts
await agent.stream('hello', memoryOpts).then(r => r.getFullOutput())
// 立刻查询：可能还没写进去
const immediate = await memory.recall({ threadId, resourceId })
// 等待 300ms 后查询：可靠
await new Promise(r => setTimeout(r, 300))
const reliable = await memory.recall({ threadId, resourceId })
```

**生产含义**：进程异常退出可能丢最近 100ms 内的未落盘消息。高可靠场景要评估这个窗口，或在关键节点主动 flush（`save-queue` 提供了 `flushMessages` 方法用于强制立即保存）。

---

## 五、Debug 断点清单

| 断点                                       | 观察什么                                                         |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `agent/types.ts:909` `AgentMemoryOption`   | 正确的选项形态                                                   |
| `agent/save-queue/index.ts` `debounceSave` | 防抖延迟的具体实现                                               |
| `agent.ts` 里读取 `options.memory` 的地方  | 顶层 `threadId` 为什么被忽略（它读的是 `options.memory.thread`） |

**推荐动作**：跑 `examples/02` 的「顶层不生效」和「正确形态生效」两个用例并排对比，在 agent 读取 memory 选项的地方打断点，亲眼看到顶层字段被忽略、嵌套字段被使用的分界线。

---

## 六、设计取舍与坑

- **⚠️ 这是最容易踩的坑之一**：`{ threadId, resourceId }` 是很多其他框架（甚至 Mastra 早期文档示例）的常见写法直觉，但当前 API 要求嵌套的 `memory: { thread, resource }`。写代码/复制示例时务必确认字段名和嵌套层级。
- **静默失败比报错更危险**：没有类型报错、没有运行时警告，只是「记忆功能看起来配置了，但从不生效」——排查时容易被忽略，因为其他一切都正常工作（agent 正常回复，只是不记得历史）。
- **防抖是性能优化，不是数据安全设计**：追求高可靠时要么缩短 `debounceMs`，要么在关键节点调用 flush，不能假设「调用完 stream 消息就已落盘」。
- **`resource` 是可选的，`thread` 是必需的**：只传 `thread` 也能工作，但跨会话的用户维度记忆（如 working memory 的用户画像）需要 `resource`。

---

## 七、后续细化 TODO

- [ ] `MemoryConfigInternal`（`options` 字段）的完整配置项
- [ ] `flushMessages` 的调用时机与生产实践
- [ ] `generate()` 是否有相同的 memory 选项形态（对照 stream）
- [ ] 多租户场景下 `resource` 字段与 `RequestContext` 的 `MASTRA_RESOURCE_ID_KEY`（01.1）的关系——是否会自动同步
