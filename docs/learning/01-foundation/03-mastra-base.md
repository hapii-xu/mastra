# 01.3 MastraBase — 公共基类

> 源码：`packages/_internal-core/src/base/MastraBase.ts`（51 行）
> 示例：[`examples/07-mastra-base.test.ts`](./examples/07-mastra-base.test.ts)
> 跑：`cd docs/learning/01-foundation/examples && npx vitest run 07`

51 行，全框架约 30 个类继承它。它只干三件事：**挂 logger、存 rawConfig、标 component**。小到可以一次读完，但藏着两个值得学的设计点。

---

## 一、它是什么

所有「框架原语」的公共基类：

```
Agent (agent.ts:457)              MastraMemory (memory.ts:114)
Workflow (workflow.ts:1544)       MastraVector (vector.ts:72)
ExecutionEngine (execution-engine.ts:59)   MastraCompositeStore (storage/base.ts:287)
MastraLLMVNext (model.loop.ts:19) MastraModelOutput (stream/base/output.ts:146)
Scheduler, StepExecutor, StorageDomain, BlobStore, MastraBundler, MastraAuthProvider, ...
```

约 30 个子类。继承它，就自动获得：一个已初始化的 `logger`、一个可选的 `rawConfig`、一个日志归类用的 `component`。

---

## 二、完整源码（51 行，可以整个读完）

```ts
export class MastraBase {
  component: RegisteredLogger = RegisteredLogger.LLM;   // 5 · public，默认 LLM
  protected logger: IMastraLogger;                       // 6
  name?: string;                                         // 7
  #rawConfig?: Record<string, unknown>;                  // 8 · 真 ES 私有

  constructor({ component, name, rawConfig }: { ... }) { // 10-23
    this.component = component || RegisteredLogger.LLM;  // 19 · ⚠️ 默认 LLM
    this.name = name;
    this.#rawConfig = rawConfig;
    this.logger = new ConsoleLogger({ name: `${this.component} - ${this.name}` });  // 22
  }

  toRawConfig(): Record<string, unknown> | undefined { return this.#rawConfig; }    // 29
  __setRawConfig(rawConfig) { this.#rawConfig = rawConfig; }                        // 37 · @internal
  __setLogger(logger: IMastraLogger) { ... }                                        // 45
}
```

**注意：没有 `getLogger()`**——`logger` 是 `protected`，子类直接读 `this.logger`。（`Mastra` 类自己有个 `getLogger()`，但那不在 `MastraBase` 上。）

---

## 三、三个职责

### 1. logger：构造时就建好，永不空

```ts
this.logger = new ConsoleLogger({ name: `${this.component} - ${this.name}` }) // 22
```

`logger` **不是懒加载**，构造完就能用，永远是 `IMastraLogger`，子类无需判空。

后续通过 `__setLogger`(45) 替换成 Mastra 实例的统一 logger（见 §四）。

### 2. rawConfig：区分「代码 new 的」vs「存储反序列化的」

```ts
toRawConfig(): Record<string, unknown> | undefined   // 29
```

- **代码里 new**：`rawConfig` 没传 → `toRawConfig()` 返回 `undefined`
- **从存储配置构造**：传了 `rawConfig` → 原样返回

**这是 Studio / Agent Builder 能把 agent 存进数据库再还原的基础。** 没有它，框架分不清「这个 agent 是用户在代码里定义的，还是从 DB 配置还原的」。

#### ⭐ `__setRawConfig` 全仓库只有 1 个生产调用点

`packages/editor/src/namespaces/agent.ts:676`：

```ts
const existing = fork.toRawConfig() ?? {}
fork.__setRawConfig({ ...existing, resolvedVersionId: storedConfig.resolvedVersionId })
```

**一个 read-merge-writeback 就是这个方法存在的全部理由。** 看到 `__setRawConfig`，就是在 editor 里合并版本信息。

### 3. component：日志归类

```ts
component: RegisteredLogger = RegisteredLogger.LLM // 5
```

决定日志归到哪一类。**⚠️ 忘了传就静默变成 `LLM`**(19)，日志会归错类，且没有任何提示：

