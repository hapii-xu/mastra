# 08.2 内置 processor 实战：TokenLimiterProcessor

> 源码：`packages/core/src/processors/processors/token-limiter.ts`
> 示例：[`examples/02-token-limiter.test.ts`](./examples/02-token-limiter.test.ts)
> 跑：`cd docs/learning/08-processors/examples && npx vitest run 02`

**最适合当第一个精读对象的内置 processor**：短、逻辑清晰、无外部依赖（用 `tokenx` 库估算 token，不需要真实 tokenizer）。

---

## 一、用途

防止长对话把上下文窗口撑爆。超限时策略：**系统消息永远保留，非系统消息保留最近的**（从后往前塞，塞满预算为止）。

---

## 二、两种构造方式

```ts
new TokenLimiterProcessor(1000) // 简写：数字 = token 上限
new TokenLimiterProcessor({
  // 完整配置
  limit: 1000,
  strategy: 'truncate', // 'truncate'（默认）| 'abort'
  countMode: 'cumulative', // 'cumulative'（默认）| 'part'
  trimMode: 'best-fit', // 'best-fit'（默认）| 'contiguous'
})
```

---

## 三、⭐ 系统消息超预算 → 抛 TripWire（不是静默失败）

```ts
const agent = new Agent({
  instructions: veryLongInstructions,
  inputProcessors: [new TokenLimiterProcessor(5)],  // 极小预算
});
const output = await agent.stream('hi').then(r => r.getFullOutput());

output.tripwire.reason === '...System messages alone exceed token limit...'
output.tripwire.metadata === { systemTokens, limit: 5, ... }
```

**这是一个「快速失败」设计**：如果连系统消息都塞不进预算，继续裁剪非系统消息也无济于事，所以直接抛 TripWire 而不是尝试一个必然失败的裁剪。`examples/02` 用超长 `instructions` 实测触发了这个边界。

---

## 四、正常场景：预算充足时无感

```ts
inputProcessors: [new TokenLimiterProcessor(10000)] // 预算充裕
```

对正常长度的对话完全无感——这是它作为「默认防护」的设计意图：配一个足够大的上限，平时不生效，只在异常场景（无限增长的对话历史）兜底。

---

## 五、Debug 断点清单

| 断点                                  | 观察什么                          |
| ------------------------------------- | --------------------------------- |
| `token-limiter.ts` `processInputStep` | 系统消息 token 数、剩余预算计算   |
| `countTokens` 方法                    | `estimateTokenCount` 的估算结果   |
| TripWire 抛出处                       | `systemTokens`/`limit` 的具体数值 |

**推荐动作**：跑 `examples/02` 的「系统消息超预算」用例，在 `processInputStep` 打断点，观察 `systemTokens` 和 `remainingBudget` 的计算过程。

---

## 六、设计取舍与坑

- **token 计数是估算的，不是精确的**：用 `tokenx` 库估算，没有真实 provider tokenizer 精确，但足够用于防护性限流。
- **系统消息优先级最高**：永远保留，超预算直接失败而不是裁剪系统消息。
- **`strategy: 'abort'` vs `'truncate'`**：前者直接中断流，后者停止吐 chunk 但可能已发送部分响应——选择取决于你希望半截响应是否可接受。
- **企业级建议**：给这个 processor 配一个比预期上下文窗口略小的 limit，作为「异常保护网」，而不是日常裁剪手段（日常裁剪应该在 memory 层做语义化处理，见 09）。

---

## 七、后续细化 TODO

- [ ] `trimMode: 'best-fit'` vs `'contiguous'` 的具体裁剪算法差异
- [ ] `countMode: 'cumulative'` vs `'part'` 在流式输出场景下的行为
- [ ] 作为 output processor 使用时（限制生成的响应长度）的行为
- [ ] 和 memory 模块的语义化裁剪（09）如何配合，形成两层防护
