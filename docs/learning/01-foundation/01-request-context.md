# 01.1 RequestContext — 请求级上下文

> 源码：`packages/_internal-core/src/request-context/index.ts`（335 行）
> 示例：[`examples/01-request-context-basics.test.ts`](./examples/01-request-context-basics.test.ts)、[`02-fork`](./examples/02-request-context-fork.test.ts)、[`03-tojson`](./examples/03-request-context-tojson.test.ts)、[`04-security`](./examples/04-request-context-security.test.ts)、[`05-version-overrides`](./examples/05-version-overrides.test.ts)
> 跑：`cd docs/learning/01-foundation/examples && npx vitest run`（零构建，~300ms）

**全框架最需要吃透的一个小类。** 335 行，但它决定了多租户怎么做、为什么 direct 是默认引擎、为什么 loop 要发明 runScope。

---

## 一、它是什么

一条贯穿全链路的**请求级数据总线**：从 `agent.stream({ requestContext })` 传进去，一路流到 workflow step、tool execute、processor。你的租户 ID、用户身份、AB 实验分组，都靠它传递。

```
HTTP 请求 → 认证中间件 → RequestContext → agent.stream()
                                            → workflow step
                                            → tool.execute()
                                            → processor
                                            → memory
```

### 数据结构：一个 Map，仅此而已

```ts
export class RequestContext<Values extends Record<string, any> | unknown = unknown> {
  private registry = new Map<string, unknown>();   // index.ts:123
```

**`private` 只是 TypeScript 层的**——运行时这个字段完全可枚举。记住这点，它是 §五 `serializeForSpan` 存在的全部理由。

### ⭐ 可变、共享、没有 fork

索引里留的那个 TODO（「是可变的还是不可变的？」）现在有答案了：**可变，而且没有任何保护**。

- 没有 `fork()`、没有 `clone()`、没有冻结、没有写时复制
- 把它传给下游 = **交出一个可写句柄**

```ts
// examples/01-request-context-basics.test.ts
it('传给别人 = 给出可写句柄，对方的修改你立刻看得到', () => {
  const ctx = new RequestContext()
  ctx.set('tenantId', 'acme')
  downstream(ctx) // 下游 set 了同一个 key
  expect(ctx.get('tenantId')).toBe('evil-corp') // 被改掉了
})
```

这个设计决定，在主干代码里长出了 §三 那一课。

---

## 二、完整 API 表

| 成员                     | 行      | 说明                                           |
| ------------------------ | ------- | ---------------------------------------------- |
| `constructor(iterable?)` | 125-135 | **双模式**：tuple 数组 / plain object，见下    |
| `set(key, value)`        | 140-146 | ⚠️ 返回 `void`，**不可链式**                   |
| `get(key)`               | 151-156 | 不存在返回 `undefined`，不抛错                 |
| `has(key)`               | 161-163 |                                                |
| `delete(key)`            | 168-170 | 返回 `boolean`（原来存在吗）                   |
| `clear()`                | 175-177 |                                                |
| `keys()`                 | 182-184 | 返回**迭代器**，不是数组                       |
| `values()`               | 189-193 | 同上                                           |
| `entries()`              | 199-205 | 同上；类型是**可辨识联合元组**，便于窄化       |
| `size()`                 | 210-212 | ⚠️ **是方法不是 getter**（与 `Map.size` 相反） |
| `forEach(cb)`            | 218-226 | ⚠️ 回调第三参**漏出底层原始 Map**              |
| `toJSON()`               | 243-263 | §四                                            |
| `isSerializable(v)`      | 274-289 | private，§四                                   |
| `serializeForSpan()`     | 300-318 | §五                                            |
| `get all`                | 332-334 | **唯一的 getter**，用于解构                    |

### 两个高频坑

```ts
ctx.set('a', 1).set('b', 2);   // ❌ TypeError：set 返回 void
if (ctx.size) { ... }          // ❌ 恒为 true：size 是函数，函数是 truthy
if (ctx.size() > 0) { ... }    // ✅
```

### 构造函数的双模式（125-135）

```ts
if (iterable && typeof iterable === 'object' && typeof (iterable as any)[Symbol.iterator] !== 'function') {
  this.registry = new Map(Object.entries(iterable)) // 131 · plain object 分支
} else {
  this.registry = new Map(iterable) // 133 · iterable 分支
}
```

