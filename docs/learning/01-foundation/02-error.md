# 01.2 MastraError — 结构化错误体系

> 源码：`packages/_internal-core/src/error/index.ts`（153 行）+ `error/utils.ts`
> 示例：[`examples/06-error.test.ts`](./examples/06-error.test.ts)
> 跑：`cd docs/learning/01-foundation/examples && npx vitest run 06`

仓库原生测试 `error/index.test.ts` 只有 **8 个用例覆盖 153 行**——message 三级回退、`toString()`、跨子类 `instanceof` 都没测到。这篇连同 `examples/06` 把它们补齐。

---

## 一、为什么要有自己的错误类

普通 `throw new Error('...')` 在 Agent 框架里不够用：

- **没法按域归类**：是工具错、模型错、存储错，还是用户输入错？处理方式不同
- **没法结构化**：日志、API 响应、追踪系统都要 `{domain, category, details}` 这种形状
- **没法控制重试**：workflow 要知道「这个错重试有用吗」（§五）

`MastraError` 用三个维度回答这些问题：**domain（哪个子系统）× category（谁的责任）× id（具体哪个错）**。

---

## 二、两个枚举：19 × 4 的矩阵（7-34）

```ts
export enum ErrorDomain {
  TOOL,
  AGENT,
  MCP,
  AGENT_NETWORK,
  MASTRA_SERVER,
  MASTRA_OBSERVABILITY,
  MASTRA_WORKFLOW,
  MASTRA_VOICE,
  MASTRA_VECTOR,
  MASTRA_MEMORY,
  LLM,
  EVAL,
  SCORER,
  A2A,
  MASTRA_INSTANCE,
  MASTRA,
  DEPLOYER,
  STORAGE,
  MODEL_ROUTER,
} // 19 个，已 examples/06 用例核实

export enum ErrorCategory {
  UNKNOWN,
  USER,
  SYSTEM,
  THIRD_PARTY,
} // 4 个
```

### ⭐ 枚举是约定，不是强制

`MastraError`(142) 的定义是：

```ts
export class MastraError extends MastraBaseError<`${ErrorDomain}`, `${ErrorCategory}`> {}
```

注意是 **模板字面量联合** `` `${ErrorDomain}` ``，不是 `ErrorDomain` 本身。所以：

```ts
new MastraError({ id: 'X', domain: ErrorDomain.TOOL, category: ErrorCategory.USER })
new MastraError({ id: 'X', domain: 'TOOL', category: 'USER' }) // 裸字符串，类型上完全等价
```

**枚举只是 IDE 补全和可读性的约定，类型系统并不强制你用它。** `examples/06` 有用例钉死两者产物一致。

---

## 三、`IErrorDefinition` 与 details 的真实约束（48-64）

构造函数第一个参数：

| 字段       | 行  | 必填 | 类型                                                               |
| ---------- | --- | ---- | ------------------------------------------------------------------ |
| `id`       | 51  | ✅   | `Uppercase<string>`（**弱约束**，TS 只认字面量能否大写，形同文档） |
| `text`     | 55  | ❌   | `string`——**覆盖**原始错误 message                                 |
| `domain`   | 59  | ✅   | `DOMAIN`                                                           |
| `category` | 61  | ✅   | `CATEGORY`                                                         |
| `details`  | 63  | ❌   | `Record<string, Json<Scalar>>`                                     |

### ⭐ `details` 实际只能放平铺标量

`Json<T>`(38-42) 是个递归条件类型，对 `Scalar = null | boolean | number | string`(36) 会塌缩成 `Scalar` 本身。所以：

```ts
details: Record<string, Json<Scalar>>   ≈   Record<string, null|boolean|number|string>
```

**嵌套对象进不来。** 这就是为什么全仓库的调用点都写 `errorMessage: String(err)`，而不是把整个 error 对象塞进去：

```ts
// packages/core/src/tools/tool-builder/builder.ts:843
details: { errorMessage: String(err), toolName, ... }
```

### `details.status` 是夹带 HTTP 码的潜规则

```ts
// mastra/index.ts:1938 —— 404
text: `Agent with name ${name} not found`, details: { status: 404, ... }
// mastra/index.ts:108, 2066 —— 400
```

`details` 类型里没有 `status`，但全仓库都这么塞。读源码看到 `details.status` 就知道是 HTTP 码。

---

## 四、⭐ message 三级回退（101）

```ts
const message = errorDefinition.text ?? error?.message ?? 'Unknown error'
```

| 情况                                | message 来自                     |
| ----------------------------------- | -------------------------------- |
| 传了 `text`                         | `text`（覆盖原始错误的 message） |
| 没传 `text`，但传了 `originalError` | 原始错误的 `.message`            |
| 都没传                              | `'Unknown error'`                |

