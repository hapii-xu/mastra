# 04.3 FullOutput 字段清单 —— 逐个验证真实值

> 源码：`stream/base/output.ts:88-143`（`FullOutput` 类型定义）
> 示例：[`examples/03-fulloutput-fields.test.ts`](./examples/03-fulloutput-fields.test.ts)
> 跑：`cd docs/learning/04-stream/examples && npx vitest run 03`

**`FullOutput` 是全框架能力在返回值上的投影。** 这份清单值得贴墙上——顺着字段反查是理解全框架的一条捷径。

---

## 一、⭐ 字段速查表（对照实测结果）

| 字段                              | 来源模块                  | 实测确认的行为                                         |
| --------------------------------- | ------------------------- | ------------------------------------------------------ |
| `text` / `object`                 | 06-agent                  | 结构化输出见 06.3                                      |
| `usage` / `totalUsage`            | 03-llm / 12-observability | `totalUsage` 是多轮累加，带 `raw`（provider 原始结构） |
| **`tripwire`**                    | 08-processors             | processor 拦截时有值，`error` 为 undefined（见 04.2）  |
| `traceId` / `spanId`              | 12-observability          | 没配 observability 时可能是 undefined                  |
| `suspendPayload`                  | 05-workflows              | 没挂起时是 undefined                                   |
| `messages` / `rememberedMessages` | 09-memory                 | 没配 memory 时 `rememberedMessages` 是空数组           |
| `toolCalls` / `toolResults`       | 07-loop                   | **顶层就有**，跨所有轮次聚合（见 07.2 的修正）         |

---

## 二、token 用量：usage / totalUsage

```ts
output.totalUsage === {
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  raw: { ... },  // provider 原始用量结构
}
```

`raw` 字段保留了 provider 的原始数据——**服务端 fallback 场景要看这个**（网关可能实际用了另一个模型，见 03-llm）。

**多轮工具调用后，`totalUsage` 是所有轮次的累加**，不是只算最后一轮（`examples/03` 实测验证：`totalUsage.totalTokens >= usage.totalTokens`）。

---

## 三、消息字段：messages / rememberedMessages

```ts
output.messages // 本次交互的全部消息（输入 + 输出），至少 2 条
output.rememberedMessages // 从 memory 召回的历史消息；没配 memory 时是 []
```

**这是判断「memory 有没有生效」最直接的字段**——如果 `rememberedMessages` 应该有内容但却是空数组，说明记忆配置有问题（见 09）。

---

## 四、标识字段：runId / traceId / spanId

```ts
output.runId // 字符串，每次调用独立
output.traceId // 可观测性标识，取决于是否配置 observability
output.spanId // 同上
```

**`runId` 保证每次调用都不同**（`examples/03` 验证了两次连续调用的 runId 不相等）。`traceId`/`spanId` 的值取决于是否接入了追踪系统（见 12）——字段总是存在，但值可能是 undefined。

---

## 五、HITL 字段：suspendPayload / resumeSchema

没有挂起发生时，`suspendPayload` 是 undefined。挂起时会携带工具/step 传出的挂起数据（关联 05.3 workflow 级挂起 和 02.3 tool 级挂起）。

---

## 六、Debug 断点清单

| 断点                                          | 观察什么                                  |
| --------------------------------------------- | ----------------------------------------- |
| `stream/base/output.ts:1503` `get totalUsage` | 多轮累加的实现                            |
| `stream/base/output.ts` messages 组装处       | messages vs rememberedMessages 怎么区分   |
| `stream/base/output.ts:1249` `get steps`      | steps 数组和顶层聚合字段的关系（见 07.3） |

**推荐动作**：跑 `examples/03`，把每个字段的实际值打印出来，对照这份速查表逐条核实。

---

## 七、设计取舍与坑

- **字段总是存在，值不一定有意义**：`traceId`/`spanId`/`suspendPayload` 等字段哪怕没用到相关功能也会出现在对象上（值为 undefined）——`'traceId' in output` 恒为 true，但不代表配置了 observability。
- **`rememberedMessages` 是排查 memory 配置的第一现场**：如果预期有历史召回但这个字段是空的，先检查 memory 配置，别急着怀疑召回算法。
- **顶层的 toolCalls/toolResults 和 steps 里的重复**：顶层是便捷聚合，功能上等价（内容相同），选哪个看你需要「整体」还是「分轮」的视角。
- **`totalUsage.raw` 是排查成本异常的关键**：如果账单和预期不符，先看 `raw` 里 provider 报的真实用量，而不是只信任顶层归一化后的数字。

---

## 八、后续细化 TODO

- [ ] `steps` 数组每个 step 的完整字段清单（content、sources、files...）
- [ ] `scoringData` 字段（`returnScorerData` 开启时，见 13-evals）
- [ ] 不同 provider 的 `providerMetadata` 差异
- [ ] `resumeSchema` 字段在挂起场景下的具体形状
