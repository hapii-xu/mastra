# 07. Loop — agentic 循环与多 Agent 协作

## 模块职责

**Agent「自主循环」的实际实现，以及多 Agent 协作（network）。**

06-agent 是**编排与配置**，07-loop 是**执行**。`agent.stream()` 最终把控制权交给这里。

标称 54k 行，但**约 16k 行是 `loop/test-utils/`（夹具）**，实际源码约 12k 行。

## ⚠️ 过期信息

- **network 不在 `agent/network/`**（该目录不存在），而在 `loop/network/index.ts`（2708 行）
- `package.json` 的 `./network/vNext` 导出**已失效**

## 学习路径（3 篇深度文档）

| 主题                   | 文档                                                             | 一句话                                           |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| 基础                   | [01-loop-basics.md](./01-loop-basics.md)                         | loop 是 agent 下游、入口、getFullOutput 产物     |
| ⭐ 工具循环            | [02-loop-with-tools.md](./02-loop-with-tools.md)                 | **自主循环 = .dowhile，停止条件看 finishReason** |
| steps/runScope/network | [03-steps-runcscope-network.md](./03-steps-runcscope-network.md) | loop 脚印、两个 scope、多 agent                  |

### ⭐ 本模块最好的一课：「自主循环」= 一个 .dowhile

```
模型返回 finishReason:'tool-calls' → loop 执行工具 → 再调模型
模型返回 finishReason:'stop'        → loop 结束
```

**没有神秘推理引擎，就是循环 + 停止条件。** 详见 [02](./02-loop-with-tools.md)。这一课让 agent 祛魅一半。

## 可跑示例

`examples/` 下 **3 个测试文件、14 个用例**，零构建、~5s 跑完（详见 [examples/README.md](./examples/README.md)）：

```bash
cd docs/learning/07-loop/examples
npx vitest run                  # 全跑
npx vitest run 02-loop-with-tools   # 只跑招牌课
```

**关键**：用内联 mock 模型（`examples/mock-model.ts`）走通真实 loop/ 源码，不调真实 provider。复用 05 的 vitest alias 配置。

## 示例里挖到的真实细节（已验证）

- **`output.steps` = loop 的脚印**：每轮循环一个 step，调 N 次工具 = N+1 个 step（[03](./03-steps-runcscope-network.md)）
- **工具结果的真实值在 `.payload.result`**（字段名不是 `output`）：`output.toolResults`（顶层，跨轮聚合）和 `output.steps[i].toolResults`（单轮）都能找到（[02](./02-loop-with-tools.md)）
- **停止条件看 `finishReason`**：`tool-calls` 继续，`stop` 结束（[02](./02-loop-with-tools.md)）
- **mock 要按 v3 协议发流**：`stream-start`→`response-metadata`→`text-*`/`tool-call`→`finish`（[01](./01-loop-basics.md)）
- **两个 runScope 极易混淆**：prepare-stream（闭包）vs loop（Mastra 注册）（[03](./03-steps-runcscope-network.md)）

## agentic-execution 一轮循环的 8 个 step

```
.then(llmExecutionStep)      ← 调模型
.map(map-tool-calls)         ← 算并发度
.foreach(toolCallStep)       ← 执行工具
.then(llmMappingStep)
.then(backgroundTaskCheckStep)
.then(signalDrainStep)
.then(isTaskCompleteStep)    ← 影响 dowhile 停止条件
.then(goalStep)
```

## 关键源码文件

| 路径                                                     | 行数 | 作用                | 文档 |
| -------------------------------------------------------- | ---- | ------------------- | ---- |
| `loop/loop.ts`                                           | ~50  | 入口                | 01   |
| `loop/workflows/agentic-loop/index.ts`                   | 298  | **`.dowhile` 循环** | 02   |
| `loop/workflows/agentic-execution/index.ts`              | ~150 | 8 step 编排         | 02   |
| `loop/workflows/agentic-execution/llm-execution-step.ts` | 2179 | 调模型（最大）      | 02   |
| `loop/workflows/agentic-execution/tool-call-step.ts`     | 1298 | 执行工具            | 02   |
| `loop/run-scope-*.ts`                                    | —    | **两个 scope 机制** | 03   |
| `loop/network/index.ts`                                  | 2708 | network             | 03   |
| `loop/test-utils/`                                       | ~16k | **夹具，不是源码**  | —    |
