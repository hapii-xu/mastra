# 09-memory 可跑示例

**3 个文件，15 个用例，零构建，~5s 跑完。**

## 怎么跑

```bash
cd docs/learning/09-memory/examples
npx vitest run                             # 全跑
npx vitest run 02-agent-memory-integration  # 只跑招牌课（最重要的坑）
```

## ⭐ 本模块最重要的一课

`02-agent-memory-integration.test.ts` 演示了本次写作中发现的最危险的一类陷阱：**顶层 `{threadId, resourceId}` 完全不生效**，正确形态是嵌套的 `{ memory: { thread, resource } }`。这是静默失败（不报错），务必完整跑一遍这个文件的前两个 describe 块，并排对比。

## 文件清单

| 文件                                   | 用例数 | 学什么                                                 | 文档                                     |
| -------------------------------------- | ------ | ------------------------------------------------------ | ---------------------------------------- |
| `01-memory-contract.test.ts`           | 7      | MastraMemory 契约、⚠️ MockMemory 的 listThreads 不过滤 | [01](../01-memory-contract.md)           |
| `02-agent-memory-integration.test.ts`  | 4      | ⭐ **正确的调用形态**、跨调用记忆、防抖持久化          | [02](../02-agent-memory-integration.md)  |
| `03-working-memory-vs-history.test.ts` | 4      | working memory 覆盖式 vs 消息历史累积式                | [03](../03-working-memory-vs-history.md) |

## 本次写作中的两次真实教训

1. **`listThreads` 过滤假设错误**：最初断言 `list.threads.length === 2`（按 resourceId 过滤后的预期），实测发现 `MockMemory` 返回了全部 3 个 thread。已更正断言并记录这是 mock 实现的局限。

2. **memory 选项形态的探索过程**：最初尝试 `{ threadId, resourceId }`（顶层），测试"通过"但 `recall` 查出 0 条消息——花了几轮探测才找到正确形态是 `agent/types.ts:909` 声明的 `{ memory: { thread, resource } }`。这个过程本身证明了：**如果没有直接查询 memory 验证持久化结果，仅凭「没有报错」是无法发现这个坑的。**
