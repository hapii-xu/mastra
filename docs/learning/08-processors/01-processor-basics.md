# 08.1 Processor 基础：6 个切点、执行顺序

> 源码：`packages/core/src/processors/index.ts`（`Processor` 接口 `:560`，`BaseProcessor` `:750`）
> 示例：[`examples/01-processor-basics.test.ts`](./examples/01-processor-basics.test.ts)
> 跑：`cd docs/learning/08-processors/examples && npx vitest run 01`

**这是企业级落地最直接相关的模块。** 内容审核、PII 脱敏、prompt 注入检测、token 限流全是开箱即用的 processor。

---

## 一、6 个切点，全部可选

| 方法                  | 时机               |
| --------------------- | ------------------ |
| `processInput`        | 输入消息进来时     |
| `processInputStep`    | 每一轮循环的输入   |
| `processLLMRequest`   | 发给模型前         |
| `processLLMResponse`  | 模型返回后         |
| `processOutputStream` | 流式输出每个 chunk |
| `processOutputResult` | 最终结果           |

**只实现你需要的那几个即可**——`examples/01` 验证了只实现 `processOutputResult` 也完全合法。

---

## 二、⭐ 执行顺序：输入先跑完，输出后跑

```ts
const agent = new Agent({
  inputProcessors: [p1, p2],
  outputProcessors: [o1],
})
```

实测顺序：`p1-in → p2-in → o1-out`——**所有 input processor 先按声明顺序跑完，output processor 才开始**，不是交替执行。

---

## 三、⭐ processor 抛 TripWire → 模型完全不会被调用

```ts
const blocker = {
  id: 'blocker',
  processInput: async () => {
    throw new TripWire('拦截原因')
  },
}
```

`examples/01` 用一个跟踪调用的 mock 模型验证：**input processor 抛出 TripWire 后，模型的 `doStream` 从未被调用**——这不只是「返回了一个错误结果」，而是整条推理链路提前终止，没有产生任何模型调用成本。

关联 04.2：`output.tripwire` 会有值，`output.error` 是 undefined。

---

## 四、`BaseProcessor` 抽象类

```ts
export abstract class BaseProcessor<TId extends string = string, TTripwireMetadata = unknown> implements Processor<
  TId,
  TTripwireMetadata
> {
  abstract readonly id: TId
  protected mastra?: Mastra
  __registerMastra(mastra: Mastra): void {
    this.mastra = mastra
  }
}
```

继承它能拿到 `this.mastra`（注册后可用）。也可以直接实现 `Processor` 接口（本篇示例都是这么做的），不强制继承。

---

## 五、三种 Processor 分类

| 类型              | 至少要实现                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `InputProcessor`  | `processInput` / `processInputStep` / `computeStateSignal` / `processLLMRequest` / `processLLMResponse` 中任一 |
| `OutputProcessor` | `processOutputStream` / `processOutputResult` / `processOutputStep` 中任一                                     |
| `ErrorProcessor`  | `processAPIError`（**workflow 不支持**，只有 processor 方法能处理 API 拒绝）                                   |

---

## 六、Debug 断点清单

| 断点                                         | 观察什么            |
| -------------------------------------------- | ------------------- |
| 你的 processor 的 `processInput`             | 实际拿到的 messages |
| `TripWire` 构造函数                          | 拦截原因怎么被携带  |
| mock 模型的 `doStream`（本篇示例里加了追踪） | 是否真的没被调用    |

**推荐动作**：跑 `examples/01` 的 TripWire 用例，观察 `modelCalled` 标记始终为 `false`——这是「processor 拦截 = 零模型成本」的直接证据。

---

## 七、设计取舍与坑

- **顺序是「输入全部先跑完」**：不要假设 input/output processor 会交替执行。
- **TripWire 拦截是真的提前终止**：不产生模型调用，这对成本控制很关键。
- **6 个切点各自独立**：一个 processor 完全可以只关心输出，不碰输入。

---

## 八、后续细化 TODO

- [ ] `processInputStep`（每轮循环）与 `processInput`（仅首轮）的行为差异
- [ ] `computeStateSignal` 的用途
- [ ] `processAPIError` 的降级/重试场景（关联 03-llm 的 fallback）
- [ ] 多个 processor 都抛 TripWire 时谁的优先级更高
