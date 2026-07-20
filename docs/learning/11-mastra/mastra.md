# 11. Mastra — DI 汇总点

## 模块职责

**中央配置枢纽与依赖注入根。把 agent、workflow、storage、memory、tools、processors…… 全部装配起来。**

**⚠️ 这个模块必须放在最后学。** `mastra/index.ts` **5725 行**，import 了约 30 个模块。先认识零件，再看装配图——顺序反了只会一头雾水。

反过来说：**学到这里，你已经认识所有零件了，这个模块会读得意外顺畅。** 它没有复杂算法，只有大量「解析配置 → 填默认值 → 下推给子对象」的重复劳动。

## 前置依赖

**前面 10 个模块全部。** 这是终点站。

## ⚠️ 先纠正一个过期信息

**`core/src/di/` 不是 DI 容器。** 它只有 8 行，是 `RequestContext` 的 re-export 壳。

**真正的 DI 就是 `mastra/index.ts` 的构造函数**——而且不是常见的「注册-查找」式容器，是**「解析默认值 → 主动下推」**式。

## 核心概念

### 1. `Mastra` 类 —— 一个大注册表

`mastra/index.ts:637`。所有状态是 `#` 私有字段（`:653-799`）：

| 分组         | 字段                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| **核心原语** | `#agents`、`#workflows`、`#storage`、`#vectors`、`#memory`、`#tools`                 |
| **能力**     | `#scorers`、`#processors`、`#channels`、`#mcpServers`、`#tts`、`#workspace(s)`       |
| **基础设施** | `#logger`、`#observability`、`#pubsub`、`#idGenerator`                               |
| **运行时**   | `#backgroundTaskManager`、`#schedulerConfig`、`#harnesses`                           |
| **服务**     | `#server`、`#studio`、`#serverAdapter`、`#deployer`、`#bundler`、`#serverMiddleware` |
| **其他**     | `#gateways`、`#recoveryConfig`、`#notificationDispatchConfig`                        |

### 2. `*Explicit` 布尔 —— 一个值得学的模式

注意这些成对出现的字段：

```
#storage?         + #storageExplicit = false
#logger           + #loggerExplicit = false
#observability    + #observabilityExplicit = false
#server?          + #serverExplicit = false
#studio?          + #studioExplicit = false
```

**作用：区分「用户显式配置的」和「框架自动注入默认值的」。**

这让框架能在「用户没配」时安全地替换默认值、打 warning、做兼容处理，而不会覆盖用户的显式选择。**这是个很实用的库设计模式，值得抄。**

类似的还有 `#hasScheduledWorkflow`（`:697` 附近），注释写得很清楚：

> Used as a fast short-circuit so users without scheduled workflows pay zero cost beyond a boolean check.

**「不用的功能不付代价」**——库设计的好习惯。

### 3. 构造函数 —— 全部装配发生在这

`mastra/index.ts:1220`。**这一个函数就是整个 DI 系统。**

第一行是 `initContextStorage()`（AsyncLocalStorage，见 12）。

关键的默认值注入：

| 缺什么    | 注入什么                      | 位置         |
| --------- | ----------------------------- | ------------ |
| `storage` | **`InMemoryStore` + warning** | `:1364-1366` |
| `cache`   | `InMemoryServerCache`         | —            |
| `pubsub`  | `EventEmitterPubSub`          | —            |
| `logger`  | `ConsoleLogger`               | —            |

**⚠️ `:1366` 那句 warning 原文**：

> No `storage` configured on Mastra — falling back to an in-memory store.

**这是企业级第一个要处理的事**（见 10）。

存储还会被 `augmentWithInit(storage)`（`:1371`）包一层懒初始化，并**自动补齐缺失的 domain**（`workflows`、`backgroundTasks` → 内存实现）——因为 evented workflow 引擎强依赖它们。

Worker 自动创建：`OrchestrationWorker`、`BackgroundTaskWorker`，可用 `MASTRA_WORKERS` 环境变量过滤。

### 4. 两种注入约定（重点）

| 约定                              | 传什么               | 用于                                       |
| --------------------------------- | -------------------- | ------------------------------------------ |
| **`__registerMastra(this)`**      | **整个 Mastra 实例** | workflows、workers、agents、tool providers |
| **`__registerPrimitives({...})`** | **一小袋依赖**       | 更窄的依赖注入                             |

