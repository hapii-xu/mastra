# Mastra 源码学习路线

面向「企业级 AI Agent 自研」的源码学习索引。学习方式：**每个模块的示例 + 源码 + debug 单步执行**。

> **先会用再看源码？** 见 [SDK-QUICKSTART.md](./SDK-QUICKSTART.md)（官方 course / create-mastra / examples/agent + Studio 4111）。
> **断点清单？** 见 [DEBUG-BREAKPOINTS.md](./DEBUG-BREAKPOINTS.md)。

本目录是**导航式索引**，不是教程。每份 `.md` 的作用是告诉你：这个模块干什么、该读哪几个文件、执行链路怎么走、断点打在哪、坑在哪。真正的理解发生在你打开 IDE 单步跑的时候。

> 代码坐标（`file:line`）采集于 2026-07-14，基于 commit `44ec81392a`。行号会随代码漂移，**类名/方法名是稳定的锚点**——行号对不上时用 `grep -n "方法名" 文件` 重新定位。

---

## 一、先看懂这张图

整个框架最重要的结构事实：**`workflows/` 是底座，`agent/` 是它的调用方。**

`agent.stream()` 展开后是**三层嵌套 workflow**：

```
agent.stream()                              agent/agent.ts:7859
  └─ #execute()                             agent/agent.ts:6467
       │
       └─ execution-workflow                agent/workflows/prepare-stream/index.ts:184
            .parallel([prepareToolsStep, prepareMemoryStep])
            .map(mapResultsStep)
            .then(streamStep)
              │
              └─ llm.stream()               llm/model/model.loop.ts:106
                   └─ loop()                loop/loop.ts:11
                        └─ workflowLoopStream()          loop/workflows/stream.ts
                             │
                             └─ agentic-loop workflow    loop/workflows/agentic-loop/index.ts:24
                                  .dowhile(agenticExecutionWorkflow, 停止条件)
                                    │
                                    └─ agentic-execution  loop/workflows/agentic-execution/index.ts:113
                                         .then(llmExecutionStep)      ← 调模型
                                         .map(map-tool-calls)         ← 算并发度
                                         .foreach(toolCallStep)       ← 执行工具
                                         .then(llmMappingStep)
                                         .then(backgroundTaskCheckStep)
                                         .then(signalDrainStep)
                                         .then(isTaskCompleteStep)
                                         .then(goalStep)
```

不止如此——**processor 也会被编译成 workflow step**（`combineProcessorsIntoWorkflow()`，`agent/agent.ts:1455`）。`createStep()` 的重载（`workflows/workflow.ts:207-338`）接受 Agent、Tool、Workflow、Processor 四种东西，全都能变成 step。

**结论：先学 workflow，再看 agent。** 顺序反了，`agent.ts` 那 8952 行就是天书；顺序对了，它只是「一个把 workflow 组装起来的大工厂」。

### 依赖不是 DAG，中心是一个环

```
agent ↔ mastra ↔ storage ↔ processors ↔ loop ↔ stream ↔ workflows ↔ tools
```

这 8 个模块互相引用，**不存在自底向上无环推进的学法**。下面的顺序是「可理解的切入顺序」，不是依赖拓扑序。每个模块的 `.md` 里都写明了「前置依赖」和「暂时跳过、后面再回来」的部分——照着跳，别硬啃。

---

## 二、模块顺序表

`core/src` 实际有 58 个顶层目录、约 24 万行非测试 TS。下面 14 个是**企业级 Agent 真正要碰的核心路径**，其余是边缘能力或 Mastra 自家产品（Studio / Agent Builder）的支撑代码。

| #                                           | 模块            | 一句话职责                                        | 规模        | 前置        | 建议投入   |
| ------------------------------------------- | --------------- | ------------------------------------------------- | ----------- | ----------- | ---------- |
| [01](./01-foundation/foundation.md)         | foundation      | `MastraBase`、错误、`RequestContext` 等零依赖叶子 | ~1.5k       | —           | 半天       |
| [02](./02-tools/tools.md)                   | tools           | `createTool`、工具 schema 兼容层                  | 16k         | 01          | 1 天       |
| [03](./03-llm/llm.md)                       | llm             | 模型路由、gateway、fallback                       | 22k         | 01          | 1 天       |
| [04](./04-stream/stream.md)                 | stream          | `MastraModelOutput` 输出契约                      | 13k         | 01          | 1 天       |
| [05](./05-workflows/workflows.md)           | **workflows**   | **执行底座**：控制流、suspend/resume              | 29k         | 01          | **3-4 天** |
| [06](./06-agent/agent.md)                   | **agent**       | **核心**：Agent 类与执行编排                      | 154k        | 02,03,04,05 | **5-7 天** |
| [07](./07-loop/loop.md)                     | loop            | agentic 循环 + multi-agent network                | 54k         | 05,06       | 2-3 天     |
| [08](./08-processors/processors.md)         | processors      | 输入输出管道、企业级护栏                          | 45k         | 05,06       | 2 天       |
| [09](./09-memory/memory.md)                 | memory          | 记忆抽象 + 语义召回实现                           | 4k + 独立包 | 06,10       | 2 天       |
| [10](./10-storage-vector/storage-vector.md) | storage/vector  | 可插拔持久化，25 个 domain                        | 37k         | 01          | 2 天       |
| [11](./11-mastra/mastra.md)                 | **mastra**      | DI 汇总点，**必须最后学**                         | 13k         | 全部        | 1-2 天     |
| [12](./12-observability/observability.md)   | observability   | 链路追踪契约与实现分离                            | 4.5k        | 06          | 1 天       |
| [13](./13-evals/evals.md)                   | evals/datasets  | scorer、实验、回归评测                            | 21k         | 06          | 1-2 天     |
| [14](./14-server-deploy/server-deploy.md)   | server/deployer | 上线部署                                          | 2k          | 11          | 1 天       |

