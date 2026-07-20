# 12. Observability — 可观测性

## 模块职责

**追踪 Agent 运行的每一步：span、指标、日志、评分、反馈。**

企业级刚需：Agent 是个黑盒，没有 trace 就没法排查「为什么这次答错了」「钱花在哪了」「哪一步慢」。

## 前置依赖

- **06-agent**（必须）：span 挂在 agent/workflow 执行上
- 05-workflows（必须）：`WORKFLOW_RUN` span
- 10-storage（建议）：追踪数据要落库

## ⚠️ 两个必须先纠正的认知

### 1. `core/src/telemetry/` 不是链路追踪

它是**产品埋点**（PostHog）：`posthog.ts`、`usage-telemetry.ts`、`feature-telemetry.ts`、`context.ts`。是 Mastra 自己收集使用数据用的。**跟你的可观测性需求无关。**

### 2. `core/src/observability/` 只有契约，没有实现

`observability/index.ts` 的注释说得很直白：

> Core observability utilities and types. **To use observability, install `@mastra/observability`** and pass an Observability instance to Mastra constructor.

**真正的实现在仓库根目录的 `observability/`**（不是 `packages/observability`）：

```
observability/
├── mastra/          ← 主实现
├── otel-bridge/     ← OTel 桥
├── otel-exporter/
├── langfuse/  langsmith/  braintrust/  arize/  arthur/  laminar/
├── datadog/  sentry/  posthog/  clickhouse-design/
├── _examples/       ← 示例
└── _test-utils/
```

**所以本模块要看两个地方**：`packages/core/src/observability/`（契约，4.5k 行）+ `observability/mastra/`（实现）。

## 核心概念

### 1. 契约层能力

`core/src/observability/index.ts` 导出：

| 导出                                                         | 文件                 | 作用                                  |
| ------------------------------------------------------------ | -------------------- | ------------------------------------- |
| 类型                                                         | `types/`             | 全部类型                              |
| `no-op`                                                      | `no-op.ts`           | **空实现——不配 observability 时用它** |
| `wrapMastra`                                                 | `context.ts`         | 包装 Mastra                           |
| `createObservabilityContext` / `resolveObservabilityContext` | `context-factory.ts` | 上下文工厂                            |
| `startRagIngestion` / `withRagIngestion`                     | `rag-ingestion.ts`   | **RAG 摄取追踪**                      |

类型分区（`observability/types/`）：`tracing.ts`（1495 行，最大）、`core.ts`、`metrics.ts`、`scores.ts`、`logging.ts`、`feedback.ts`、`client.ts`

### 2. `SpanType` —— 追踪的骨架

`observability/types/tracing.ts:35`。这个枚举定义了 Mastra 认为「值得追踪的单元」有哪些。

已知的几个（读源码补全）：`AGENT_RUN`、`WORKFLOW_RUN`、`SCORER_RUN`……对应的属性接口：

- `AIBaseAttributes`（`:118`）—— 基类
- `AgentRunAttributes`（`:135`）
- `ScorerRunAttributes`（`:164`）/ `ScorerStepAttributes`（`:176`）
- **`InputTokenDetails`（`:187`）/ `OutputTokenDetails`（`:204`）/ `UsageStats`（`:216`）** ← **成本核算看这里**

**`SpanType` 枚举 + 各 `*Attributes` 接口 = Mastra 的可观测性数据模型。** 先读这个，比读实现快得多。

### 3. `context-storage.ts` —— AsyncLocalStorage

**`initContextStorage()` 是 Mastra 构造函数的第一行**（见 11）。

用 Node 的 `AsyncLocalStorage` 做隐式上下文传递——这就是为什么框架深处的代码不用显式接收 span 参数也能知道「我在哪个 trace 里」。

单独导出：`@mastra/core/observability/context-storage`

**注意**：`context-storage.regression.test.ts` 的存在说明这块出过 bug。异步上下文丢失是这类机制的经典问题，值得留意。