`MastraPrimitives` 定义在 **`action/index.ts`**（一个 20 行的小文件，很容易错过）：

```ts
export type MastraPrimitives = {
  logger?: IMastraLogger
  storage?: MastraCompositeStore
  agents?: Record<string, Agent>
  tts?: Record<string, MastraTTS>
  vectors?: Record<string, MastraVector>
  memory?: MastraMemory
}
```

调用点：`mastra/index.ts:2240`、`2292`、`3039`、`4319`
实现点：`agent/agent.ts:624-625`、`workflows/workflow.ts:1662-1667`

**为什么有两套**：`__registerMastra` 给完整实例（能力强但耦合重、易循环引用），`__registerPrimitives` 只给必需的几样（解耦）。**这是框架在「循环依赖」和「便利性」之间的妥协产物**——和 05 里 `create.ts` 的存在是同一个问题的两种解法。

### 5. Ephemeral Mastra

`Agent.#getOrCreateEphemeralMastra()`（见 06）—— **Agent 可以脱离 Mastra 独立使用**，会自己造一个临时实例。

这就是为什么测试里能直接 `new Agent({...}).stream()` 而不必先 `new Mastra({...})`。

### 6. 其他关键文件

| 文件                  | 行数 | 作用                                                                |
| --------------------- | ---- | ------------------------------------------------------------------- |
| `mastra/hooks.ts`     | 177  | `createOnScorerHook` —— scorer 钩子（见 13）                        |
| `mastra/run-scope.ts` | —    | **按 run 隔离 workflow / tracing 上下文**（关联 06/07 的 runScope） |
| `mastra/types.ts`     | 42   | 小类型                                                              |

## 关键源码文件

| 路径                         | 行数 | 作用                                                    | 建议                       |
| ---------------------------- | ---- | ------------------------------------------------------- | -------------------------- |
| `mastra/index.ts`            | 5725 | `Mastra` 类(637)、私有字段(653-799)、**构造函数(1220)** | **精读构造函数，其余查阅** |
| `action/index.ts`            | 20   | **`MastraPrimitives`**                                  | **必读，很短，容易漏**     |
| `mastra/run-scope.ts`        | —    | run 级作用域                                            | 必读                       |
| `mastra/hooks.ts`            | 177  | scorer 钩子                                             | 学 13 时读                 |
| `storage/storageWithInit.ts` | —    | 懒初始化                                                | 关联 10                    |
| `mastra/types.ts`            | 42   | 类型                                                    | 5 分钟                     |
| `di/index.ts`                | 8    | **不是 DI 容器**                                        | **跳过**                   |

## 执行链路追踪

```
new Mastra({ agents, workflows, storage, ... })    mastra/index.ts:1220
  ├─ initContextStorage()                          ← 第一行，AsyncLocalStorage（见 12）
  ├─ 默认值注入
  │    ├─ storage ?? new InMemoryStore()           :1364  ⚠️ + warning :1366
  │    ├─ cache ?? new InMemoryServerCache()
  │    ├─ pubsub ?? new EventEmitterPubSub()
  │    └─ logger ?? new ConsoleLogger()
  ├─ storage = augmentWithInit(storage)            :1371
  │    └─ 补齐缺失 domain（workflows / backgroundTasks → 内存）
  ├─ storage.__registerMastra(this)                :1424
  ├─ 下推给各子对象
  │    ├─ workflow.__registerMastra(this)          :1310 / :1332
  │    ├─ agent.__registerMastra(this)             :2239 / :2291
  │    ├─ agent.__registerPrimitives({...})        :2240  → agent/agent.ts:624
  │    ├─ agentController.__registerMastra(this)   :1634
  │    └─ bgManager.__registerMastra(this)         :1674
  └─ 自动创建 worker（OrchestrationWorker / BackgroundTaskWorker）
       └─ 可用 MASTRA_WORKERS 过滤
```

## 示例与测试入口

**这个模块测试比例极高（32 个源文件 / 27 个测试），测试就是注册行为的规格说明：**

