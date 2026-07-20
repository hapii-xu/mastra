# 02.2 校验管道 —— 为真实 LLM 怪癖设计的自愈机制

> 源码：`packages/core/src/tools/validation.ts:450-570`（`validateToolInput`）
> 示例：[`examples/02-validation-pipeline.test.ts`](./examples/02-validation-pipeline.test.ts)
> 跑：`cd docs/learning/02-tools/examples && npx vitest run 02`

模型返回的参数经常不严格符合 schema——不是模型笨，而是不同厂商对 JSON Schema 的实现有细微差异。Mastra 用一条 **6 步管道**尝试修复，每一步都关联一个真实的 GitHub issue。

---

## 一、6 步管道全览

| #   | 步骤                          | 解决什么                                        | 关联 issue |
| --- | ----------------------------- | ----------------------------------------------- | ---------- |
| 1   | `normalizeNullishInput`       | 全参数可选时模型传 `undefined` 而非 `{}`        | —          |
| 2   | `convertUndefinedToNull`      | OpenAI strict mode 兼容                         | #11457     |
| 3   | 首次校验（保留 null）         | 处理 `.nullable()` schema                       | —          |
| 4   | `coerceStringifiedJsonValues` | GLM4.7 等把数组/对象传成字符串                  | #12757     |
| 5   | 剥离导致失败的 null 字段      | Gemini 对 optional 字段传 null                  | #12362     |
| 6   | prompt 别名归一化             | 子 agent 多轮后 prompt→query/message/input 漂移 | #14154     |

**全部尝试失败才返回 `ValidationError`**（`{error:true, message, validationErrors}`）。

---

## 二、⭐ 步骤 4：字符串化 JSON 自动转换

```ts
// 模型把数组参数传成了字符串（而不是真数组）
await tool.execute({ paths: '["a.ts","b.ts"]' })
// → 校验管道自动解析成 { paths: ["a.ts", "b.ts"] }，正常执行
```

这是应对**部分模型**（如 GLM4.7）把 JSON 数组/对象序列化成字符串再传的怪癖。

---

## 三、⭐ 步骤 5：null vs undefined vs nullable

**Zod 的 `.optional()` 只接受 `undefined`，不接受 `null`**——但部分模型（如 Gemini）对可选字段发送 `null`。

```ts
inputSchema: z.object({ query: z.string(), limit: z.number().optional() })

// Gemini 发来的参数
await tool.execute({ query: 'test', limit: null })
// → 校验管道剥离了这个 null，视为缺失，正常执行
```

**⚠️ 但 `.nullable()` 字段的合法 null 不会被误剥离**——管道通过检查「哪些字段的校验失败涉及 null/undefined」来精确判断该剥离哪个字段（`validation.ts` 注释：_"We detect null-related failures by checking the actual value at the failing path rather than relying on error message string matching"_，关联 #14476）。

```ts
inputSchema: z.object({ tag: z.string().nullable() }) // 显式允许 null
await tool.execute({ tag: null })
// → null 是合法值，原样保留，不会被步骤 5 误伤
```

`examples/02` 用两个用例对照验证了这一点。

---

## 四、失败时的错误结构

```ts
{
  error: true,
  message: "Tool input validation failed for <toolId>. Please fix the following errors and try again:\n- count: ...\n\nProvided arguments: ...",
  validationErrors: { errors: [...], fields: {...} },
}
```

`message` 里带 `toolId` 和具体的字段路径——这是设计给**模型自己看的**：返回值会被塞回对话历史，让模型看到错误后自我纠正重试。

---

## 五、outputSchema 校验同样存在

`tool.ts:459 validateToolOutput`——不只是输入，工具的**返回值**也会被校验。`examples/02` 验证：`execute` 返回不符合 `outputSchema` 的值同样会被拦截成 `ValidationError`。

**这解释了 02.1 那个坑为什么会暴露**：`{context}` 解构导致 `NaN`，正是靠 outputSchema 校验才被抓到（前提是 schema 够严格）。

---

## 六、Debug 断点清单

| 断点                                              | 观察什么                            |
| ------------------------------------------------- | ----------------------------------- |
| `validation.ts:481` `normalizeNullishInput`       | 步骤 1                              |
| `validation.ts:495` `coerceStringifiedJsonValues` | 步骤 4：字符串怎么被解析成数组/对象 |
| `validation.ts:509-524` `failingNullPaths`        | 步骤 5：怎么精确判断该剥离哪个字段  |
| `validation.ts:587` `validateToolOutput`          | 输出校验                            |

**推荐动作**：跑 `examples/02` 的字符串化 JSON 用例，在 `coerceStringifiedJsonValues` 打断点，看字符串怎么变回数组。

---

## 七、设计取舍与坑

- **这套管道是「宽容输入、严格输出」哲学的体现**：尽量帮模型把参数修正对，但工具的返回值必须符合 outputSchema。
- **6 步都失败才报错，且错误信息是给模型看的**：设计上假设模型能根据错误信息自我纠正——这是 agentic 系统的特色。
- **`.optional()` 和 `.nullable()` 语义不同**：Zod 严格区分，但很多模型不区分。管道帮你补上了这层兼容，但写 schema 时最好想清楚该用哪个。
- **historical issue 驱动的设计**：这套管道不是一次设计出来的，是被不同模型的真实故障逐步打磨出来的——读注释里的 issue 号就能看到这段演化史。

---

## 八、后续细化 TODO

- [ ] `standardSchemaToJSONSchema` 在步骤 6 里的作用（prompt 别名判定）
- [ ] `truncateForLogging` 怎么截断过长的错误信息
- [ ] 这套校验管道对性能的影响（多次重试校验的开销）
- [ ] 是否有办法关闭某些步骤（比如生产环境想要更严格、不自动纠正）
