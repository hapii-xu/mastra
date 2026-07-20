# 04.2 ⭐ tripwire ≠ error —— 两种不同性质的失败

> 源码：`packages/core/src/agent/trip-wire.ts`（`TripWire` 类）；`stream/base/output.ts:1496`（`get tripwire`）
> 示例：[`examples/02-tripwire-and-error.test.ts`](./examples/02-tripwire-and-error.test.ts)
> 跑：`cd docs/learning/04-stream/examples && npx vitest run 02`

**这是本模块最重要的一课，直接关系到用户体验设计。** processor 主动中断（内容审核拦截、prompt 注入检测）走 `tripwire` 字段，**不是** `error`。企业级做用户提示时必须区分这两者。

---

## 一、`TripWire` 是什么

`agent/trip-wire.ts`：一个自定义 `Error` 子类，从 processor 里抛出，表示「处理应该停止」（不是系统故障）。

```ts
export class TripWire<TMetadata = unknown> extends Error {
  public readonly options: TripWireOptions<TMetadata>;
  public readonly processorId?: string;
  constructor(reason: string, options: TripWireOptions<TMetadata> = {}, processorId?: string) { ... }
}
```

`TripWireOptions`：

- `retry?: boolean` —— 若为 `true`，agent 会带着拦截原因重试
- `metadata?: TMetadata` —— **强类型元数据**，processor 可以传结构化信息说明具体触发原因

---

## 二、实测：processor 抛 TripWire 之后的完整产出

```ts
const blockProcessor = {
  id: 'blocker',
  processInput: async () => {
    throw new TripWire('内容被拦截：命中黑名单词', { retry: false });
  },
};
const agent = new Agent({ inputProcessors: [blockProcessor], ... });
const output = await (await agent.stream('危险词')).getFullOutput();
```

结果（`examples/02` 实测钉死）：

```ts
output.tripwire ===
  {
    reason: '内容被拦截：命中黑名单词',
    retry: false,
    processorId: 'p-input-processor', // 自动生成
    metadata: undefined,
  }
output.error === undefined // ⭐ 不是系统错误
output.text === '' // 模型根本没被调用
```

---

## 三、⭐ 结构化 metadata：给业务代码用

```ts
throw new TripWire('检测到 PII', {
  retry: false,
  metadata: { category: 'pii', field: 'phone' },
})
```

`output.tripwire.metadata` 能带任意结构化信息，业务代码可以据此做精细化处理（比如根据 `category` 展示不同提示文案）。

---

## 四、正常执行时，两者都是 undefined

```ts
const output = await agent.stream('普通问题').then(r => r.getFullOutput())
output.tripwire === undefined
output.error === undefined
output.text === '正常回复'
```

---

## 五、⭐ 企业级判断模式

```ts
const userMessage = output.tripwire
  ? `请求被拦截：${output.tripwire.reason}` // 业务拦截，预期行为
  : output.error
    ? '系统繁忙，请稍后再试' // 技术故障，非预期
    : output.text // 正常回复
```

**判断顺序很重要**：先查 `tripwire`（最具体），再查 `error`（兜底），最后才是正常文本。

---

## 六、Debug 断点清单

| 断点                                        | 观察什么                                    |
| ------------------------------------------- | ------------------------------------------- |
| `agent/trip-wire.ts` 构造函数               | `reason`/`options`/`processorId` 怎么被设置 |
| `stream/base/output.ts:1496` `get tripwire` | tripwire 怎么从内部状态读出                 |
| 你的 processor 里 `throw new TripWire(...)` | 抛出的时机                                  |

**推荐动作**：跑 `examples/02`，在 `agent/trip-wire.ts` 构造函数打断点，观察 processor 抛出时携带的完整信息如何流入最终的 `FullOutput.tripwire`。

---

## 七、设计取舍与坑

- **别把 tripwire 当 error 处理**：会话被拦截是「按预期工作」，展示成功「出错了」的提示会误导用户。
- **`processorId` 是自动生成的**：格式类似 `<agentName>-input-processor`，可用于日志关联具体是哪个 processor 拦截的。
- **`retry: true` 时的行为**：agent 会带着拦截原因重试——这意味着你的 processor 逻辑要考虑「被重试调用」的情况，避免死循环。
- **`metadata` 的类型是强类型的**（`TripWire<TMetadata>`）：写自定义 processor 时善用泛型，让调用方能精确知道 metadata 的形状。

---

## 八、后续细化 TODO

- [ ] `retry: true` 的完整重试链路：重试时消息历史里会加入什么
- [ ] 多个 processor 都可能抛 TripWire 时，谁的优先级更高
- [ ] `onViolation` 回调（`processors/index.ts`）和 TripWire 的关系——是否可以只记录不阻断
- [ ] 内置 processor（moderation、pii-detector 等）各自的 TripWire reason/metadata 格式（见 08）
