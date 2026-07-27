# 01-foundation 可跑示例

**104 个用例，零构建，~300ms 跑完。** 这是 01 模块的核心学习材料——文档里每一条行为断言，都有一个跑得通的用例撑着。

## 怎么跑

```bash
# 从仓库根目录（推荐：用 workspace 里的 vitest，不要用 npx vitest）
cd docs/learning/01-foundation/examples
node ../../../../node_modules/vitest/vitest.mjs run   # 104 用例，~300ms

# 或（需已 pnpm install）
pnpm exec vitest run
```

**不需要 `pnpm install`、不需要 `pnpm build`。** 示例通过相对路径直接 import `packages/_internal-core/src/` 的源码，vitest 配置（`vitest.config.ts`）没有 `setupFiles`、不依赖任何 `dist`。

> 为什么这能跑、而 `packages/core` 的测试跑不了？因为 core 的 `vitest.config.ts:32` 有 `setupFiles: ['@internal/test-utils/setup']`，走包的 `exports` 指向 `dist/`，没构建就没有一切。本目录的配置故意绕开了这一点。见上级 README 的「⚠️ 必须先构建依赖」。

## 怎么用来 debug

每个用例上方都有一行注释，标明**断点打哪、该观察什么**。配合 VS Code 的 vitest debug（见 `docs/learning/README.md` 的 debug 章节）：

1. 打开某个 `.test.ts`
2. 在注释提示的源码行（如 `index.ts:244`）打断点
3. `npx vitest run` 该文件
4. 断点命中时，观察注释里说的那个东西

**最重要的一个练习**：跑 `03-request-context-tojson.test.ts` 的「A ↔ B 互相引用」用例，在 `_internal-core/src/request-context/index.ts:244` 打断点。你会亲眼看到 `toJSON` 被重入、`WeakSet` 撞到自己、`CyclicRequestContextToJSONError` 被抛出——这是整个 foundation 里最值得学的一段代码（一个真实的 100% CPU bug 及其修复）。

## 文件清单

| 文件                                  | 用例数 | 学什么                                                                                  | 对应文档                                              |
| ------------------------------------- | ------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `01-request-context-basics.test.ts`   | 17     | 构造双模式、13 个 API（补仓库原生测试的真空）、`size()` 是方法、`set` 不可链式          | [01-request-context.md §二](../01-request-context.md) |
| `02-request-context-fork.test.ts`     | 12     | ⭐ **招牌课**：`fork()` 不存在、浅拷贝边界、做法 A/B 对照、共享可变的翻车现场           | [§三](../01-request-context.md)                       |
| `03-request-context-tojson.test.ts`   | 16     | ⭐ toJSON 过滤规则、按引用不深拷、**跨 context 循环（那个 CPU bug）**                   | [§四](../01-request-context.md)                       |
| `04-request-context-security.test.ts` | 12     | ⭐ serializeForSpan 白名单脱敏 vs toJSON 黑名单、4 个保留键、越权防护                   | [§五、§六](../01-request-context.md)                  |
| `05-version-overrides.test.ts`        | 11     | mergeVersionOverrides：agents 逐键浅合、defaultStatus 回退、三级优先级                  | [§七](../01-request-context.md)                       |
| `06-error.test.ts`                    | 20     | 19×4 矩阵、details 只能标量、message 三级回退、原型链三连、MastraNonRetryableError 重试 | [02-error.md](../02-error.md)                         |
| `07-mastra-base.test.ts`              | 16     | 继承、logger 命名、rawConfig、`__setLogger` 鸭子类型、两种私有/枚举对照                 | [03-mastra-base.md](../03-mastra-base.md)             |

## 与仓库原生测试的对照

仓库自带测试是「官方规格」，**但它们在 `packages/core` 里，必须先修好 TS6 构建才能跑**。本目录的示例是零构建可跑的替代，且补了原生测试的真空：

| 主题                       | 本目录示例                                                | 仓库原生测试（需构建）                                                                   |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| RequestContext 基础 API    | `01-basics`（**原生测试没有专门覆盖**）                   | `packages/core/src/request-context/index.test.ts`                                        |
| toJSON 边界                | `03-tojson`                                               | 同上，`describe('toJSON')`（10 例，很全）                                                |
| 跨 context 循环（CPU bug） | `03-tojson`                                               | 同上，`:171/199/214/232`（回归守卫）                                                     |
| serializeForSpan           | `04-security`                                             | 同上，`describe('serializeForSpan')`（4 例）                                             |
| 保留键安全                 | `04-security`                                             | `agent/__tests__/request-context-reserved-keys.test.ts`                                  |
| 可变性/隔离                | `02-fork`                                                 | `loop/test-utils/aimock/scenarios/request-context-{mutation,isolation}.scenario.test.ts` |
| 跨 durable 边界            | —                                                         | `agent/durable/__tests__/durable-agent-request-context.test.ts`                          |
| 错误体系                   | `06-error`（**补了 message 回退、toString、instanceof**） | `packages/core/src/error/index.test.ts`（仅 8 例）                                       |
| getErrorFromUnknown        | `06-error`                                                | `error/utils.test.ts`（26 例，最详尽）                                                   |
| 类型层                     | —                                                         | `request-context.test-d.ts`（`expectTypeOf`，Issue #4467）                               |

**建议**：先用本目录的示例建立运行时手感，等构建修好后，再去读原生测试对照——尤其是 `index.test.ts` 的循环用例和 `utils.test.ts` 的边界用例，它们覆盖得比本目录更细。

## 示例的写法约定（后续 05/06/07 模块照抄）

1. **`it()` 名是断言句**：读用例名 = 读知识点清单，不用点进去就知道测什么
2. **断点注释**：每个用例上方一行，标明源码位置 + 该观察什么
3. **`expect` 钉死行为**：跑通即证明理解正确，不靠口述
4. **相对路径 import 源码**：`../../../../packages/_internal-core/src/...`，故意绕开 `@mastra/core`，零构建
5. **⚠️ 标注坑**：容易踩的陷阱用「⚠️」前缀，方便扫读