```ts
// examples/06-error.test.ts
new MastraError({ id:'X', ..., text:'自定义' }, new Error('原始'));  // → '自定义'
new MastraError({ id:'X', ... }, new Error('原始'));                 // → '原始'
new MastraError({ id:'X', ... });                                     // → 'Unknown error'
```

**实战含义**：`text` 是给「用户/日志看的友好文案」，会盖掉底层的技术性 message。想保留原始信息就别传 `text`，或者把它放进 `details`。

### 构造后几乎总跟 `trackException`

`packages/core/src/workflows/default.ts:468-478` 是全仓库的标准三连：

```ts
const mastraError = new MastraError({ id: 'WORKFLOW_STEP_INVOKE_FAILED', domain, category, details }, errorInstance);
this.logger?.trackException(mastraError);   // ← 遥测
this.logger?.error(...);                    // ← 日志
params.stepSpan?.error({ error: mastraError, ... });   // ← 追踪 span
throw mastraError;
```

看到 `new MastraError`，预期后面就是这三件事。

---

## 五、⭐ 原型链三连：setPrototypeOf → instanceof → 「用原始 error」

这是三个文件串起来的一条因果链，**学完它，重试机制就通了一半**。

### 第一环：`setPrototypeOf`（111）

```ts
Object.setPrototypeOf(this, new.target.prototype)
```

这是修复 **「`extends Error` 后 `instanceof` 失效」** 的经典手法（ES5 编译目标下，`Error` 的原型链会断）。没有它，下面的判定全废。

`MastraBaseError` 在 111 行、`MastraNonRetryableError` 在 151 行各做一次。**每个子类都要重复**。

### 第二环：`instanceof` 判重试（`workflows/default.ts:458`）

```ts
const isNonRetryable = e instanceof MastraNonRetryableError;   // ← 靠的就是第一环
if (isNonRetryable || i === params.retries) { ... }            // :460 跳出重试循环
```

### 第三环：「用原始 error，别用转换后的」（`evented/step-executor.ts:330-332`）

源码注释原文：

> Important: Check `error` not `errorInstance` because `getErrorFromUnknown` converts the error and loses the prototype chain.

**判重试必须用原始的 `e`，不能用 `getErrorFromUnknown(e)` 之后的值**——后者对非 Error 入参会返回全新 Error，原型链就没了。

```ts
// examples/06-error.test.ts —— 反例
const fromPlainObject = getErrorFromUnknown({ message: '永久失败', isNonRetryable: true })
expect(fromPlainObject instanceof MastraNonRetryableError).toBe(false) // ← 误判！
```

---

## 六、`MastraNonRetryableError`：重试的逃生舱（145-153）

```ts
export class MastraNonRetryableError extends Error {
  public readonly isNonRetryable = true as const;
  constructor(message: string, options?: ErrorOptions) { ... }
}
```

几个关键点：

- **不继承 `MastraBaseError`**，直接 `extends Error`——它是个**纯标记类**，没有 domain/category/id/toJSON
- 靠 `isNonRetryable = true as const`(146) 打标
- 但消费端（`default.ts:458`）**用的是 `instanceof`，不是读 `.isNonRetryable`**——所以 §五 的 `setPrototypeOf` 是 load-bearing 的

### 完整消费链

```
tool/step 抛 new MastraNonRetryableError('参数非法')
  → workflows/default.ts:458  e instanceof MastraNonRetryableError  → true
  → :460  跳出重试循环（普通错误会重试到 retries 上限）
  → :491  结果打 { nonRetryable: true }
  → workflows/types.ts:108  类型声明 nonRetryable?: boolean
```

evented 引擎镜像了一份在 `evented/step-executor.ts:328`。

### 重试循环的可运行复刻

`examples/06` 把 `default.ts:450-460` 的循环搬过来了：

```ts
// 普通错误：重试到上限（attempts === 3）
// MastraNonRetryableError：第一次就跳出（attempts === 1）
```

**实战含义**：你的工具如果遇到「重试也没用」的情况（参数非法、权限不足、资源不存在），抛 `MastraNonRetryableError` 而不是普通 `Error`，能省下无意义的重试和成本。

---

## 七、序列化：toJSON / toJSONDetails / toString（117-139）

| 方法              | 产物                                                | 注意                                  |
| ----------------- | --------------------------------------------------- | ------------------------------------- |
| `toJSON()`        | `{message, domain, category, code, details, cause}` | ⭐ **`id` 被改名成 `code`**（131 行） |
| `toJSONDetails()` | `{message, domain, category, details}`              | **没有 `code`、没有 `cause`**         |
| `toString()`      | `JSON.stringify(this.toJSON())`                     |                                       |

### ⭐ `id` → `code` 的改名

```ts
// index.ts:126-135
toJSON(): MastraErrorJSON {
  return { message, domain, category, code: this.id, details, cause: this.cause?.toJSON?.() };
  //                                              ^^^^^^^^^^ 不叫 id（在 131 行）
}
```

读日志/追踪数据时，`code` 字段就是构造时传的 `id`。