### 4. `tracingPolicy` 与 InternalSpans

框架内部 workflow 都设了：

```ts
tracingPolicy: {
  internal: InternalSpans.WORKFLOW
}
```

出现在 `agent/workflows/prepare-stream/index.ts:193`、`loop/workflows/agentic-loop/index.ts`、`agentic-execution/index.ts`。

**作用：把 agent 内部那三层 workflow 的 span 标记为「内部」**，默认不污染你的业务 trace 视图。

**排查框架内部问题时，你需要知道怎么打开这些内部 span。** 这是本模块最实用的一个知识点。

### 5. Span 生命周期跨模块（坑）

见 05：`Run._start()`（`workflows/workflow.ts:3231`）里 `getOrCreateSpan({ type: SpanType.WORKFLOW_RUN })`，**但 span 在 `executionEngine.execute()` 内部结束，不在 `_start` 里**。

**创建和结束不在同一个函数**——排查 trace 不完整/不闭合时要知道这点。

### 6. 实现层

`observability/mastra/src/`：`registry.ts`、`spans/`、`exporters/`、`span_processors/`、`metrics/`、`bus/`、`model-tracing.ts`、`tracing-options.ts`

vendor exporter 各占一个包：langfuse、langsmith、braintrust、arize、datadog、sentry、laminar、arthur、posthog、otel-exporter、otel-bridge、clickhouse-design。

**接哪家看哪个包**——它们是同构的，读懂一个就懂全部。

存储侧：`storage/domains/observability/`（`inmemory.ts` 有 2519 行——**追踪是数据量最大的 domain**，见 10 的保留策略）。

## 关键源码文件

| 路径                                        | 行数 | 作用                                 | 建议               |
| ------------------------------------------- | ---- | ------------------------------------ | ------------------ |
| `core/src/observability/types/tracing.ts`   | 1495 | **`SpanType`(35) + 全部 attributes** | **先读，数据模型** |
| `core/src/observability/index.ts`           | 15   | 契约入口 + 那句关键注释              | **先读，1 分钟**   |
| `core/src/observability/context-storage.ts` | —    | AsyncLocalStorage                    | **必读**           |
| `core/src/observability/context.ts`         | —    | `wrapMastra`                         | 先读               |
| `core/src/observability/context-factory.ts` | —    | 上下文工厂                           | 先读               |
| `core/src/observability/no-op.ts`           | —    | 空实现                               | 短，值得看         |
| `core/src/observability/types/metrics.ts`   | —    | 指标                                 | 后读               |
| `core/src/observability/types/scores.ts`    | —    | 评分（关联 13）                      | 学 13 时读         |
| `core/src/observability/rag-ingestion.ts`   | —    | RAG 摄取追踪                         | 做 RAG 时读        |
| `observability/mastra/src/registry.ts`      | —    | **实现主入口**                       | **精读**           |
| `observability/mastra/src/exporters/`       | —    | 导出器                               | 后读               |
| `observability/mastra/src/model-tracing.ts` | —    | 模型调用追踪（成本）                 | **企业级必读**     |
| `observability/langfuse/` 等                | —    | vendor 适配                          | 接哪家读哪家       |
| `core/src/telemetry/`                       | 990  | **产品埋点，不是追踪**               | **跳过**           |

## 执行链路追踪

```
new Mastra({ observability: new Observability({...}) })
  └─ initContextStorage()                    mastra/index.ts:1220 第一行
       （不配则用 no-op.ts 空实现）
       ↓
agent.stream()
  └─ #execute()                              agent/agent.ts:6467
       └─ execution-workflow                 tracingPolicy: { internal: WORKFLOW }
            └─ Run._start()                  workflows/workflow.ts:3231
                 └─ getOrCreateSpan({ type: SpanType.WORKFLOW_RUN })
                      ↓  AsyncLocalStorage 隐式传递
                      ↓  框架深处无需显式传 span
                 └─ executionEngine.execute()   workflows/default.ts:712
                      └─ span 在这里结束 ⚠️ 不在 _start 里
       └─ llmExecutionStep
            └─ model-tracing → 记录 UsageStats（token / 成本）
       ↓
exporter → storage.stores.observability.*
        → 或 langfuse / langsmith / datadog / ...
       ↓
FullOutput.traceId / spanId / runId       （见 04）
```

