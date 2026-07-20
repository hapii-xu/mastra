# 02-tools 可跑示例

**4 个文件，22 个用例，零构建，~5s 跑完。**

## 怎么跑

```bash
cd docs/learning/02-tools/examples
npx vitest run                       # 全跑
npx vitest run 01-execute-contract   # 只跑招牌课
```

`01`/`02`/`03` 直接 import `packages/core/src/tools`，不需要 agent。`04` 需要 agent + mock 模型（复用 07-loop 的 `mock-model.ts`）。

## ⭐ 本模块最重要的一课

`01-execute-contract.test.ts` 演示的坑，**在写本教程的过程中真实发生过两次**（06-agent 和 07-loop 的初版示例都写成了 `execute: async ({ context }) => ...`，后来验证发现是 bug）。这是一个「代码能跑但结果是错的」的典型案例——务必完整跑一遍这个文件。

## 文件清单

| 文件                               | 用例数 | 学什么                                               | 文档                                 |
| ---------------------------------- | ------ | ---------------------------------------------------- | ------------------------------------ |
| `01-execute-contract.test.ts`      | 6      | ⭐ **execute 位置参数 vs 解构陷阱**、resume 跳过校验 | [01](../01-execute-contract.md)      |
| `02-validation-pipeline.test.ts`   | 6      | 6 步自愈校验、字符串化 JSON、null vs nullable        | [02](../02-validation-pipeline.md)   |
| `03-suspend-resume-tools.test.ts`  | 7      | suspendSchema/resumeSchema、requireApproval          | [03](../03-suspend-resume-tools.md)  |
| `04-agent-tool-conversion.test.ts` | 3      | CoreToolBuilder 转换、端到端验证                     | [04](../04-agent-tool-conversion.md) |

## 怎么用来 debug

**最有价值的练习**：跑 `01-execute-contract` 的「静默产出错误结果」用例，在 `tool.ts:447`（`originalExecute(data, organizedContext)`）打断点，对比 `data` 的真实内容和你 execute 里解构出的东西。

## 写作过程中的真实教训

写 06-agent 和 07-loop 的示例时，两处都无意中写成了 `execute: async ({ context }) => ...`。07-loop 的测试当时"通过"了——因为断言只检查了 mock 模型的最终文本（硬编码的），没有检查工具的实际计算结果。后来加上直接断言 `toolResults[0].payload.result` 才发现工具算出的是 `NaN`。

**这就是为什么 04 号示例强调「端到端验证要断言在数据本身上」**——不能只信任「测试跑通了」这个表象。
