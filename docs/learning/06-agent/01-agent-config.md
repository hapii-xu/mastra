# 06.1 Agent 构造与配置

> 源码：`packages/core/src/agent/agent.ts`（8952 行，`class Agent:457`）
> 示例：[`examples/01-agent-config.test.ts`](./examples/01-agent-config.test.ts)
> 跑：`cd docs/learning/06-agent/examples && npx vitest run 01`

**Agent 把模型、工具、记忆、处理器、可观测性编排成一个能自主完成任务的单元。** 8952 行——全包最大的文件。但学完 05（workflow）和 07（loop）后，它就是一个「把 workflow 组装起来的大工厂」。

---

## 一、最小配置

```ts
const agent = new Agent({
  name: 'minimal',
  instructions: '你是个助手',
  model: mockModel([...]) as any,
});
const out = await (await agent.stream('hi')).getFullOutput();
```

`name` + `instructions` + `model` 就能跑。

---

## 二、⭐ 核心事实：agent 就是三层嵌套 workflow

```
agent.stream() → #execute (agent.ts:6467)
  └─ execution-workflow        .parallel().map().then()      (prepare-stream/index.ts:184)
       └─ agentic-loop         .dowhile(停止条件)             (loop/agentic-loop/index.ts:24)
            └─ agentic-execution .then().map().foreach().then()...  (loop/agentic-execution/index.ts:113)
```

**学 06 之前必须先学 05 和 07。** 这三层都是 workflow，控制流原语见 05.2，循环机制见 07.2。

---

## 三、instructions / 系统提示词

```ts
new Agent({ instructions: '你是个翻译助手', ... })
await agent.getInstructions();   // 取指令
```

`getInstructions()` 是 async——因为 instructions 支持 `DynamicArgument`（可以是函数，按请求生成，见 06.2）。

---

## 四、metadata —— 任意元数据

```ts
new Agent({ metadata: { role: 'support', version: 3 }, ... })
await agent.getMetadata();   // { role: 'support', version: 3 }
```

同样支持 `DynamicArgument`，所以是 async 方法。用于挂版本、分类、标签等。

---

## 五、工具配置（11 个来源之一：直接 tools）

```ts
new Agent({ tools: { calc }, ... })
await agent.getToolsForExecution({});   // 拿转换后的工具
```

⚠️ `getToolsForExecution({})` 要传 options 对象（不传会抛 `reading 'requestContext' of undefined`）。

agent.ts 有 **11 个 `list*Tools` 方法**（见下表），全部汇入 `convertTools()`（`agent.ts:5751`）。最常见的是直接配 `tools: {}`。

---

## 六、⭐ ephemeral mastra —— agent 可脱离 Mastra 独立使用

```ts
// 不注册 Mastra 也能 stream
const agent = new Agent({ name: 'x', instructions: '...', model })
await agent.stream('hi')
```

`#execute` 第 4 步（`agent.ts:6467` 附近）：`this.#mastra ?? await this.#getOrCreateEphemeralMastra()`。没注册时 agent 自己造一个临时 Mastra 实例（带 InMemoryStore）。

**这就是为什么测试里能直接 `new Agent({...}).stream()`**。但生产里注意：可能不小心创建多个 Mastra 实例（各自独立存储连接）。

---

## 七、Debug 断点清单

| 断点                                          | 观察什么                             |
| --------------------------------------------- | ------------------------------------ |
| `agent.ts:457`                                | `class Agent`                        |
| `agent.ts:6467`                               | **`#execute`：合并后的最终 options** |
| `agent/workflows/prepare-stream/index.ts:184` | execution-workflow 的形状            |
| `agent.ts:2743`                               | `resolveModelConfig`：模型解析       |
| `agent.ts:5696`                               | `getToolsForExecution`：工具汇总     |

**推荐动作**：跑 `examples/01`，在 `agent.ts:6467`（#execute）打断点，看你传的配置合并成了什么。

---

## 八、设计取舍与坑

- **agent 是 workflow 工厂**：8952 行里大部分是「解析配置 + 组装 workflow」，执行逻辑在 07。
- **ephemeral mastra**：方便测试，但生产注意别创建多实例。
- **`getToolsForExecution({})` 要传 options**：常见 TypeError 来源。
- **`metadata`/`instructions` 是 async 方法**：支持 DynamicArgument。
- **`agent/index.ts` 故意不导出 `DurableAgent`**：循环依赖，要从 `@mastra/core/agent/durable` 导入。

---

## 九、后续细化 TODO

- [ ] `#execute` 六步逐步拆解
- [ ] 11 个 `list*Tools` 的优先级与命名冲突
- [ ] `getDefaultOptions` + `deepMerge` 的配置合并
- [ ] `AgentCapabilities` 封了什么
- [ ] ephemeral mastra 的资源开销与多实例隔离
