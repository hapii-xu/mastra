# 05-workflows 可跑示例

**5 个文件，32 个用例，零构建，~5s 跑完。**

## 怎么跑

```bash
cd docs/learning/05-workflows/examples
npx vitest run                    # 全跑（首次 transform 较慢，~5s）
npx vitest run 02-control-flow    # 只跑某个文件
npx vitest                        # watch 模式
```

**不需要构建。** 示例通过相对路径 import `packages/core/src/workflows` 源码，`vitest.config.ts` 用 **8 个 alias** 把 `@internal/*` 和 `@mastra/schema-compat` 重定向到各自源码，绕开仓库 TS6 构建损坏。这套配置 06/07 的 examples/ 复用。

## 与 01-foundation 的区别

01 直接 import `_internal-core`（零内部依赖，不需 alias）。05/06/07 import `core/src`，会传递引用一堆 bare specifier，所以需要 alias 配置。`vitest.config.ts` 顶部的注释列出了这 8 个 alias 是怎么实测出来的。

## 文件清单

| 文件                                  | 用例数 | 学什么                                                                                | 文档                                    |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------- | --------------------------------------- |
| `01-workflow-basics.test.ts`          | 8      | Workflow/Run 一对多、commit 必须、**结果形状**（res.result + res.steps）、注册 Mastra | [01](../01-workflow-basics.md)          |
| `02-control-flow.test.ts`             | 7      | then/parallel/**branch 元组**/dowhile/foreach/map、模拟 agent 形状                    | [02](../02-control-flow.md)             |
| `03-suspend-resume.test.ts`           | 7      | suspend/resume、**resume 要存储**、HITL 退款实战、4 种定位方式                        | [03](../03-suspend-resume.md)           |
| `04-execution-engine.test.ts`         | 6      | **retryConfig.attempts**、MastraNonRetryableError 不重试、watch 事件                  | [04](../04-engine-and-retry.md)         |
| `05-create-step-polymorphism.test.ts` | 4      | Tool/Workflow 作为 step、**tool-as-step 位置参数**（v1.0 breaking change）            | [05](../05-create-step-polymorphism.md) |

## 怎么用来 debug

每个用例上方注释标明断点位置。配合 VS Code vitest debug（见 `docs/learning/README.md`）。

**最有价值的练习**：

1. 跑 `02-control-flow` 的 `dowhile` 用例，在 `handlers/control-flow.ts:596`（executeLoop）打断点——**理解 agent 自主循环的入口**
2. 跑 `03-suspend-resume` 的「裸 workflow resume 抛错」用例，在 `workflow.ts:3989` 打断点——**理解 HITL 为什么需要存储**
3. 跑 `04-execution-engine` 的两个重试对比用例，在 `default.ts:425`（重试循环）打断点——**普通错 vs NonRetryable 的差异**

## 写法约定（与 01 一致）

1. `it()` 名是断言句——读用例名 = 读知识点清单
2. 每个用例上方一行断点注释
3. `expect` 钉死行为——跑通即证明理解正确
4. 相对路径 import 源码 + alias 绕开构建
5. ⚠️ 标注真实坑（attempts/retries、branch 元组、tool 位置参数等）