### `cause` 链与 `serializeStack`

构造函数里 `serializeStack: false` 是**硬编码的**(96-97)：

```ts
const error = originalError
  ? getErrorFromUnknown(originalError, { serializeStack: false, fallbackMessage: 'Unknown error' })
  //                                            ^^^^^^^^^^^^^^^^^^ 写死的
```

后果：**`MastraError` 的 `cause.toJSON()` 永远不带 stack**（stack 留在实例上供调试，不进序列化）。

```ts
e.toJSON().cause?.stack // undefined
e.cause?.stack // 实例上有
```

---

## 八、`getErrorFromUnknown`（`error/utils.ts:45`）

把 `catch (e: unknown)` 收敛成结构化错误。几个关键行为（`examples/06` 都有用例）：

| 入参         | 行为                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| 已是 `Error` | **就地改造**（挂上 `toJSON`）并**按 identity 返回**（不拷贝，`utils.test.ts:6` 钉死） |
| 字符串       | `new Error(s)`                                                                        |
| 普通对象     | 从 `.message` 取消息，`Object.assign` 拷可枚举属性                                    |
| 其他         | `new Error(fallbackMessage)`                                                          |

### `addErrorToJSON` 的两个细节（`utils.ts:132`）

- **挂的 `toJSON` 是不可枚举的**(152)——避免干扰对象比较（`Object.keys` 看不见它）
- **已存在 `toJSON` 就不覆盖**(142-144)——保留自定义实现，且「第一次调用的 options 赢」

---

## 九、Debug 断点清单

| 断点                               | 观察什么                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `error/index.ts:101`               | message 三级回退：`text ?? error?.message ?? 'Unknown error'`，三个入参组合各跑一次 |
| `error/index.ts:111`               | `setPrototypeOf` —— §五 原型链的起点                                                |
| `error/index.ts:126`               | `toJSON` 方法定义；`id → code` 的改名在 131 行                                      |
| `error/index.ts:96`                | `serializeStack: false` 硬编码处                                                    |
| `workflows/default.ts:458`         | `instanceof MastraNonRetryableError` 判重试（需先修构建）                           |
| `workflows/default.ts:468-478`     | `new MastraError` + `trackException` 标准三连                                       |
| `evented/step-executor.ts:330-332` | 「用原始 error」的警告注释                                                          |
| 你的工具 `catch` 块                | 该抛 `MastraError`（可重试）还是 `MastraNonRetryableError`（不重试）                |

**推荐动作**：跑 `examples/06-error.test.ts` 的两个重试循环用例，在抛错处打断点，单步走完 `default.ts:450-460` 的等价逻辑。普通错 vs `MastraNonRetryableError` 的 `attempts` 差异（3 vs 1）一眼就看懂重试机制。

---

## 十、设计取舍与坑

- **`details` 只能标量**是刻意的（保证可序列化），但逼着你写 `String(err)`。想在 details 里放结构化数据？先 `JSON.stringify`。
- **枚举非强制**：`domain: 'TOOL'` 合法。别指望类型系统帮你挡拼写错，靠的是 IDE 补全和 code review。
- **`id → code` 改名**容易坑：构造时传 `id`，读 JSON 时取 `code`。
- **`serializeStack: false` 硬编码**：你没法让 `MastraError` 的 cause 带进 JSON stack，要 stack 就读实例。
- **`MastraNonRetryableError` 不继承 `MastraBaseError`**：它没有 domain/category/toJSON。想给它加结构化信息？自己包一层 `MastraError`。
- **`getErrorFromUnknown` 按 identity 返回 Error**：意味着它会**就地修改**你传进去的 Error 实例（挂 `toJSON`）。如果你还要原样用那个 Error，注意这点。
- **`evals/base.ts:380,388` 逐字重抄了 rawConfig**——因为 scorer 基类没继承 `MastraBase`。看到这种重复说明 `MastraBase` 应该被更广泛复用。

---

## 十一、后续细化 TODO

- [ ] 全仓库 `new MastraError` 的 id 命名规律：是不是都 `${DOMAIN}_${METHOD}_${REASON}`？整理一份 id 字典
- [ ] `details.status` 的 HTTP 码用法统计：哪些错配了哪些码
- [ ] `trackException` 在可观测性里怎么落地（关联 12-observability）
- [ ] 自定义错误子类的最佳实践：什么时候该继承 `MastraError`，什么时候直接抛 `MastraNonRetryableError`
- [ ] `error/utils.ts` 的 `maxDepth` 保护（`DEFAULT_MAX_DEPTH = 5`）：超深 cause 链怎么截断
- [ ] `safeParseErrorObject`(utils.ts:7) 的三个分支：为什么 `JSON.stringify` 返回 `'{}'` 要特殊处理（Error 的属性不可枚举）
- [ ] 对照原生测试 `error/utils.test.ts`（26 个用例，最详尽）——`getErrorFromUnknown` 的边界全在这
