# 06. Agent — 核心 ⭐⭐

## 模块职责

**框架的核心抽象：把模型、工具、记忆、处理器、可观测性编排成一个能自主完成任务的 Agent。**

`agent.ts` **8952 行**——全包最大的单文件。但学完 05（workflow）和 07（loop）后，它就是一个「把 workflow 组装起来的大工厂」：绝大部分代码在干「解析配置」（模型/工具/记忆都支持动态解析）和「组装 workflow」，执行逻辑在 07。

## ⭐ 核心事实：agent 就是三层嵌套 workflow

```
agent.stream() → #execute (agent.ts:6467)
  └─ execution-workflow        .parallel().map().then()      (prepare-stream/index.ts:184)
       └─ agentic-loop         .dowhile(停止条件)             (loop/agentic-loop/index.ts:24)
            └─ agentic-execution .then().map().foreach().then()...  (loop/agentic-execution/index.ts:113)
```

**学 06 之前必须先学 05（workflow）和 07（loop）。** 这三层都是 workflow，控制流见 05.2，循环见 07.2。

## ⚠️ 过期信息

- **不存在 `agent/network/` 目录**：network 在 `loop/network/index.ts`（见 07）
- `package.json` 的 `./network/vNext` 导出**已失效**

## 学习路径（4 篇深度文档）

| 主题           | 文档                                                   | 一句话                                            |
| -------------- | ------------------------------------------------------ | ------------------------------------------------- |
| 构造配置       | [01-agent-config.md](./01-agent-config.md)             | 最小配置、instructions/metadata、ephemeral mastra |
| ⭐ 动态解析    | [02-dynamic-resolution.md](./02-dynamic-resolution.md) | **DynamicArgument——多租户的关键**                 |
| 结构化输出     | [03-structured-output.md](./03-structured-output.md)   | structuredOutput schema → output.object           |
| requestContext | [04-request-context.md](./04-request-context.md)       | 请求级总线流进 agent/工具，越权防护               |

**loop 机制（generate/stream→#execute、工具循环、steps）在 07-loop 详讲**——因为 agent.stream 的执行实际发生在 loop/。06 聚焦 Agent 自身的配置与解析。

## 可跑示例

`examples/` 下 **4 个测试文件、17 个用例**，零构建、~5s 跑完（详见 [examples/README.md](./examples/README.md)）：

```bash
cd docs/learning/06-agent/examples
npx vitest run                    # 全跑
npx vitest run 02-dynamic-resolution   # 只跑多租户
```

复用 05 的 vitest alias 配置 + 07 的 mock-model。不调真实 provider。

## 示例里挖到的真实细节（已验证）

- **`getToolsForExecution({})` 要传 options 对象**：不传抛 `reading 'requestContext' of undefined`（[01](./01-agent-config.md)）
- **`metadata`/`instructions` 是 async 方法**（`getMetadata`/`getInstructions`）：支持 DynamicArgument（[01](./01-agent-config.md)）
- **model/instructions 可以是函数**：按 requestContext 动态解析，一个 Agent 服务多租户（[02](./02-dynamic-resolution.md)）
- **ephemeral mastra**：不注册 Mastra 也能 stream（agent 自己造临时实例）（[01](./01-agent-config.md)）
- **`structuredOutput: { schema }` → `output.object`**：不配则 object 为 undefined（[03](./03-structured-output.md)）

## Agent 类的 8 步执行（generate，`agent.ts:7291`）

1. `#extractClientObservability` —— 提取客户端遥测
2. `#validateRequestContext` —— 校验
3. `getDefaultOptions` + `deepMerge` —— 合并参数
4. `#requireAgentExecutionFGA` —— **权限检查（auth/ee，企业级）**
5. `getLLM()` → 模型解析
6. `toStandardSchema(structuredOutput.schema)` —— schema 转换
7. `await #execute({ methodType: 'generate' })`
8. `await result.result.getFullOutput()`

`stream()`（`:7859`）几乎相同，多 thread 串行化 + untilIdle 处理。

## 工具的 11 个来源（汇入 `convertTools` agent.ts:5751）

`listAssignedTools`(4227)、`listToolsets`(4300)、`listClientTools`(4374)、`listAgentTools`(4490)、`listWorkflowTools`(5415)、`listMemoryTools`(3428)、`listWorkspaceTools`(3505)、`listChannelTools`(3583)、`listSkillTools`(3647)、`listBrowserTools`(3727)、`listInputProcessorLoadedTools`(3801)。

## 关键源码文件

| 路径                                      | 行数 | 作用                    | 文档 |
| ----------------------------------------- | ---- | ----------------------- | ---- |
| `agent/agent.ts`                          | 8952 | `Agent` 类(457)         | 01   |
| `agent/workflows/prepare-stream/index.ts` | —    | execution-workflow(184) | 01   |
| `agent/agent.types.ts`                    | 723  | `AgentExecutionOptions` | —    |
| `agent/message-list/message-list.ts`      | 1743 | 消息中枢                | —    |
| `agent/trip-wire.ts`                      | —    | processor 中断（见 08） | —    |
| `agent/durable/durable-agent.ts`          | 2644 | 持久化 agent（第二遍）  | —    |

## 校正记录

相对初版（导航索引）的补充：

- ✅ `getToolsForExecution({})` 要传 options（实测坑）
- ✅ `metadata`/`instructions` 是 async 方法（初版没提）
- ✅ ephemeral mastra 让 agent 可独立使用（初版提了概念，这里有用例）
- ✅ 动态解析（DynamicArgument）的多租户实战（初版只提了概念）