## 示例与测试入口

```bash
pnpm --filter @mastra/core test observability/
pnpm --filter @mastra/core test observability/context-storage.regression.test.ts   # ← 值得看
pnpm --filter @mastra/core test mastra/register-exporter.test.ts                   # exporter 注册
```

`observability/_examples/` 是实现侧的示例目录。
`observability/_test-utils/` 是共享测试工具。

**核心侧只有 5 个测试**（契约层没什么好测的），真正的测试在实现包里。

## Debug 断点建议

| 断点                                                                    | 观察什么                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `workflows/workflow.ts:3231` (`_start` 里的 `getOrCreateSpan`)          | span 创建时的属性                                                  |
| `observability/mastra/src/model-tracing.ts`                             | **`UsageStats` 的实际值——成本核算的源头**                          |
| `observability/context-storage.ts` 的 `initContextStorage` / `getStore` | **AsyncLocalStorage 有没有丢**——异步上下文丢失是这类机制的经典 bug |
| exporter 的 export 方法                                                 | 实际导出的 span 数据                                               |

**建议动作**：跑一个 agent 测试，把 `FullOutput.traceId` 拿到，然后顺着 span 数据看完整调用树。你会直观看到那三层嵌套 workflow 在 trace 里长什么样（如果打开了 internal span）。

## 设计取舍与坑

- **契约与实现分离**：core 只有类型，实现要装 `@mastra/observability`。**不装就是 no-op**——你以为在追踪，其实什么都没记。
- **`telemetry/` ≠ observability**。命名很坑。
- **实现在仓库根 `observability/` 而不是 `packages/`**——找不到的时候记得往上一层看。
- **内部 span 默认隐藏**（`tracingPolicy.internal`）。好处是 trace 干净，坏处是排查框架问题时看不到东西。**要知道怎么打开。**
- **span 创建和结束跨模块**，trace 不闭合时往这查。
- **AsyncLocalStorage 会在某些异步边界丢失**——`context-storage.regression.test.ts` 就是这类 bug 的产物。用了自定义线程池 / worker 时要警惕。
- **追踪数据是最大的存储压力**（`storage/domains/observability/inmemory.ts` 2519 行不是白来的）。**必须配保留策略**（见 10 的 `retention.ts`）。
- **成本核算靠 `UsageStats`**，但注意服务端 fallback（见 03）——网关可能实际用了别的模型，要用 `resolveResponseModelId()` 校正。

## 后续细化 TODO

- [ ] **`SpanType` 完整枚举 + 各 `*Attributes` 接口**——Mastra 的可观测性数据模型全貌（**先做这个**）
- [ ] `tracingPolicy` / `InternalSpans` 的完整语义，**以及怎么打开内部 span 调试框架**
- [ ] `UsageStats` / `InputTokenDetails` / `OutputTokenDetails` → **成本核算实战**（含 fallback 校正，关联 03）
- [ ] AsyncLocalStorage 的失效边界——读 `context-storage.regression.test.ts` 搞清楚出过什么 bug
- [ ] `observability/mastra/src/registry.ts` 的注册机制与 `span_processors/` 管线
- [ ] 接一家 vendor 的完整流程（建议从 langfuse 开始，生态最成熟）
- [ ] OTel 接入：`otel-bridge` vs `otel-exporter` 的区别与选型
- [ ] 追踪数据的存储治理：保留策略、采样、成本（关联 10）
- [ ] `rag-ingestion.ts`：RAG 摄取的追踪
- [ ] `types/feedback.ts`：用户反馈怎么回流（关联 13）
- [ ] 自定义 exporter：写一个发到公司内部系统的