```ts
// examples/07-mastra-base.test.ts
const p = new MyPrimitive({ name: 'forgot-component' })
expect(p.component).toBe('LLM') // 不是 undefined，也不报错
```

---

## 四、⭐ `__setLogger` 的鸭子类型双分支（45-50）

```ts
__setLogger(logger: IMastraLogger) {                          // 45
  this.logger =
    'child' in logger && typeof (logger as any).child === 'function'   // 47 · 判别
      ? (logger as any).child({ component: this.component })   // 分支一：有 child → scope
      : logger;                                                 // 分支二：没有 → 原样存
}
```

**判别是鸭子类型**（有没有 `.child` 方法），**不是 `instanceof`**。

| logger 形状      | 行为                                          |
| ---------------- | --------------------------------------------- |
| 有 `.child` 方法 | 调 `.child({ component })` 做作用域，存返回值 |
| 没有 `.child`    | 原样存下                                      |

**⚠️ 鸭子类型的后果**：任何带 `child` 方法的对象都会被当成 logger：

```ts
const notReallyALogger = { child: () => ({}) }
p.__setLogger(notReallyALogger as never) // 通过，没有 instanceof 检查
```

### 手工级联下推

`__setLogger` 全仓库有 **58 处调用**。Mastra 在构造时给每个子对象调一次，子对象再给自己的子对象调——**全靠手工级联**：

```ts
// agent.ts:3078-3079
this.__setLogger(p.logger)
this.#agentChannels?.__setLogger(p.logger) // 再往下推
```

---

## 五、⭐ 两种私有写法的对照

同一个 foundation 包里，两种「私有」语义，后果截然不同：

|                | `RequestContext.registry`       | `MastraBase.#rawConfig` |
| -------------- | ------------------------------- | ----------------------- |
| 写法           | `private registry = ...`        | `#rawConfig`            |
| 本质           | **TS-only private**             | **真 ES 私有字段**      |
| 运行时可枚举？ | ✅ 可以（`Object.keys` 看得见） | ❌ 不可以               |
| 后果           | 需要 `serializeForSpan` 防泄漏  | 天生安全                |

```ts
// examples/07-mastra-base.test.ts
const p = new MyPrimitive({ name: 'x', rawConfig: { secret: 'hidden' } })
expect(Object.keys(p)).not.toContain('rawConfig') // # 私有看不见
expect(JSON.stringify(p)).not.toContain('hidden') // 也不会被序列化
```

**对照 `RequestContext`**：它的 `private registry` 运行时可枚举，所以才需要 `serializeForSpan` 把 token 打码（见 01.1 §五）。**`#` 私有天生就没有这个问题。**

这是个很好的 TS 教学点：**`private` 关键字不提供运行时隔离，`#` 才提供。**

---

## 六、⭐ 两种枚举写法的对照（同一个包里）

`_internal-core` 里同时用了两种「枚举」写法：

|      | `ErrorDomain`                                    | `RegisteredLogger`                |
| ---- | ------------------------------------------------ | --------------------------------- |
| 位置 | `error/index.ts:7`                               | `logger/index.ts:3`               |
| 写法 | TS 原生 `enum`                                   | **const object + companion type** |
| 例子 | `export enum ErrorDomain { TOOL = 'TOOL', ... }` | 见下                              |

```ts
// logger/index.ts:3
export const RegisteredLogger = {
  AGENT: 'AGENT',
  OBSERVABILITY: 'OBSERVABILITY',
  AUTH: 'AUTH',
  BROWSER: 'BROWSER',
  NETWORK: 'NETWORK',
  WORKFLOW: 'WORKFLOW',
  LLM: 'LLM',
  TTS: 'TTS',
  VOICE: 'VOICE',
  VECTOR: 'VECTOR',
  BUNDLER: 'BUNDLER',
  DEPLOYER: 'DEPLOYER',
  MEMORY: 'MEMORY',
  STORAGE: 'STORAGE',
  EMBEDDINGS: 'EMBEDDINGS',
  MCP_SERVER: 'MCP_SERVER',
  SERVER_CACHE: 'SERVER_CACHE',
  SERVER: 'SERVER',
  WORKSPACE: 'WORKSPACE',
  CHANNEL: 'CHANNEL',
} // 20 个，已 examples/07 用例核实

// logger/index.ts:26
export type RegisteredLogger = (typeof RegisteredLogger)[keyof typeof RegisteredLogger]
```