判别依据是**有没有 `Symbol.iterator`**，不是 `Array.isArray`。所以 `Map`、tuple 数组走下面，普通对象走上面。

**plain object 分支为什么存在**：JSON round-trip 回来的就是普通对象（§四）。evented 引擎跨进程传完 context，靠这个分支重建。

### `all` getter（332-334）

```ts
const { userId, apiKey } = ctx.all // 注意没有括号
```

`Object.fromEntries(this.registry)`——**每次都新建对象，但只是浅拷贝**。改顶层 key 不回写，改存储对象的内部照样串味（和 §三 同源）。

### 类型设计的来由

`request-context.test-d.ts:13` 的 describe 名直接写着 **`Issue #4467: get() should return accurate types based on key`**。140-226 行那套条件类型体操就是为它而生：

```ts
public get<K extends Values extends Record<string, any> ? keyof Values : string, ...>(key: K): R
```

传了 `Values` 泛型就有精确类型，不传就退化成 `unknown`。

---

## 三、⭐ 最好的一课：`fork()` 不存在

**这是本模块真正的教学眼。** 一个类少了个方法，在主干代码里长出了两种应对。

### 做法 A（干净）：手搓 fork

`packages/memory/src/processors/observational-memory/internal-request-context.ts:19`：

```ts
const internalRequestContext = new RequestContext(requestContext.entries())
internalRequestContext.set(MASTRA_THREAD_ID_KEY, `${parentThreadId}-${omAgentId}`)
```

同样的 idiom 散落在：`agent-controller/tools.ts:251,353`、`evals/base.ts:553`、`workflows/evented/workflow-event-processor/{loop.ts:44, sleep.ts:92,187, parallel.ts:118}`。

### ⚠️ 但 fork 是浅拷贝

`new Map(iterable)` 复制的是 entry，**value 还是同一个引用**：

| 操作                                         | 隔离？      |
| -------------------------------------------- | ----------- |
| fork 后 `set('key', newValue)`（顶层重绑定） | ✅ 隔离     |
| fork 后 `get('obj').field = x`（改值内部）   | ❌ **串味** |

```ts
// examples/02-request-context-fork.test.ts
it('⚠️ 存储对象的内部字段：串味 ❌ —— fork 挡不住', () => {
  const forked = new RequestContext(parent.entries())
  ;(forked.get('config') as any).retries = 99
  expect((parent.get('config') as any).retries).toBe(99) // 父的也变了
})
```

**这个坑光读记不住，跑一遍 + 断点看一眼就永远忘不了。**

### 做法 B（脏）：save → delete → restore

`packages/core/src/agent/agent.ts:4608-4615`，在**共享**上下文上操作：

```ts
// Save and clear reserved thread/resource keys so they don't override the
// sub-agent's isolated memory config. These keys take precedence over the
// memory option in generate/stream, so leaving them would cause the
// sub-agent to write to the parent's thread instead of its own.
const savedThreadIdKey = requestContext.get(MASTRA_THREAD_ID_KEY) as string | undefined
const savedResourceIdKey = requestContext.get(MASTRA_RESOURCE_ID_KEY) as string | undefined
if (savedThreadIdKey !== undefined) requestContext.delete(MASTRA_THREAD_ID_KEY)
if (savedResourceIdKey !== undefined) requestContext.delete(MASTRA_RESOURCE_ID_KEY)
```

**代价：恢复逻辑要在 5 个 return 分支里各写一遍**——`agent.ts` 的 4755/4758、4955/4958、5133/5136、5264/5267、5348/5351。

**漏掉任何一个分支 = 父上下文被永久污染 = 后续所有记忆写入跑偏。** `examples/02` 里有一个用例专门演示这个翻车现场。

### 这一课的意义

> 一个缺失的 `fork()`，换来了 5 处必须配对的手工恢复。

学 06-agent 的子 agent 委派时会再撞见它。看到 `new RequestContext(x.entries())` 就知道：**这是在手搓 fork。**

---

## 四、⭐ toJSON：静默过滤与那个 CPU 挂死的 bug

### 过滤规则（`isSerializable`，274-289）