```bash
pnpm --filter @mastra/core test mastra/config-spread.test.ts          # 配置合并
pnpm --filter @mastra/core test mastra/environment.test.ts            # 环境变量
pnpm --filter @mastra/core test mastra/idgenerator.test.ts            # ID 生成
pnpm --filter @mastra/core test mastra/register-exporter.test.ts      # exporter 注册
pnpm --filter @mastra/core test mastra/scorer-registration.test.ts    # scorer 注册
pnpm --filter @mastra/core test mastra/processor-workflow-registration.test.ts
pnpm --filter @mastra/core test mastra/remove-agent.test.ts           # 动态增删
pnpm --filter @mastra/core test mastra/run-scope.test.ts
pnpm --filter @mastra/core test mastra/internal-workflow-registry.test.ts
pnpm --filter @mastra/core test mastra/cross-process-workflow.test.ts # 跨进程（evented）
```

`mastra-workflow-types.test-d.ts` 是类型层测试。

## Debug 断点建议

**推荐动作：在构造函数打断点，起一个最小 Mastra（只配一个 agent），单步走完整个构造过程。你会看到框架默默给你注入了多少东西。**

| 断点                                            | 观察什么                                          |
| ----------------------------------------------- | ------------------------------------------------- |
| `mastra/index.ts:1220` (构造函数入口)           | 用户实际传了什么                                  |
| `mastra/index.ts:1364` (`new InMemoryStore()`)  | **⚠️ 有没有命中？命中就说明生产会丢数据**         |
| `mastra/index.ts:1371` (`augmentWithInit`)      | 补齐了哪些 domain                                 |
| `mastra/index.ts:2240` (`__registerPrimitives`) | 给 agent 的那袋依赖具体是什么                     |
| 构造函数最后一行                                | **所有 `#` 字段的最终状态**——这就是你的运行时全貌 |

## 设计取舍与坑

- **`di/` 是误导性命名。** 真正的 DI 在这个构造函数里。
- **DI 是「下推」不是「查找」**。没有 `container.resolve()` 那套，是构造时主动 `__registerMastra` / `__registerPrimitives` 推给每个子对象。**优点是启动后零开销、类型完整；缺点是构造函数巨大、循环依赖到处是。**
- **⚠️ 默认内存存储 + 静默补 domain**。企业级最大的坑，见 10。
- **两套注入约定并存**是历史包袱，不是设计美感。看到 `__registerMastra` 和 `__registerPrimitives` 别以为有什么深意。
- **`*Explicit` 模式值得学**——区分「用户配的」和「默认的」，让默认值可以安全演进。
- **`#hasScheduledWorkflow` 的短路思想值得学**——不用的功能零成本。
- **Ephemeral Mastra 让 Agent 可独立使用**，测试很方便，但生产里意味着你可能不小心创建了多个 Mastra 实例（各自有独立的存储连接）。注意。
- **5725 行几乎全是装配代码**，没有复杂逻辑。别指望在这里学到算法，这里学的是**大型 TS 库的组织方式**。

## 后续细化 TODO

- [ ] **构造函数 1220 行往后逐段拆解**——这是理解框架全貌的最后一块拼图
- [ ] 全部默认值注入清单：还有哪些是我不知道就被注入的？
- [ ] 缺失 domain 自动补齐的完整规则（关联 10）
- [ ] `__registerMastra` vs `__registerPrimitives` 的完整调用点地图，以及为什么某处选某个
- [ ] `mastra/run-scope.ts` 与 06/07 里两个 runScope 的关系——**三个 scope 了，必须理清**
- [ ] 动态增删：`remove-agent.test.ts` / `remove-tool.test.ts` 揭示的运行时可变性
- [ ] `MastraIdGenerator`：自定义 ID 生成（分布式场景相关）
- [ ] worker 自动创建与 `MASTRA_WORKERS` 过滤——多实例部署时的正确配置
- [ ] `#recoveryConfig` / `recover-all-durable-agents.test.ts`：崩溃恢复（关联 06 durable）
- [ ] `#serverMiddleware` 的注入点（关联 14）
- [ ] `internal-workflow-registry` 的作用（关联 06 的 evented 分支）
- [ ] 多 Mastra 实例的隔离性与资源开销
