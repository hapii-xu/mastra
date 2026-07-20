# 09. Memory — 记忆

## 模块职责

**让 Agent 记住东西：对话历史、语义召回、工作记忆、长期观察记忆。**

**⚠️ 这个模块的代码分散在三个地方**：`core/src/memory/`（只有抽象契约）、`core/src/processors/memory/`（记忆怎么接入 agent）、`packages/memory/`（真正的实现，24.7k 行）。**记忆是以 processor 形式接入 Agent 的**——这是理解本模块的钥匙。

## 学习路径（3 篇深度文档）

| 主题           | 文档                                                                 | 一句话                                                |
| -------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| 契约           | [01-memory-contract.md](./01-memory-contract.md)                     | Thread/Message/Working Memory、⚠️ mock 过滤行为的教训 |
| ⭐ Agent 集成  | [02-agent-memory-integration.md](./02-agent-memory-integration.md)   | **正确的调用形态：`memory: {thread, resource}`**      |
| Working Memory | [03-working-memory-vs-history.md](./03-working-memory-vs-history.md) | 覆盖式更新 vs 消息历史的累积式增长                    |

### ⭐ 本模块最重要的一课：顶层 threadId/resourceId 静默失效

```ts
// ❌ 完全不生效，不报错，消息不会存
await agent.stream('hello', { threadId: 't1', resourceId: 'r1' })

// ✅ 正确形态
await agent.stream('hello', { memory: { thread: 't1', resource: 'r1' } })
```

**这是本次写作探测出的最危险的一类陷阱**——静默失败，没有类型报错、没有运行时警告。详见 [02](./02-agent-memory-integration.md)。

## 可跑示例

`examples/` 下 **3 个测试文件、15 个用例**，零构建、~5s 跑完：

```bash
cd docs/learning/09-memory/examples
npx vitest run                             # 全跑
npx vitest run 02-agent-memory-integration  # 只跑招牌课
```

## 示例里挖到的真实细节（已验证）

- **⭐ `memory: {thread, resource}` 是唯一生效的形态**，顶层 `threadId`/`resourceId` 静默失效（[02](./02-agent-memory-integration.md)）
- **⚠️ `MockMemory.listThreads` 实测不按 resourceId 过滤**：这是 mock 实现的局限，不代表生产存储的契约行为（[01](./01-memory-contract.md)）
- **消息持久化是防抖的**（100ms）：立刻查询可能看不到刚保存的消息（[02](./02-agent-memory-integration.md)）
- **working memory 是覆盖式更新，消息历史是累积式增长**：两条完全不同增长模式的轨道（[03](./03-working-memory-vs-history.md)）
- **跨 Agent 实例的记忆共享**：只要共享同一个 memory 对象和 thread/resource，不同 Agent 实例能接续对话（[02](./02-agent-memory-integration.md)）

## 关键源码文件

| 路径                          | 行数  | 作用                                               | 文档     |
| ----------------------------- | ----- | -------------------------------------------------- | -------- |
| `core/src/memory/memory.ts`   | 1094  | `MastraMemory` 契约(114)，13 个抽象方法            | 01       |
| `core/src/memory/mock.ts`     | —     | `MockMemory`，最简单的完整实现                     | 01/02/03 |
| `agent/types.ts:909`          | —     | `AgentMemoryOption`——正确的调用形态                | 02       |
| `agent/save-queue/index.ts`   | —     | 防抖持久化                                         | 02       |
| `core/src/processors/memory/` | ~1.5k | message-history / semantic-recall / working-memory | 03       |
| `packages/memory/src/`        | 24.7k | 真正的生产实现（embedding、observational memory）  | —        |

## 校正记录

相对初版（导航索引）的补充：

- ✅ ⭐ **正确的调用形态**（初版完全没提，这是实测才发现的关键坑）
- ✅ `MockMemory.listThreads` 不过滤的实测细节（初版没有验证过 mock 行为）
- ✅ 防抖持久化的具体时间窗口与查询时机影响（初版只提概念）
- ✅ working memory 覆盖 vs 消息历史累积的对比实测（初版只描述了概念）
