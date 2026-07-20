# 04-stream 可跑示例

**3 个文件，17 个用例，零构建，~5s 跑完。**

## 怎么跑

```bash
cd docs/learning/04-stream/examples
npx vitest run                        # 全跑
npx vitest run 02-tripwire-and-error   # 只跑招牌课
```

复用 07-loop 的 `mock-model.ts` 和 05-workflows 的 vitest alias 配置。

## 文件清单

| 文件                            | 用例数 | 学什么                                                            | 文档                              |
| ------------------------------- | ------ | ----------------------------------------------------------------- | --------------------------------- |
| `01-output-consumption.test.ts` | 5      | getFullOutput / textStream / fullStream 三种消费方式、缓冲机制    | [01](../01-output-consumption.md) |
| `02-tripwire-and-error.test.ts` | 4      | ⭐ **tripwire vs error**、结构化 metadata、企业级判断模式         | [02](../02-tripwire-and-error.md) |
| `03-fulloutput-fields.test.ts`  | 8      | FullOutput 全字段实测：usage/messages/runId/suspendPayload/object | [03](../03-fulloutput-fields.md)  |

## 怎么用来 debug

**最有价值的练习**：跑 `02-tripwire-and-error` 的用例，在 `agent/trip-wire.ts` 构造函数打断点，观察 processor 抛出的 TripWire 信息如何流入最终的 `output.tripwire`。

## 本次写作中的真实修正

写 `03-fulloutput-fields.test.ts` 时直接探测顶层 `output.toolCalls`/`output.toolResults`，发现它们**确实存在**（跨所有轮次聚合）——这与 07-loop 早期文档里「顶层没有」的说法矛盾。核实后发现是早期探测有误，已同步修正 07-loop 的三处相关引用，并在 07-loop 的 examples 里补充了一个专门的回归用例防止再次记录错误。

**这也是本教程方法论的一次自我验证**：跑得通的断言才是真的，文档里的说法必须能被 `expect` 钉住。
