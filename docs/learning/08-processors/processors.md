# 08. Processors — 管道与企业级护栏

## 模块职责

**在 Agent 执行的各个切点上拦截、改写、增强、阻断数据流。**

**这是企业级落地最直接相关的模块。** 内容审核、PII 脱敏、prompt 注入检测、token 限流全是开箱即用的 processor。

## 学习路径（3 篇深度文档）

| 主题                 | 文档                                                 | 一句话                                     |
| -------------------- | ---------------------------------------------------- | ------------------------------------------ |
| 基础                 | [01-processor-basics.md](./01-processor-basics.md)   | 6 个切点、执行顺序、TripWire 拦截零成本    |
| 内置实战             | [02-token-limiter.md](./02-token-limiter.md)         | TokenLimiterProcessor 精读，token 预算防护 |
| ⭐ processor 即 step | [03-processor-as-step.md](./03-processor-as-step.md) | **「一切皆 workflow」的落地证据**          |

### ⭐ 本模块最重要的一课：processor 是 workflow step

```ts
createStep(myProcessor).id // → 'processor:my-proc'（自动加前缀，实测发现）
```

`agent.ts:1455` 的 `combineProcessorsIntoWorkflow` 把 `inputProcessors`/`outputProcessors` 列表编译成一条 `.then()` 链——这解释了为什么处理器按声明顺序执行、为什么它们能重试、为什么受 evented 引擎的序列化约束影响。详见 [03](./03-processor-as-step.md)。

## 可跑示例

`examples/` 下 **3 个测试文件、12 个用例**，零构建、~5s 跑完：

```bash
cd docs/learning/08-processors/examples
npx vitest run                        # 全跑
npx vitest run 01-processor-basics    # 只跑基础
```

## 示例里挖到的真实细节（已验证）

- **input processor 全部先跑完，output processor 才开始**：不是交替执行（[01](./01-processor-basics.md)）
- **⭐ TripWire 拦截 = 零模型成本**：实测用带追踪的 mock 模型确认，抛出 TripWire 后模型的 `doStream` 从未被调用（[01](./01-processor-basics.md)）
- **TokenLimiterProcessor 在系统消息超预算时抛 TripWire**：不是尝试裁剪系统消息，而是快速失败（[02](./02-token-limiter.md)）
- **⭐ `createStep(processor)` 会自动加 `processor:` 前缀**：实测发现的实现细节，用于在执行图里区分 step 来源（[03](./03-processor-as-step.md)）

## 关键源码文件

| 路径                                     | 行数 | 作用                                                   | 文档 |
| ---------------------------------------- | ---- | ------------------------------------------------------ | ---- |
| `processors/index.ts`                    | 889  | `Processor` 接口(560)、`BaseProcessor`(750)            | 01   |
| `agent/trip-wire.ts`                     | —    | `TripWire` 中断机制                                    | 01   |
| `processors/processors/token-limiter.ts` | 412  | 精读范例                                               | 02   |
| `agent/agent.ts:1455`                    | —    | `combineProcessorsIntoWorkflow`（私有）                | 03   |
| `processors/runner.ts`                   | 2293 | `ProcessorRunner`（第二遍再读）                        | —    |
| `processors/processors/`                 | ~13k | pii-detector、moderation、prompt-injection-detector 等 | —    |

## 校正记录

相对初版（导航索引）的补充：

- ✅ 实测确认了 processor 的执行顺序（初版只是推测）
- ✅ TripWire 拦截零模型成本的直接证据（初版只提了概念）
- ✅ **`createStep(processor)` 的 id 前缀细节**（初版完全没提，实测偶然发现）
- ✅ TokenLimiterProcessor 的具体边界行为（系统消息超预算场景）
