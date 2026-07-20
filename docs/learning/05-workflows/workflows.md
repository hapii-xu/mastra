# 05. Workflows — 执行底座 ⭐

## 模块职责

**整个框架的执行引擎。** 步骤编排、控制流、挂起/恢复、重试、快照持久化。

> **全路线最重要的模块。** 因为——
>
> **agent 是构建在 workflows 之上的。** 一次 `agent.stream()` 展开是三层嵌套 workflow；processor 会被编译成 workflow step；Agent/Tool/Workflow/Processor 四种东西都能通过 `createStep()` 变成 step。
>
> **先学 workflow，agent 那 8952 行才可读。**

## ⚠️ 过期信息

**`createRunAsync()` 已改名 `createRun()`**（本身就是 async，返回 `Promise<Run>`）。全仓库只有 codemod 里还有旧名。

## 学习路径（5 篇深度文档）

| 主题     | 文档                                                               | 一句话                                               |
| -------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| 基础     | [01-workflow-basics.md](./01-workflow-basics.md)                   | Workflow/Run/createStep、结果形状、commit            |
| 控制流   | [02-control-flow.md](./02-control-flow.md)                         | then/parallel/branch/dowhile/foreach/map 全原语      |
| 挂起恢复 | [03-suspend-resume.md](./03-suspend-resume.md)                     | HITL 基础、品牌类型、resume 要存储                   |
| 引擎重试 | [04-engine-and-retry.md](./04-engine-and-retry.md)                 | direct/evented、retryConfig、MastraNonRetryableError |
| 多态     | [05-create-step-polymorphism.md](./05-create-step-polymorphism.md) | 万物皆可成 step（含 v1.0 breaking change）           |

### ⭐ 本模块的核心事实：agent 就是三层嵌套 workflow

```
agent.stream() → #execute (agent.ts:6467)
  └─ execution-workflow        .parallel().map().then()      (prepare-stream/index.ts:184)
       └─ agentic-loop         .dowhile(停止条件)             (loop/agentic-loop/index.ts:24)
            └─ agentic-execution .then().map().foreach().then()...  (loop/agentic-execution/index.ts:113)
```

**「Agent 能自主循环调用工具直到完成任务」的本质，就是一个 `.dowhile()`。** 详见 [02-control-flow.md](./02-control-flow.md)。

## 可跑示例

`examples/` 下 **5 个测试文件、32 个用例**，零构建、~5s 跑完（详见 [examples/README.md](./examples/README.md)）：

```bash
cd docs/learning/05-workflows/examples
npx vitest run                    # 全跑
npx vitest run 02-control-flow    # 只跑控制流
```

**和 01 不同的是**：05 的示例通过 vitest alias 把 8 个 `@internal/*` 和 `@mastra/schema-compat` bare specifier 重定向到源码，绕开构建。这套配置 06/07 复用。

## 示例里挖到的真实坑（已验证）

- `retryConfig` 的字段是 **`attempts` 不是 `retries`**——写错静默不重试（[04](./04-engine-and-retry.md)）
- **resume 必须有存储**：裸 workflow 能 start，resume 抛 "No snapshot found"——HITL 必须注册 Mastra（[03](./03-suspend-resume.md)）
- **`.branch` 是 `[condFn, step]` 元组**，不是 `{when, then}`（[02](./02-control-flow.md)）
- **tool 作为 step 时 execute 读位置参数**（v1.0 breaking change），不是 `{context}`（[05](./05-create-step-polymorphism.md)）
- **结果形状**：`res.result`（最终）+ `res.steps.<id>.output`（每步）；`runId` 在 Run 不在 res（[01](./01-workflow-basics.md)）

## 关键源码文件

| 路径                                 | 行数 | 作用                                             | 文档     |
| ------------------------------------ | ---- | ------------------------------------------------ | -------- |
| `workflows/workflow.ts`              | 4546 | `Workflow`(1544)、`Run`(2978)、`createStep`(207) | 01/02/05 |
| `workflows/step.ts`                  | 193  | 品牌类型 suspend                                 | 03       |
| `workflows/create.ts`                | —    | 工厂 + 隐式 evented 提升                         | 04       |
| `workflows/default.ts`               | 1108 | `DefaultExecutionEngine`(55)、`execute`(712)     | 04       |
| `workflows/handlers/control-flow.ts` | 1378 | 并行/分支/循环实现                               | 02       |
| `workflows/handlers/entry.ts`        | 791  | 入口分派、快照持久化                             | 04       |
| `workflows/types.ts`                 | 1183 | `WorkflowRunState`、`suspendedPaths`             | 03       |
| `workflows/evented/`                 | —    | evented 引擎（第二遍）                           | 04       |

## 校正记录

相对初版（导航索引）的修正/补充：

- ✅ `retryConfig` 字段是 `attempts`（初版没提，是个坑）
- ✅ `.branch` API 是 `[condFn, step]` 元组（初版没给具体 API）
- ✅ tool-as-step 的 v1.0 breaking change（位置参数，初版没提）
- ✅ 结果形状 `res.result` + `res.steps.<id>.output`（初版没写）
- ✅ resume 需要存储的完整原因链（初版只提了 suspend/resume 概念）
