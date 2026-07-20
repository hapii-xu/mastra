# 10-storage-vector 可跑示例

**3 个文件，17 个用例，零构建。** 前两个文件不需要 agent（<1s），第三个需要 Mastra 实例（~5s）。

## 怎么跑

```bash
cd docs/learning/10-storage-vector/examples
npx vitest run                          # 全跑
npx vitest run 03-mastra-domain-patching # 只跑招牌课（最重要的坑）
```

## ⭐ 本模块最重要的一课

`03-mastra-domain-patching.test.ts` 实测验证了：只配置部分 storage domain 时，Mastra 会**静默**补齐缺失的 domain 为内存实现——功能正常，但数据不会持久化到你期望的后端。这是「跑得通 ≠ 配置对了」的典型案例，务必完整跑一遍。

## 文件清单

| 文件                                | 用例数 | 学什么                                         | 文档                                  |
| ----------------------------------- | ------ | ---------------------------------------------- | ------------------------------------- |
| `01-composite-store.test.ts`        | 6      | ⭐ 组合模式混搭 domain、构造函数校验的真实边界 | [01](../01-composite-store.md)        |
| `02-vector-abstraction.test.ts`     | 7      | MastraVector 9 个方法、自己实现一个内存版      | [02](../02-vector-abstraction.md)     |
| `03-mastra-domain-patching.test.ts` | 4      | ⭐⭐⭐ **招牌课**：自动补齐陷阱的实测证据      | [03](../03-mastra-domain-patching.md) |

## 怎么用来 debug

**最有价值的练习**：跑 `03-mastra-domain-patching` 的完整对比用例（部分配置 vs 完整配置），在 Mastra 构造函数里打断点，观察 `workflows` domain 从 `undefined` 变成"可用"的那一刻，并确认它 `!== full.stores?.workflows`。

## 本次写作中的发现

`02-vector-abstraction.test.ts` 需要自己实现一个 `InMemoryVector`，因为 core 没有提供官方 mock（不像 memory 有 `MockMemory`）。这个过程本身就是「怎么写自己的向量适配器」的实战演练——只用了几十行代码就实现了完整的 9 方法契约，跑起来只要 243ms（无 agent/模型开销）。
