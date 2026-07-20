# 04.1 MastraModelOutput 的两种消费方式

> 源码：`packages/core/src/stream/base/output.ts`（1858 行）
> 示例：[`examples/01-output-consumption.test.ts`](./examples/01-output-consumption.test.ts)
> 跑：`cd docs/learning/04-stream/examples && npx vitest run 01`

`agent.stream()` 返回 `MastraModelOutput`——一个「双面对象」：既能当流消费（逐 chunk 拿），也能 `await` 拿最终结果。

---

## 一、方式一：`await getFullOutput()`

```ts
const output = await (await agent.stream('hi')).getFullOutput()
output.text // 完整文本
```

`getFullOutput()`（`output.ts:1425`）等待流跑完，把内部 `#buffered*` 字段组装成 `FullOutput`。

**`agent.generate()` 的本质就是这个**（`agent.ts:7291`）：

```ts
// generate 内部等价于：
const streamResult = await agent.stream(...);
return streamResult.getFullOutput();
```

没有独立的非流式实现。

---

## 二、方式二：`textStream` —— 纯文本流

```ts
for await (const chunk of streamResult.textStream) {
  process.stdout.write(chunk) // 打字机效果
}
```

`textStream`（`output.ts:1565`）是 `ReadableStream<string>`，只吐 `text-delta` 的内容，过滤掉其他事件类型。

---

## 三、⭐ 方式三：`fullStream` —— 完整事件流（实测的 chunk 序列）

```ts
for await (const chunk of streamResult.fullStream) {
  console.log(chunk.type)
}
```

一次纯文本响应的完整事件序列（`examples/01` 实测钉死）：

```
start → step-start → text-start → text-delta → text-end → step-finish → finish
```

**这是 UI 层真正会用的接口**——每个 chunk 有 `type`，可以区分文本增量、步骤边界、工具调用等，用于精细的前端渲染（打字机效果、工具调用提示、步骤进度条）。

---

## 四、⚠️ 一个流只能消费一次，但 getFullOutput 有缓冲

```ts
for await (const chunk of streamResult.fullStream) {
  /* 消费一遍 */
}
const output = await streamResult.getFullOutput() // 仍能拿到完整结果
```

`MastraModelOutput` 内部靠私有字段（`#bufferedChunks` 等）边流边攒。**`fullStream`/`textStream` 本身是一次性的 ReadableStream**，但 `getFullOutput()` 读的是内部缓冲，不是重新消费流——所以「先流式展示、再拿完整结果」是安全的组合，`examples/01` 验证了这一点。

**但反过来不成立**：两次遍历 `fullStream` 本身（不经过 getFullOutput）会在第二次拿到空/报错，因为底层 ReadableStream 已经被读完。

---

## 五、Debug 断点清单

| 断点                              | 观察什么                                    |
| --------------------------------- | ------------------------------------------- |
| `output.ts:1425` `getFullOutput`  | 所有 `#buffered*` 字段怎么组装成 FullOutput |
| `output.ts:1565` `get textStream` | 只过滤 `text-delta` 的实现                  |
| `output.ts:1264` `get fullStream` | 完整事件流的构造                            |

**推荐动作**：跑 `examples/01` 的 `fullStream` 用例，在 `output.ts:1264` 打断点，观察每个 chunk 依次到达的过程。

---

## 六、设计取舍与坑

- **三种消费方式服务不同场景**：`getFullOutput`（脚本/API 后端）、`textStream`（简单聊天 UI）、`fullStream`（需要精细控制的复杂 UI）。
- **generate 不比 stream 快**：两者走同一条链路，generate 只是多等了一步。
- **别对同一个流调用两次消费**（不经过 getFullOutput）：第二次会拿到空结果，这是 ReadableStream 的通用限制，不是 Mastra 特有的。

---

## 七、后续细化 TODO

- [ ] `#bufferedChunks` 等私有字段的完整清单与填充时机
- [ ] `objectStream`/`elementStream`（结构化输出的流式版本，见 06.3）
- [ ] `consumeStream()` 方法的用途（`output.ts:1398`）
- [ ] 背压（backpressure）：消费慢了会怎样