| 值类型                                              | 结果            | 行      |
| --------------------------------------------------- | --------------- | ------- |
| `null` / `undefined`                                | ✅ 保留         | 275     |
| **函数**                                            | ❌ **静默丢弃** | 276     |
| **symbol**                                          | ❌ **静默丢弃** | 277     |
| 其他非 object（string/number/boolean）              | ✅ 保留         | 278     |
| object 且 `JSON.stringify` 成功                     | ✅ 保留         | 281     |
| **object 但 stringify 抛错**（循环引用、RPC proxy） | ❌ **静默丢弃** | 283-288 |

**「静默」是关键词**：没有报错、没有警告、没有日志。你以为传过去了，其实没有。

### ⚠️ 按引用拷贝，不是深拷贝

```ts
result[key] = value // index.ts:255 —— 直接赋引用
```

`toJSON()` 返回的**不是安全快照**，它和原值共享结构。`examples/03` 里有用例钉死这点。

### ⭐ 跨 context 循环：一个真实的 100% CPU bug

`index.ts:83-100` 的注释完整记录了这个 bug，**是教科书级的「注释解释 why」范例**：

> V8 的循环检测是**每次 `JSON.stringify` 调用**独立的。
> 若 ctx A 存的值引用 ctx B，B 存的值又引用回 A：
> `A.toJSON()` → `isSerializable` → `JSON.stringify` → V8 调 `B.toJSON()` → `isSerializable` → **全新的 `JSON.stringify`（cycle stack 重置！）** → 回到 A → …
> 每一跳都重置了 V8 的检测器，**于是环永远检测不到，单核 100% 无限递归**。

修复三件套：

| 组件                              | 行  | 作用                             |
| --------------------------------- | --- | -------------------------------- |
| `_toJSONInProgress: WeakSet`      | 113 | 追踪 `toJSON()` 在调用栈上的实例 |
| `_toJSONDepth: number`            | 120 | 嵌套深度计数                     |
| `CyclicRequestContextToJSONError` | 101 | 私有标记类（不导出）             |

流程：重入被 `WeakSet` 撞见 → 抛标记(244-248) → 内层 `isSerializable` 在 `_toJSONDepth > 1` 时**重抛**(284-286) → **最外层**吞掉、把该 key 过滤掉(287)，和处理普通循环引用一模一样。`finally`(259-262) always 清理。

**两个值得注意的点**：

1. 这是**模块级可变状态**——只因为 `toJSON` 是完全同步的才安全
2. `_toJSONDepth > 1` 这个判断是 load-bearing 的，去掉它标记就会逃逸给调用方

`examples/03` 里 A↔B、自引用、三方环 A→B→C→A、`JSON.stringify(ctx)` 四个用例全部会**正常返回而不是挂死**——它们就是这套机制的回归守卫（对应原生测试 `index.test.ts:232`）。

### 一次 round-trip 的真实遭遇

```ts
// examples/03-request-context-tojson.test.ts
const wire = JSON.stringify(original)
const revived = new RequestContext(JSON.parse(wire))

expect(revived.get('tenantId')).toBe('acme') // 普通数据活着
expect(revived.get('onProgress')).toBeUndefined() // 回调静默消失
```

**这就是为什么**：

- direct 是默认引擎（06-agent）
- `MASTRA_EVENTED_EXECUTION=true` 会让 requestContext 里的函数消失
- loop 要发明 `runScope` 来传 class 实例和闭包（07-loop）

---

## 五、⭐ 安全：三种序列化，三套威胁模型

| 方法                              | 位置                                 | 策略                              | 拷贝语义   | 用途         |
| --------------------------------- | ------------------------------------ | --------------------------------- | ---------- | ------------ |
| `toJSON()`                        | index.ts:243                         | **黑名单**（能 stringify 就放行） | **按引用** | 持久化       |
| `serializeForSpan()`              | index.ts:300                         | **白名单**（只有原始值能出去）    | 值替换     | 可观测性     |
| `snapshotRequestContextEntries()` | `agent/durable/preparation.ts:41-59` | 逐条 try/catch JSON round-trip    | **深拷贝** | durable 快照 |

**三个函数，对「怎么把它变安全」给出三个不同答案。** 并排看一遍，比单独读任何一个都有收获。

第三个尤其值得注意：durable agent **不用 `toJSON()`**，自己逐条 `JSON.parse(JSON.stringify(v))`。注释(39-40)：

> Best-effort: entries that fail a JSON round-trip are skipped so a single non-serializable value can't break the workflow input.