### 为什么有两种

const object 模式的好处：

- **编译产物更小**（TS enum 会生成额外代码，数字 enum 还有反向映射）
- **值就是字面量联合**，没有 enum 的运行时对象
- **tree-shaking 友好**

`RegisteredLogger` 选 const object，`ErrorDomain` 选 enum——**同一个包、同一个团队、两种选择**。这本身是个值得注意的不一致，也是对比两种写法的好素材。

> 另：`LogLevel`(logger/index.ts:28-36) 也是 const object 模式，且有个**键值不一致**：`NONE: 'silent'`（键是 NONE，值是 silent）。读源码时注意别假设键值相同。

---

## 七、Debug 断点清单

| 断点                             | 观察什么                                                           |
| -------------------------------- | ------------------------------------------------------------------ |
| `MastraBase.ts:19`               | `component \|\| RegisteredLogger.LLM`——忘了传 component 的静默兜底 |
| `MastraBase.ts:22`               | logger 在构造时就 new 出来                                         |
| `MastraBase.ts:46`               | `__setLogger` 走了哪个分支（有/没有 `.child`）                     |
| `MastraBase.ts:8`                | `#rawConfig` 真 ES 私有：调试器里能看，但 `Object.keys` 看不见     |
| `agent.ts:3078`                  | logger 的手工级联下推（需先修构建）                                |
| `editor/namespaces/agent.ts:676` | `__setRawConfig` 的唯一生产用法                                    |

**推荐动作**：跑 `examples/07-mastra-base.test.ts`，重点看两个对照——`#rawConfig` vs `private registry` 的运行时可见性、`__setLogger` 的鸭子类型双分支。

---

## 八、设计取舍与坑

- **`component` 默认 `LLM` 是陷阱**：忘了传不报错，日志静默归错类。子类构造函数一定要显式传。
- **`logger` 是 `protected` 不是 `public`**：外部拿不到。要暴露得自己写 getter（`Mastra` 类就这么做）。
- **没有 `getLogger()`**：子类直接 `this.logger`。如果你要从外部读，说明 API 设计可能有问题。
- **`__setLogger` 鸭子类型**：不校验 logger 真实身份。好处是能接任何符合形状的 logger（pino、winston、自定义），坏处是 type-narrowing 不严。
- **rawConfig 重复实现**：`evals/base.ts:380,388` 逐字重抄了 `toRawConfig`/`__setRawConfig`，因为 scorer 基类没继承 `MastraBase`。说明这个基类的复用可以更广。
- **两种枚举写法并存**：`ErrorDomain`（enum）vs `RegisteredLogger`（const object），见 §六。
- **两种私有写法并存**：`private`（TS-only）vs `#`（ES 私有），见 §五。读源码看到 `private` 要警觉「运行时可枚举吗」。

---

## 九、后续细化 TODO

- [ ] 约 30 个子类清单：每个的 `component` 传的什么，有没有人忘了传（潜在日志归类 bug）
- [ ] `__setLogger` 的 58 处调用：手工级联有没有漏掉的（某个子对象拿不到统一 logger）
- [ ] `ConsoleLogger` 的实现：`child()` 方法做了什么（`logger/index.ts`）
- [ ] `IMastraLogger` 接口全貌：哪些方法、`trackException` 怎么落地（关联 12-observability）
- [ ] const object as enum 模式全仓库还有哪些用例（对比 TS enum 的取舍）
- [ ] `rawConfig` 在 agent 版本化里的完整作用：`resolvedVersionId` / `activeVersionId` / drift 检测（关联 06-agent、11-mastra）
- [ ] `evals/base.ts` 为什么不继承 `MastraBase`——历史原因还是有意隔离
