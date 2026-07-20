# 06-agent 可跑示例

**4 个文件，17 个用例，零构建，~5s 跑完。** 用内联 mock 模型，不调真实 provider。

## 怎么跑

```bash
cd docs/learning/06-agent/examples
npx vitest run                         # 全跑
npx vitest run 02-dynamic-resolution   # 只跑多租户
```

复用 05 的 vitest alias 配置 + 07 的 `mock-model.ts`（已复制到本目录）。

## 与 07-loop 的分工

07 用 mock 模型演示 **loop 机制**（工具循环、steps、停止条件）。06 聚焦 **Agent 自身的配置与解析**：

- Agent 构造（instructions/metadata/tools）
- ⭐ 动态解析（DynamicArgument——多租户）
- 结构化输出
- requestContext 流进工具

loop/generate-stream 的执行机制在 07，不在这里重复。

## 文件清单

| 文件                            | 用例数 | 学什么                                                                          | 文档                              |
| ------------------------------- | ------ | ------------------------------------------------------------------------------- | --------------------------------- |
| `01-agent-config.test.ts`       | 6      | 最小配置、instructions/metadata、**getToolsForExecution({})**、ephemeral mastra | [01](../01-agent-config.md)       |
| `02-dynamic-resolution.test.ts` | 5      | ⭐ **model/instructions 动态解析、多租户模式**                                  | [02](../02-dynamic-resolution.md) |
| `03-structured-output.test.ts`  | 3      | structuredOutput schema → output.object、信息抽取                               | [03](../03-structured-output.md)  |
| `04-request-context.test.ts`    | 3      | requestContext 流进工具、越权防护保留键                                         | [04](../04-request-context.md)    |

## 怎么用来 debug

**最有价值的练习**：跑 `02-dynamic-resolution` 的「多租户」用例，在动态 model 函数里打断点——看同一 Agent、不同 requestContext 走到不同分支。这是企业级多租户的核心模式。

## mock 模型说明

`mock-model.ts` 从 07-loop 复制而来：内联 v3 mock，按顺序消费 responses，零额外依赖。详见 [07-loop/examples/README.md](../../07-loop/examples/README.md)。