### `serializeForSpan` 为什么必须存在（291-318）

注释(291-299)把威胁说得很清楚：

> `@mastra/observability` 的 `deepClean` 会先调这个方法，**否则就会 fallback 到 `Object.keys()`** 遍历运行时可枚举的 `registry` 字段，**把 bearer token 原样序列化进导出的 span**。

行为：

```ts
if (key === MASTRA_AUTH_TOKEN_KEY)
  safe[key] = '[REDACTED]' // 303-304
else if (是原始值)
  safe[key] = value // 305-313
else safe[key] = `[${typeof value}]` // 314
```

### 两个方法的产物对比（examples/04 有完整用例）

同一个 context：

```ts
ctx.toJSON()
// { tenantId: 'acme', mastra__authToken: 'Bearer secret', meta: { nested: true } }
//                     ⚠️ token 原样保留！

ctx.serializeForSpan()
// { tenantId: 'acme', mastra__authToken: '[REDACTED]', meta: '[object]' }
```

**关键推论：`toJSON()` 不脱敏。别拿它往日志/追踪里写。**

还有一条：

```ts
ctx.set('myAuthToken', 'Bearer x') // 自己造的键名
ctx.serializeForSpan().myAuthToken // 'Bearer x' —— 是字符串，白名单放行了
```

**别自己造 token 键**，脱敏只认 `MASTRA_AUTH_TOKEN_KEY` 这一个常量。

---

## 六、4 个保留键与多租户安全

全部是 `mastra__`（**双**下划线）前缀：

| 常量                     | 行  | 值                   | 生产写入点                                    |
| ------------------------ | --- | -------------------- | --------------------------------------------- |
| `MASTRA_RESOURCE_ID_KEY` | 17  | `mastra__resourceId` | `server/auth/helpers.ts:473`（唯一）          |
| `MASTRA_THREAD_ID_KEY`   | 31  | `mastra__threadId`   | memory / agent 内部                           |
| `MASTRA_VERSIONS_KEY`    | 44  | `mastra__versions`   | `handlers/agents.ts:106,126`、`agent.ts:6488` |
| `MASTRA_AUTH_TOKEN_KEY`  | 51  | `mastra__authToken`  | `server/auth/helpers.ts:466`（唯一）          |

### ⭐ 越权防护

`MASTRA_RESOURCE_ID_KEY` 的注释(7-8)原文：

