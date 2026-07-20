# 02. Tools — 工具定义与执行

## 模块职责

**定义 Agent 能调用的工具，并把各种来源的工具统一翻译成 LLM 能理解的格式。**

Tool 是 Agent 与外部世界的唯一接口——查数据库、调内部 API、发消息，全靠它。企业级场景里，你自己写的代码 90% 会是 tool。

这个模块有两个截然不同的部分，别混为一谈：

1. **`createTool` / `Tool`**（约 600 行）——你天天用的 API，很简单
2. **`CoreToolBuilder`**（1068 行）——把 Mastra tool / Vercel AI SDK tool / provider 原生 tool 统一转换成 LLM 消费格式的**兼容层**

## ⭐ 全模块最重要的一课：execute 是位置参数

**本次写作过程中，这个坑真实地出现在了两处已发布的示例里**（06-agent、07-loop 的初版），后来被发现并修正。它值得放在最前面：

```ts
// ❌ 看起来合理，实际是 bug —— context 静默变成 undefined
execute: async ({ context }) => ({ sum: context.a + context.b })

// ✅ 正确：位置参数
execute: async (inputData, context) => ({ sum: inputData.a + inputData.b })
```

`{context}` 解构第一个参数不会报错——JS 允许解构任何对象的任意字段，不存在就是 `undefined`。后果是静默产出 `NaN`，只有 outputSchema 足够严格时才会被拦截。详见 [01-execute-contract.md](./01-execute-contract.md)。

## 学习路径（4 篇深度文档）

| 主题            | 文档                                                         | 一句话                            |
| --------------- | ------------------------------------------------------------ | --------------------------------- |
| ⭐ execute 约定 | [01-execute-contract.md](./01-execute-contract.md)           | **位置参数 vs 解构的真实陷阱**    |
| 校验管道        | [02-validation-pipeline.md](./02-validation-pipeline.md)     | 6 步自愈机制，应对真实 LLM 怪癖   |
| HITL 工具       | [03-suspend-resume-tools.md](./03-suspend-resume-tools.md)   | 工具级 suspend/resume schema      |
| Agent 转换链    | [04-agent-tool-conversion.md](./04-agent-tool-conversion.md) | Zod schema → CoreTool，端到端验证 |

## 可跑示例

`examples/` 下 **4 个测试文件、22 个用例**，零构建、~5s 跑完：

```bash
cd docs/learning/02-tools/examples
npx vitest run                       # 全跑
npx vitest run 01-execute-contract   # 只跑招牌课
```

## 示例里挖到的真实细节（已验证）

- **`execute` 是位置参数** `(inputData, context)`，解构 `{context}` 是静默 bug 的来源（[01](./01-execute-contract.md)）
- **6 步校验管道**：字符串化 JSON 自动解析、null vs nullable 精确区分（[02](./02-validation-pipeline.md)）
- **resume 时跳过 inputData 校验**（`isResuming` 判定）（[01](./01-execute-contract.md)）
- **suspendSchema/resumeSchema 独立校验**：漏传字段返回结构化 ValidationError（[03](./03-suspend-resume-tools.md)）
- **`getToolsForExecution({})` 要传 options 对象**，不传会抛 TypeError（[04](./04-agent-tool-conversion.md)）
- **端到端验证比形状检查更可靠**：断言要打在工具计算结果上（[04](./04-agent-tool-conversion.md)）

## 关键源码文件

| 路径                            | 行数  | 作用                                                    | 文档 |
| ------------------------------- | ----- | ------------------------------------------------------- | ---- |
| `tools/tool.ts`                 | 596   | `Tool` 类(78)、`createTool`(575)、execute 包装(303-467) | 01   |
| `tools/validation.ts`           | 702   | 6 步校验管道(450)                                       | 02   |
| `tools/tool-builder/builder.ts` | 1068  | `CoreToolBuilder`，agent 用的兼容层                     | 04   |
| `tools/types.ts`                | 710   | `ToolAction`、`ToolExecutionContext`                    | —    |
| `tools/builtin/`                | ~1.2k | `ask-user`、`submit-plan`、`task-tools`                 | —    |
| `tools/code-mode/`              | ~630  | 工具即代码执行（跳过，服务 coding agent）               | —    |

## 校正记录

相对初版（导航索引）的补充：

- ✅ ⭐ execute 位置参数陷阱（初版完全没提，这是本轮最大的发现）
- ✅ 6 步校验管道的具体内容（初版只提了"运行时校验"，没有细节）
- ✅ suspendSchema/resumeSchema 的独立校验机制（初版只提了 HITL 概念）
- ✅ `getToolsForExecution({})` 的参数坑（实测发现）