**为什么 `mastra/` 放最后**：它是 DI 汇总点，`mastra/index.ts` 5725 行里 import 了约 30 个模块。先认识零件，再看装配图。

**本路线不覆盖**：`workspace`(48k)、`browser`、`editor`、`coding-agent`、`channels`、`a2a`、`tts`、`voice`、`skills`、`agent-builder`、`agent-controller`、`harness`、`worker`、`notifications`、`signals`、`background-tasks`、`schedules`、`auth`。

---

## 三、通用 debug 方法

### 🟢 零构建起点：01-foundation 的可跑示例

**全路线唯一不受 TS6 构建问题影响的入口。** `docs/learning/01-foundation/examples/` 自带 vitest 配置，用相对路径直接 import `_internal-core` 源码，**不需要任何构建，~300ms 跑完 104 个用例**：

```bash
cd docs/learning/01-foundation/examples && npx vitest run
```

建议作为第一站——在解决构建问题之前就能开始单步学习。详见 [01-foundation/foundation.md](./01-foundation/foundation.md)。

### 最快的单步入口：跑单个测试文件

**别去搭 demo 项目跑 agent**——真实模型调用不确定、慢、要 key。这个仓库的测试本身就是最好的可执行文档：743 个测试文件，约 522 个与源码同目录。

#### ⚠️ 必须先构建依赖，否则测试跑不起来（已实测）

```bash
pnpm install
pnpm turbo build --filter ./packages/core    # 必须！构建 core 的依赖图
```

**不构建就直接跑测试会失败**，而且报错很有迷惑性——它不说「你没构建」，而是报找不到模块，且是一层层往下报的：

```
Cannot find module '@internal/test-utils/setup'      ← 第一个
Cannot find package '@internal/ai-sdk-v5/test'       ← 建完上一个又来这个
Cannot find package '@mastra/core/agent'             ← 还有
```

原因：`packages/core/vitest.config.ts:32` 里 `setupFiles: ['@internal/test-utils/setup']` 走的是包的 `exports` → 指向 `dist/`。**没有 dist 就没有一切。**

AGENTS.md 里那句「Unresolvable internal/workspace imports means deps aren't built」说的就是这个。**看到 `Cannot find module '@internal/...'` 或 `'@mastra/...'`，答案永远是「去构建」，别去查代码。**

构建好之后：

```bash
# 跑单个测试文件（推荐的日常姿势）
pnpm --filter @mastra/core test workflows/workflow.test.ts

# 只跑某个用例
pnpm --filter @mastra/core test agent/agent.test.ts -t "should generate"
```

`.e2e.test.ts` 结尾的会打真实 provider，日常学习跳过。

#### 🔧 已知环境问题：TypeScript 6 导致构建失败

**本机（2026-07-14）实测：`pnpm turbo build` 会失败**，报错：

```
error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0.
  Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.
DTS Build error
```

仓库 catalog 声明的就是 `typescript: ^6.0.3`（`pnpm-workspace.yaml:42`），装的也确实是 6.0.3——但 tsup 的 **DTS 阶段**在 TS6 下会因 `baseUrl` 弃用而硬失败。

**这不影响你学习**——DTS 只生成类型声明，跑测试不需要。绕过办法：

```bash
# 单个包跳过 DTS 构建（够用了）
cd packages/_test-utils && pnpm exec tsup --no-dts
```

如果你要完整构建整个依赖图，可能需要在根 `tsconfig` 加 `"ignoreDeprecations": "6.0"`，或临时把 typescript 降到 5.x。**遇到 `TS5101` 别怀疑自己，是环境问题。**

### mock model 是关键钥匙

`packages/core/src/agent/__tests__/mock-model.ts` 是全仓库测试用的 mock 模型。**想单步跟 agent 执行链，就从一个用了 mock-model 的测试起步**——模型响应确定，可以反复跑同一条链路。写任何自己的探索性测试，都从这里抄。

`@mastra/core/test-utils/llm-mock` 也是对外导出的，你自己的项目里也能用。

### VS Code 断点配置

vitest 支持直接 debug。`.vscode/launch.json` 加：

