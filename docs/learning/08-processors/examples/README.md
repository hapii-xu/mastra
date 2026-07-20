# 08-processors 可跑示例

**3 个文件，12 个用例，零构建，~5s 跑完。**

## 怎么跑

```bash
cd docs/learning/08-processors/examples
npx vitest run                        # 全跑
npx vitest run 03-processor-as-step   # 只跑「processor 即 step」这一课
```

## 文件清单

| 文件                           | 用例数 | 学什么                                         | 文档                             |
| ------------------------------ | ------ | ---------------------------------------------- | -------------------------------- |
| `01-processor-basics.test.ts`  | 4      | 6 个切点、执行顺序、⭐ TripWire 拦截零模型成本 | [01](../01-processor-basics.md)  |
| `02-token-limiter.test.ts`     | 5      | TokenLimiterProcessor 精读、系统消息超预算边界 | [02](../02-token-limiter.md)     |
| `03-processor-as-step.test.ts` | 3      | ⭐ **createStep(processor) 的 id 前缀细节**    | [03](../03-processor-as-step.md) |

## 怎么用来 debug

**最有价值的练习**：跑 `01-processor-basics` 的 TripWire 用例，观察一个带追踪标记的 mock 模型的 `doStream` 从未被调用——这直接证明了 processor 拦截不产生任何模型调用成本。

## 本次写作中的发现

`03-processor-as-step.test.ts` 最初预期 `createStep(processor).id` 是原样的 `'my-proc'`，实测发现框架会自动加上 `'processor:'` 前缀。这是又一个「跑一遍才知道真相」的例子——如果没有实际执行断言，这个前缀细节很容易被漏掉或记错。
