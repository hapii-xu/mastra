# 13. Evals & Datasets — 评测

## 模块职责

**给 Agent 的输出打分，并在数据集上跑批量实验。**

**企业级为什么重要**：Agent 的输出是不确定的，「改了 prompt 之后是变好还是变差」这个问题，**只能靠评测回答，不能靠感觉**。没有评测体系，Agent 应用就无法持续迭代——这是它和普通软件最大的区别。

两个模块合起来学：

| 模块        | 行数 | 作用                            |
| ----------- | ---- | ------------------------------- |
| `evals/`    | 11k  | **scorer**：怎么给一次输出打分  |
| `datasets/` | 10k  | **实验**：在一批数据上跑 scorer |

## 前置依赖

- **06-agent**（必须）：评测对象
- 05-workflows（必须）：scorer 本身是 workflow
- 12-observability（建议）：`scoreTraces` 给线上 trace 打分
- 10-storage（建议）：分数、数据集要落库

## 核心概念

### 1. `createScorer` —— 四步流水线

`evals/base.ts:1064-1083`（4 个重载 + 实现）。整个文件 1352 行。

Scorer 是个**四步流水线**，每步可选：

| 步骤                 | 作用       | 对应 prompt            |
| -------------------- | ---------- | ---------------------- |
| **`preprocess`**     | 预处理     | `preprocessPrompt`     |
| **`analyze`**        | 分析       | `analyzePrompt`        |
| **`generateScore`**  | **出分数** | `generateScorePrompt`  |
| **`generateReason`** | 出理由     | `generateReasonPrompt` |

类型上用**累积泛型**（`TAccumulated`，`base.ts:239-258`）串起来：后一步能拿到前一步的结果，且**类型安全**——`generateReason` 的 context 里 `score` 字段的类型是从 `generateScoreStepResult` 推出来的。

**这是个设计得很漂亮的类型体操**，值得单独读。每步都有对应的 `*Prompt`，说明这四步可以是 LLM-as-judge（用模型打分）。

`filterRun()`（`base.ts:1223`）—— 过滤要评的 run。

### 2. Scorer 也是 workflow

跟 processor 一样，scorer 集成在 workflow 执行里：`runScorersForStep()`（`workflows/handlers/step.ts:549`）——**每个 workflow step 执行后都可以跑 scorer**。

注册钩子：`createOnScorerHook`（`mastra/hooks.ts`，177 行，见 11）。

### 3. `scoreTraces` —— 给线上流量打分

`evals/scoreTraces/scoreTracesWorkflow.ts`（474 行）。单独导出：`@mastra/core/evals/scoreTraces`。

**这是企业级最实用的能力**：不是在测试集上评，而是**对线上真实 trace 采样打分**，持续监控质量。关联 12-observability。

### 4. `datasets/` —— 批量实验

| 文件                              | 行数 | 作用            |
| --------------------------------- | ---- | --------------- |
| `datasets/experiment/index.ts`    | 658  | 实验主体        |
| `datasets/experiment/executor.ts` | 574  | 执行器          |
| `datasets/dataset.ts`             | 567  | 数据集          |
| `datasets/experiment/scorer.ts`   | 493  | 实验里的 scorer |
| `datasets/manager.ts`             | —    | 管理            |

存储：`storage/domains/datasets`、`storage/domains/experiments`、`storage/domains/scores`、`storage/domains/scorer-definitions`（见 10）。

### 5. `evals/run/` —— 单次评测执行

`evals/run/index.ts`（1062 行）。

`evals/collect-tool-mocks.ts` —— **收集工具 mock**，单独导出 `@mastra/core/utils/collect-tool-mocks`。评测时把工具调用 mock 掉，保证可复现。**这是做确定性评测的关键工具。**

### 6. 与 Agent Goal 的关系

`agent/goal/` 里有 `scorer`、`objective`、`signal-provider`、`state-processor`；`loop/workflows/agentic-execution/goal-step.ts`（504 行）是循环里的目标评估步骤。

**scorer 不只用于离线评测，也能在运行时驱动 agent 行为**（目标达成判定）。这条线关联 06/07。

### 7. `hooks.ts` 与 `utils`

- `evals/hooks.ts` —— 钩子
- `core/src/hooks/` —— 依赖 evals
- `core/src/utils.ts` —— 依赖 evals

（这两个模块反向依赖 evals，是依赖环的一部分。）

## 关键源码文件

| 路径                                       | 行数 | 作用                                                    | 建议                     |
| ------------------------------------------ | ---- | ------------------------------------------------------- | ------------------------ |
| `evals/base.ts`                            | 1352 | **`createScorer`(1064)、四步流水线、`filterRun`(1223)** | **精读**                 |
| `evals/types.ts`                           | 1005 | 类型面                                                  | 查阅式                   |
| `evals/run/index.ts`                       | 1062 | 单次评测执行                                            | 后读                     |
| `evals/base.test-utils.ts`                 | 895  | **测试工具，也是最好的用法参考**                        | **先读**                 |
| `evals/scoreTraces/scoreTracesWorkflow.ts` | 474  | **线上 trace 打分**                                     | **企业级必读**           |
| `evals/collect-tool-mocks.ts`              | —    | 工具 mock 收集                                          | **必读，确定性评测关键** |
| `datasets/experiment/index.ts`             | 658  | 实验                                                    | 先读                     |
| `datasets/experiment/executor.ts`          | 574  | 执行器                                                  | 后读                     |
| `datasets/dataset.ts`                      | 567  | 数据集                                                  | 先读                     |
| `workflows/handlers/step.ts:549`           | —    | `runScorersForStep`                                     | 必读，很短               |
| `mastra/hooks.ts`                          | 177  | `createOnScorerHook`                                    | 短，必读                 |
| `agent/goal/`                              | —    | 目标驱动                                                | 关联 06/07               |