```jsonc
{
  "type": "node",
  "request": "launch",
  "name": "Debug vitest",
  "autoAttachChildProcesses": true,
  "skipFiles": ["<node_internals>/**"],
  "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
  "args": ["run", "${relativeFile}"],
  "cwd": "${workspaceFolder}/packages/core",
  "console": "integratedTerminal",
}
```

### 追执行链的三个总断点

如果你只想快速看清「一次 agent 调用到底发生了什么」，先打这三个：

| 断点                                                                | 观察什么                                           |
| ------------------------------------------------------------------- | -------------------------------------------------- |
| `agent/agent.ts:6467` (`#execute`)                                  | 合并后的最终 options；准备进入 workflow 的所有输入 |
| `loop/workflows/agentic-execution/llm-execution-step.ts` 的 execute | 每一轮真正发给模型的 messages、tools               |
| `loop/workflows/agentic-loop/index.ts:24` 的 `.dowhile` 停止条件    | 循环为什么继续 / 为什么停                          |

### 环境变量开关

```bash
MASTRA_EVENTED_EXECUTION=true   # 切到 evented（跨进程 pubsub）workflow 引擎，默认 direct
MASTRA_WORKERS=...              # 过滤自动创建的 worker
```

---

## 四、过期信息纠正清单

学习时会撞上的坑——文档、旧博客、AI 生成的代码里仍在流传，但**源码里已经不是这样了**：

| 说法                             | 实际情况                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow.createRunAsync()`      | **已改名为 `createRun()`**（本身就是 async，返回 `Promise<Run>`）。全仓库只有 codemod 里还有旧名：`packages/codemod/src/codemods/v1/workflow-create-run-async.ts` |
| network 在 `agent/network/`      | **不存在这个目录**。network 实现在 `loop/network/index.ts`（2708 行）                                                                                             |
| `@mastra/core/network/vNext`     | **失效导出**。`package.json` 指向 `dist/network/vNext/`，但 `src/network/` 根本不存在                                                                             |
| `core/src/di/` 是 DI 容器        | **不是**。只有 8 行，是 `RequestContext` 的 re-export 壳。真正的 DI 在 `mastra/index.ts` 的构造函数里                                                             |
| `core/src/telemetry/` 是链路追踪 | **不是**。那是产品埋点（PostHog）。链路追踪在 `core/src/observability/`（只有契约）+ 仓库根 `observability/`（实现）                                              |

另外几个**极小的目录**，别按「大模块」的预期点进去：`types`(1 行)、`relevance`(2 行)、`run`(5 行)、`di`(8 行)、`deployer`(14 行)、`schema`(16 行)、`action`(20 行)、`tts`(24 行)、`features`(30 行)、`bundler`(50 行)。

但**其中三个虽小却重要，不要跳过**：

| 目录                | 行数 | 为什么重要                                                          |
| ------------------- | ---- | ------------------------------------------------------------------- |
| `action/index.ts`   | 20   | **定义 `MastraPrimitives`**——DI 的两种注入约定之一（见 11）         |
| `deployer/index.ts` | 14   | **`MastraDeployer` 抽象**——整个部署体系就这 14 行（见 14）          |
| `bundler/index.ts`  | 50   | `MastraBundler`，**有 `loadEnvVars()` 的实际实现**，不是壳（见 14） |

其余（`di`、`run`、`schema`、`types`、`relevance`、`tts`、`features`）确实只是 re-export，可以跳过。

---

## 五、示例与模板在哪

`examples/` 只有 7 个，**`templates/` 反而更适合学习**（是完整可跑的项目）：

| 学什么        | 去哪看                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------- |
| agent、tools  | `examples/agent`                                                                              |
| workflow      | `examples/inngest`（外部 runner 版工作流）                                                    |
| memory        | `examples/evals-with-memory`                                                                  |
| durable agent | `examples/durable-agents`                                                                     |
| RAG           | **没有 example**，看 `templates/template-company-knowledge`、`templates/template-deep-search` |
| Studio UI     | `examples/studio-preview`                                                                     |

官方文档在 `docs/src/content/en/docs/`（概念）和 `docs/src/content/en/reference/`（API）。`docs/src/course/` 是站点上的入门课（4 个模块），适合先花两小时过一遍建立手感，再回来啃源码。

---

## 六、给企业级落地的提前提示

学的过程中留意这几处，它们直接决定你的架构决策：

- **执行引擎二选一**：direct（默认，进程内）vs evented（`MASTRA_EVENTED_EXECUTION=true`，pubsub 跨进程）。默认 direct 的原因是 evented 路径会把 requestContext 做 JSON round-trip，**丢函数和循环引用**。多实例部署前必须搞清这个取舍（见 05、06）。
- **存储默认是内存的**：不配 `storage` 时 Mastra 会注入 `InMemoryStore` 并打 warning。生产必须显式配（见 10、11）。
- **护栏在 processors**：moderation、PII 检测、prompt 注入检测、token 限流、成本管控全在 `processors/processors/`（见 08）。
- **可观测性要装额外包**：`core/src/observability/` 只有契约，实现在 `@mastra/observability`（见 12）。
