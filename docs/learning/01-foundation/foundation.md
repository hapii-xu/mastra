# 01. Foundation — 基础契约层

## 模块职责

**整个框架所有类的公共基类、错误体系、请求级上下文传递机制。**

这一层是依赖图上的**叶子**——不 import 任何其他核心模块，所以是唯一能「干净地自底向上读」的部分。它很小（约 1.5k 行），但每一个概念都会在后面 13 个模块里反复出现：你之后看到的每个 `extends MastraBase`、每个 `requestContext` 参数、每个 `throw new MastraError`，语义都在这里定义。

**先花半天把这层啃干净，后面省几天。**

## 前置依赖

无。这是起点。

## ⚠️ 第一个认知陷阱

`core/src/base.ts`、`core/src/error/`、`core/src/request-context/` **全是 re-export 壳子，没有实现**：

```ts
// packages/core/src/base.ts —— 全文只有 2 行
export { MastraBase } from '@internal/core/base'
export * from './types'
```

**真正的实现在另一个包：`packages/_internal-core/src/`。**

```
packages/_internal-core/src/
├── base/          MastraBase
├── error/         MastraError 体系
├── request-context/  RequestContext
├── logger/        ConsoleLogger、RegisteredLogger
├── storage/
├── types/
└── routes/
```

`@internal/core/*` 这个 import 前缀 = `packages/_internal-core/src/*`。**看到 `@internal/core` 就往 `_internal-core` 包里找**，别在 `core/` 里打转。

---

## 学习路径（三个概念，各一篇深度文档）

| 概念               | 文档                                             | 一句话                | 为什么重要                              |
| ------------------ | ------------------------------------------------ | --------------------- | --------------------------------------- |
| **RequestContext** | [01-request-context.md](./01-request-context.md) | 请求级数据总线        | 多租户、引擎选择、runScope 的根因全在这 |
| **MastraError**    | [02-error.md](./02-error.md)                     | 结构化错误 + 重试控制 | workflow 重试机制的逃生舱               |
| **MastraBase**     | [03-mastra-base.md](./03-mastra-base.md)         | 公共基类              | ~30 个类的共同祖先                      |

**建议顺序**：先 RequestContext（最重要），再 MastraError（短且独立），最后 MastraBase（最简单）。

### ⭐ 本模块最值得学的一课：`fork()` 不存在

`RequestContext` 可变、共享、没有 `fork()`。这一个缺失，在主干代码里长出了两种应对：

- **做法 A（干净）**：`new RequestContext(parent.entries())` 手搓 fork——但**是浅拷贝**，改存储对象内部会串味
- **做法 B（脏）**：`agent.ts:4608-4615` 在共享上下文上 save→delete→restore，且要在 **5 个 return 分支各恢复一次**

> 一个缺失的方法，换来 5 处必须配对的手工恢复。

详见 [01-request-context.md §三](./01-request-context.md)。这个坑光读记不住，跑一遍 [`examples/02-request-context-fork.test.ts`](./examples/02-request-context-fork.test.ts) + 断点看一眼就永远忘不了。

---

## 可跑示例（本次重点）

`examples/` 下有 **7 个测试文件、104 个用例**，**零构建、~300ms 跑完**（详见 [examples/README.md](./examples/README.md)）。

```bash
cd docs/learning/01-foundation/examples
npx vitest run                       # 全跑，~300ms
npx vitest run 02-request-context-fork   # 只跑招牌课
npx vitest                           # watch 模式，改源码即时看影响
```

**为什么示例能跑而 `packages/core` 的测试跑不了**：示例用相对路径直接 import `_internal-core/src/` 源码，vitest 配置没有 `setupFiles`、不依赖任何 `dist` 产物——绕开了仓库 TS6 构建损坏的问题。**01 是全路线唯一不受构建问题影响的入口，建议作为第一站。**

每个用例的设计原则：

- `it()` 名字 = 可验证的断言句，读用例名 = 读知识点清单
- 每个用例上方注释标明**断点打哪、该观察什么**
- `expect` 把源码行为钉死——**跑通即证明你的理解正确**

---

## 关键源码文件

| 路径                                          | 行数 | 作用                            | 对应文档                      |
| --------------------------------------------- | ---- | ------------------------------- | ----------------------------- |
| `_internal-core/src/request-context/index.ts` | 335  | RequestContext 本体             | [01](./01-request-context.md) |
| `_internal-core/src/error/index.ts`           | 153  | MastraError 体系                | [02](./02-error.md)           |
| `_internal-core/src/error/utils.ts`           | —    | getErrorFromUnknown 等          | [02](./02-error.md)           |
| `_internal-core/src/base/MastraBase.ts`       | 51   | 公共基类                        | [03](./03-mastra-base.md)     |
| `_internal-core/src/logger/index.ts`          | —    | ConsoleLogger、RegisteredLogger | [03](./03-mastra-base.md)     |
| `core/src/utils.ts`                           | 782  | core 里唯一有内容的根文件       | 后读，用到再查                |

---

## 设计取舍与坑（全模块视角）

- **抽象与实现分离**：core 只有 re-export 壳，实现在 `_internal-core`。看到 `@internal/core` 跳包。
- **`RequestContext` 可变共享 + 无 fork**：一切问题的根源（§⭐ 那一课）。
- **两种私有语义**：`private`（TS-only，运行时可枚举）vs `#`（真 ES 私有）。`RequestContext.registry` 用前者（所以需要 `serializeForSpan`），`MastraBase.#rawConfig` 用后者（天生安全）。
- **两种枚举写法**：`ErrorDomain` 用 TS `enum`，`RegisteredLogger` 用 const object——同一个包里两种选择。
- **`core/src/di/` 是误导命名**：8 行的 re-export，**不是 DI 容器**，且漏掉了 `MASTRA_AUTH_TOKEN_KEY`。真正的 DI 在 `mastra/index.ts` 构造函数（见 11）。
- **`core/src/telemetry/` 不是链路追踪**：是产品埋点（PostHog）。追踪在 `observability/`（见 12）。

---

## 校正记录

本页相对初版（导航索引）的修正：

- ✅ `RegisteredLogger` 不是 TS enum，是 **const object + companion type**（20 个值）。见 [03 §六](./03-mastra-base.md)。
- ✅ RequestContext 是**可变的**（初版留作 TODO），且没有 `fork()`。见 [01 §一](./01-request-context.md)。
- ✅ `ErrorDomain` 有 **19** 个值（初版写 18）。
