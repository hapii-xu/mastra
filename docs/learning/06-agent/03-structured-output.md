# 06.3 结构化输出（structuredOutput）

> 源码：`agent.ts` generate/stream 的 `structuredOutput` 选项；`stream/base/output-format-handlers.ts`（解析，见 04）
> 示例：[`examples/03-structured-output.test.ts`](./examples/03-structured-output.test.ts)
> 跑：`cd docs/learning/06-agent/examples && npx vitest run 03`

让 agent 返回符合 schema 的**对象**，而不是自由文本。企业级常用：抽取、分类、表单填充。

---

## 一、基本用法

```ts
const schema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  score: z.number(),
})

const agent = new Agent({ name: 'structured', instructions: '...', model })

const out = await (await agent.stream('今天天气真好', { structuredOutput: { schema } })).getFullOutput()
// out.text   → 原始文本（模型的 JSON 字符串）
// out.object → 解析后的对象 { sentiment: 'positive', score: 0.9 }
```

`output.object` 是解析后的结构化结果；`output.text` 是原始文本。**不配 `structuredOutput` → `object` 为 undefined。**

---

## 二、信息抽取实战

```ts
const schema = z.object({
  personName: z.string(),
  age: z.number().nullable(),
  email: z.string().nullable(),
})
// 输入 "张三 30 岁" → out.object = { personName: '张三', age: 30, email: null }
```

---

## 三、解析发生在哪

`stream/base/output-format-handlers.ts`（761 行）负责把模型的输出按 schema 解析。配合 `processors/processors/structured-output.ts`（见 08）。

`generate`/`stream` 在 API 边界调 `toStandardSchema(schema)`（`agent.ts` generate 第 6 步），把 zod schema 转成标准 schema。

---

## 四、Debug 断点清单

| 断点                                        | 观察什么    |
| ------------------------------------------- | ----------- |
| `stream/base/output-format-handlers.ts`     | 解析逻辑    |
| `agent.ts` generate 里的 `toStandardSchema` | schema 转换 |

**推荐动作**：跑 `examples/03`，在模型返回 JSON 后看 `output.object` 怎么从 `output.text` 解析出来。

---

## 五、设计取舍与坑

- **`object` 只在配了 `structuredOutput` 时有**：不配就是 undefined。
- **模型必须返回符合 schema 的 JSON**：真实模型靠提示词约束；mock 要手动返回正确 JSON。
- **JSON mode vs tool-based**：两条解析路径（见 04-stream），`output-format-handlers.ts` 负责选。
- **schema 在 API 边界转 standard schema**：`toStandardSchema`。

---

## 六、后续细化 TODO

- [ ] JSON mode vs tool-based 结构化输出的两条路径
- [ ] 解析失败时的行为（模型返回非法 JSON）
- [ ] 嵌套 schema、enum、nullable 的处理
- [ ] `processors/processors/structured-output.ts` 的配合（见 08）