## 执行链路追踪

```
【离线评测】
createScorer({ preprocess, analyze, generateScore, generateReason })   evals/base.ts:1064
  └─ 四步流水线（每步可选，类型累积）
       ↓
Experiment                              datasets/experiment/index.ts
  └─ executor                           datasets/experiment/executor.ts
       └─ 遍历 dataset                  datasets/dataset.ts
            ├─ collectToolMocks()       evals/collect-tool-mocks.ts   ← 保证可复现
            ├─ 跑 agent
            └─ 跑 scorer → 分数
                 └─ storage.stores.scores.*

【运行时评分】
workflow step 执行后
  └─ runScorersForStep()                workflows/handlers/step.ts:549
       └─ createOnScorerHook()          mastra/hooks.ts

【线上 trace 打分】
observability 的 trace（见 12）
  └─ scoreTracesWorkflow                evals/scoreTraces/scoreTracesWorkflow.ts
       └─ filterRun()                   evals/base.ts:1223  ← 采样
       └─ scorer → 分数

【目标驱动（运行时）】
agentic-execution 的 goalStep         loop/workflows/agentic-execution/goal-step.ts
  └─ agent/goal/scorer
```

## 示例与测试入口

```bash
pnpm --filter @mastra/core test evals/base.test.ts
pnpm --filter @mastra/core test evals/prepareRun.test.ts
pnpm --filter @mastra/core test evals/collect-tool-mocks.test.ts
pnpm --filter @mastra/core test evals/types.test.ts
pnpm --filter @mastra/core test datasets/
```

**`evals/base.test-utils.ts`（895 行）是最好的用法参考**——比读 `base.ts` 更快建立手感。

`scorer-custom-gateway.e2e.test.ts` 打真实模型，跳过。
`__snapshots__/` 里有快照，能看到 scorer 的实际输出形状。

可跑项目：`examples/evals-with-memory`

## Debug 断点建议

| 断点                                                   | 观察什么                                        |
| ------------------------------------------------------ | ----------------------------------------------- |
| `evals/base.ts:1083` (`createScorer` 实现)             | 四步怎么被组装                                  |
| 你的 scorer 的 `generateScore`                         | **拿到的 context 里有什么**——前面几步的累积结果 |
| `workflows/handlers/step.ts:549` (`runScorersForStep`) | 运行时评分的触发时机                            |
| `evals/collect-tool-mocks.ts`                          | mock 收集到了什么                               |
| `datasets/experiment/executor.ts`                      | 实验的并发与迭代                                |

**建议动作**：写一个最简单的 scorer（只有 `generateScore`，返回固定值），跑通链路，再逐步加 `analyze` / `generateReason`，观察 context 的累积。四步流水线的类型体操，跟一遍就懂了。

## 设计取舍与坑

- **四步流水线的类型累积很优雅**，但也意味着**改中间步骤会引发类型连锁反应**。写复杂 scorer 时有心理准备。
- **LLM-as-judge 有成本也有偏差**。四个 `*Prompt` 说明每步都能用模型，但每次评测 = 额外的模型调用。批量实验时成本可观（关联 08 的 `cost-guard`）。
- **确定性评测靠 `collect-tool-mocks`**。不 mock 工具，评测结果不可复现——因为工具可能调外部服务。**这是评测体系的地基。**
- **`scoreTraces` 是被低估的能力**。离线测试集永远跟不上真实流量的分布，线上采样打分才是持续质量监控的正解。
- **scorer 也能驱动运行时行为**（`agent/goal/` + `goalStep`），别只把它当离线工具。
- **`evals`、`hooks`、`utils` 互相依赖**，是核心依赖环的一部分。

## 后续细化 TODO

- [ ] **四步流水线的类型累积机制**（`base.ts:239-258`）——`TAccumulated` 怎么串起来的
- [ ] `createScorer` 4 个重载的区别与选用
- [ ] 内置 scorer 有哪些？（`grep -rn "createScorer" packages/ --include="*.ts" | grep -v test`）
- [ ] **`scoreTraces` 完整链路**：怎么采样、怎么关联 trace、怎么落库（**企业级最该先做的**）
- [ ] `collect-tool-mocks` 的收集与回放机制
- [ ] `datasets/experiment/executor.ts`：并发、重试、失败处理
- [ ] `runScorersForStep` 的性能影响——每步都评会不会拖慢？
- [ ] `filterRun` 的采样策略
- [ ] `agent/goal/` + `goalStep` 的目标驱动完整链路（关联 06/07）
- [ ] LLM-as-judge 的成本模型与优化（关联 08/12）
- [ ] 评测指标体系设计：企业级该评什么
- [ ] `storage/domains/scores` / `scorer-definitions` 的数据模型（关联 10）
