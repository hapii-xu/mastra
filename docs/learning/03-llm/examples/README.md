# 03-llm 可跑示例

**3 个文件，22 个用例，零构建。** 前两个文件是纯函数测试（<200ms），第三个需要 agent + mock 模型（~5s）。

## 怎么跑

```bash
cd docs/learning/03-llm/examples
npx vitest run                        # 全跑
npx vitest run 03-client-fallback      # 只跑招牌课
```

## 文件清单

| 文件                              | 用例数 | 学什么                                                        | 文档                                |
| --------------------------------- | ------ | ------------------------------------------------------------- | ----------------------------------- |
| `01-model-id-parsing.test.ts`     | 10     | parseModelRouterId：3 段格式、2 段特例、⚠️ 容易误判的边界     | [01](../01-model-id-parsing.md)     |
| `02-server-side-fallback.test.ts` | 8      | ⭐ 服务端 fallback 检测、成本核算的正确姿势                   | [02](../02-server-side-fallback.md) |
| `03-client-fallback.test.ts`      | 4      | ⭐ **招牌课**：客户端模型 fallback 实测（主模型故障自动切换） | [03](../03-client-fallback.md)      |

## 怎么用来 debug

**最有价值的练习**：跑 `03-client-fallback` 的「primary 抛错自动切 backup」用例，在 agent 的模型执行链路上打断点，观察 fallback 切换的确切时机——这是多模型容灾架构的核心机制。

## 本模块的特点

`01`/`02` 是纯函数测试，没有 agent、没有 mock 模型，运行速度接近瞬时（<200ms）——是排查模型 ID 解析问题和服务端 fallback 检测问题时最快的验证方式。`03` 需要通过真实的 agent 执行链路来验证客户端 fallback 行为，复用 07-loop 的 `mock-model.ts`。