> When set in RequestContext, this takes precedence over client-provided values **for security (prevents attackers from hijacking another user's memory)**.

落地就是 `server/handlers/utils.ts:73-90` 的一行：

```ts
contextResourceId || clientResourceId // 中间件设的恒赢
```

```ts
// examples/04-request-context-security.test.ts
ctx.set(MASTRA_RESOURCE_ID_KEY, 'user-alice') // 认证中间件写入
getEffectiveResourceId(ctx, 'user-bob') // 攻击者伪造
// → 'user-alice'，攻击失败
```

**⚠️ 推论：不配认证中间件 = 客户端可以随便声称自己是谁。** 企业级第一件事。

### `MASTRA_AUTH_TOKEN_KEY` 的奇特身世

**它在生产代码里从不被 `.get()` 读取**——唯一的引用点是 `index.ts:303`，就是为了脱敏比对。

> 好问题：一个从不被读取的 key，为什么还要有个常量？
> 答：它的价值不在读取，而在**给脱敏逻辑一个稳定的比对目标**。

写入点 `server/auth/helpers.ts:450-466` 也值得一读：它会在 **Authorization header → apiKey query 参数 → `mastra-token` cookie** 三处轮流找 token，保证不管用哪种认证方式都能转发。

---

## 七、版本覆盖（53-81）

```ts
export type VersionSelector = { versionId: string } | { status: 'draft' | 'published' } // 53
export type VersionOverrides = {
  agents?: Record<string, VersionSelector>
  defaultStatus?: 'draft' | 'published' // 无显式条目时的兜底
} // 55
```

`mergeVersionOverrides(base, overrides)`(61-81) 的语义：

- 两边都空 → `undefined`(65)
- **`agents` 逐键浅合并**，overrides 赢(70-73)——`base` 里没被点名的 agent 存活
- `defaultStatus`：overrides 赢 → 回退 base → **两边都没有就整个字段不出现**(75-79)

**那串嵌套三元展开(75-79)不是炫技**：第 69 行的 `...overrides` 若带 `defaultStatus: undefined`，会把 base 的值覆盖掉。条件展开才能做到「没给就不出现」。`examples/05` 有用例钉死这点。

### 三级优先级（`agent/agent.ts:6479-6488`）

```
Mastra 默认  <  requestContext  <  调用点 options.versions
```

两次连续 `mergeVersionOverrides`，结果**写回 `MASTRA_VERSIONS_KEY`**(6488)，这样子 agent 才能继承。

消费端 `agent.ts:4621-4625`：逐 agent 条目优先，`defaultStatus` 兜底。

---

## 八、Debug 断点清单

| 断点                                                  | 观察什么                                      |
| ----------------------------------------------------- | --------------------------------------------- |
| `index.ts:130` 构造函数的 if                          | 走了 plain object 还是 iterable 分支          |
| `index.ts:254` `if (this.isSerializable(value))`      | **逐 key F5**，看每个值走进哪个分支、谁被丢了 |
| **`index.ts:244`** `if (_toJSONInProgress.has(this))` | **最精彩的断点**：检测到重入、抛标记的那一刻  |
| `index.ts:284-286` 的重抛                             | 标记怎么一层层冒到最外层                      |
| `index.ts:303` `if (key === MASTRA_AUTH_TOKEN_KEY)`   | 脱敏发生的那一行                              |
| `index.ts:133` `new Map(iterable)`                    | **fork 的浅拷贝本质**：value 是同一个引用     |
| `agent/agent.ts:4608`                                 | save/delete/restore 舞蹈的起点（需先修构建）  |
| `server/handlers/utils.ts:77`                         | `context \|\| client` 的越权防护              |

**推荐动作**：跑 `examples/03-request-context-tojson.test.ts` 的「A ↔ B 互相引用」用例，在 `index.ts:244` 打断点。你会亲眼看到 `toJSON` 被重入、`WeakSet` 撞到自己、标记被抛出。**这个 bug 修复过程是整个 foundation 里最值得学的一段代码。**

---

## 九、设计取舍与坑

- **可变共享 + 无 fork** 是本模块一切问题的根源。好处是零拷贝开销、任何层都能写；坏处是 `agent.ts` 里那 5 处手工恢复。
- **静默过滤**：`toJSON` 丢东西不报错。这是刻意的（一个坏值不该炸掉整个 workflow），但也意味着**你得自己知道什么能放什么不能放**。
- **两个私有语义**：`RequestContext` 的 `private registry` 是 TS-only（运行时可枚举 → 需要 `serializeForSpan`），而 `MastraBase` 的 `#rawConfig` 是真 ES 私有。同一个 foundation 里两种写法，后果不同。
- **`core/src/di/` 是第二扇门**：8 行的 re-export，且**漏掉了 `MASTRA_AUTH_TOKEN_KEY`**。`packages/server/src/server/handlers/agents.ts:11` 至今还从 `@mastra/core/di` 导入。两个入口通向同一个房间。
- **`server/constants.ts:9,11,19` 把 4 个 key 重新写了一遍**（字符串字面量，没 import）——两份真理靠手工同步。
- **还有个没文档化的保留键**：`tool-call-step.ts:467` 的 `__mastra_requireToolApproval`，**单下划线、不同前缀**，不在那 4 个常量里。

---

## 十、后续细化 TODO

- [ ] `agent.ts` 那 5 处恢复分支逐个核对，看有没有真的漏掉的（潜在 bug 猎场）
- [ ] `Values` 泛型的条件类型体操逐行拆解（140-226），配合 `request-context.test-d.ts` 读
- [ ] 原生测试对照：`agent/__tests__/request-context-reserved-keys.test.ts`（4 个保留键的安全测试）
- [ ] `loop/test-utils/aimock/scenarios/request-context-{mutation,isolation}.scenario.test.ts`——**可变性与隔离的官方场景测试**，正对应 §三
- [ ] `agent/durable/__tests__/durable-agent-request-context.test.ts`：跨 durable 边界的序列化
- [ ] 多租户实战：租户 ID 从哪进（header/JWT/子域名）、怎么防止下游改写
- [ ] `_toJSONDepth` 的并发安全边界：如果未来 `toJSON` 变成异步会怎样
