# 04. Stream — 输出契约

## 模块职责

**定义 Agent / Workflow 返回给你的东西长什么样，以及流式数据怎么组织。**

这个模块的地位常被低估。它是 **06-agent 和 07-loop 共同的返回类型**——`agent.stream()` 返回 `MastraModelOutput`，`agent.generate()` 返回 `FullOutput`。

## 学习路径（3 篇深度文档）

| 主题                 | 文档                                                   | 一句话                                               |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| 消费方式             | [01-output-consumption.md](./01-output-consumption.md) | getFullOutput / textStream / fullStream 三种消费模式 |
| ⭐ tripwire vs error | [02-tripwire-and-error.md](./02-tripwire-and-error.md) | **业务拦截 ≠ 系统故障，判断逻辑要分开**              |
| 字段清单             | [03-fulloutput-fields.md](./03-fulloutput-fields.md)   | FullOutput 全字段速查表，逐个实测确认                |

### ⭐ 本模块最重要的一课：tripwire 不是 error

```ts
output.tripwire  → 「你的输入包含敏感内容」（业务拦截，预期行为）
output.error     → 「系统异常」（技术故障，非预期）
```

实测：processor 抛 `TripWire` 后，`output.tripwire` 有完整信息（reason/retry/metadata），而 `output.error` 是 `undefined`。企业级做用户提示时，判断顺序应该是 `tripwire` → `error` → 正常文本。详见 [02](./02-tripwire-and-error.md)。

## 可跑示例

`examples/` 下 **3 个测试文件、17 个用例**，零构建、~5s 跑完：

```bash
cd docs/learning/04-stream/examples
npx vitest run                       # 全跑
npx vitest run 02-tripwire-and-error  # 只跑招牌课
```

## 示例里挖到的真实细节（已验证）

- **`fullStream` 的完整 chunk 类型序列**（实测）：`start → step-start → text-start → text-delta → text-end → step-finish → finish`（[01](./01-output-consumption.md)）
- **消费流后仍能 getFullOutput**（因为有内部缓冲），但两次遍历同一个流本身会失败（[01](./01-output-consumption.md)）
- **tripwire 携带结构化 metadata**，可用于精细化业务判断（[02](./02-tripwire-and-error.md)）
- **`totalUsage` 是多轮累加**，带 `raw` 字段保留 provider 原始用量（[03](./03-fulloutput-fields.md)）
- **⭐ 顶层 `toolCalls`/`toolResults` 确实存在**（跨轮聚合）——这是本轮写作中一次真实的自我纠正：07-loop 的早期文档误记为「顶层没有」，直接探测后发现记录有误，已同步修正（[03](./03-fulloutput-fields.md)）

## 关键源码文件

| 路径                                    | 行数 | 作用                                                              | 文档  |
| --------------------------------------- | ---- | ----------------------------------------------------------------- | ----- |
| `stream/base/output.ts`                 | 1858 | `MastraModelOutput`(146)、`FullOutput`(88)、`getFullOutput`(1425) | 01/03 |
| `agent/trip-wire.ts`                    | —    | `TripWire` 类                                                     | 02    |
| `stream/types.ts`                       | 1174 | 所有 chunk 类型                                                   | 01    |
| `stream/base/output-format-handlers.ts` | 761  | 结构化输出解析（见 06.3）                                         | —     |

## 校正记录

相对初版（导航索引）以及 07-loop 早期文档的修正：

- ✅ **顶层 `toolCalls`/`toolResults` 确实存在**（07-loop 早期文档曾错误记录为「顶层没有」，本轮探测后发现并同步修正了三处引用）
- ✅ `fullStream` 的完整 chunk 类型序列（初版没有具体列出）
- ✅ tripwire 的结构化 metadata 机制（初版只提了字段存在，没有用例）
