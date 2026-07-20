# 10.1 MastraCompositeStore —— 组合式而非单体

> 源码：`packages/core/src/storage/base.ts:287`（`MastraCompositeStore`）；`storage/mock.ts:45`（`InMemoryStore`，25 个 domain 全内存实现）
> 示例：[`examples/01-composite-store.test.ts`](./examples/01-composite-store.test.ts)
> 跑：`cd docs/learning/10-storage-vector/examples && npx vitest run 01`

**⭐ 关键设计：存储不是一个大接口，而是按 domain 组合的。** 企业级价值：消息用 PG、快照用 Redis、追踪用 ClickHouse，混搭。

---

## 一、`getStore(domain)`：按 domain 取具体实现

```ts
const storage = new InMemoryStore()
const workflows = await storage.getStore('workflows')
await workflows?.persistWorkflowSnapshot({ workflowName, runId, snapshot })
const loaded = await workflows?.loadWorkflowSnapshot({ workflowName, runId })
```

`InMemoryStore` 内部所有 25 个 domain **共享同一个 `#db: InMemoryDB` 实例**（构造函数里可见），domain 之间不是完全隔离的存储，而是对同一份底层数据的不同视图。

---

## 二、⭐ 组合模式：混搭不同 store 的 domain

```ts
const storeA = new InMemoryStore({ id: 'a' })
const storeB = new InMemoryStore({ id: 'b' })

const composite = new MastraCompositeStore({
  id: 'composed',
  default: storeA,
  domains: { memory: storeB.stores?.memory }, // 只覆盖 memory
})

composite.stores?.memory === storeB.stores?.memory // true —— override 生效
composite.stores?.workflows === storeA.stores?.workflows // true —— 其余用 default
```

**实测验证**：`examples/01` 确认了这种混搭确实按预期工作——`memory` domain 精确指向 `storeB`，其余 domain 回退到 `storeA`。这是「消息用 PG、快照用 Redis」这类企业级架构的直接实现基础。

### 优先级：`domains > editor > default`

`domains` override 为 `false` 时该 domain 被**禁用**（不回退到 default）：

```ts
new MastraCompositeStore({ id: 'x', default: storeA, domains: { blobs: false } }).stores?.blobs // undefined —— 显式禁用，不是「没配置」
```

---

## 三、⚠️ 构造函数校验的真实触发条件

```ts
new MastraCompositeStore({ id: 'bare' }).stores // 不传 default/editor/domains // undefined，不报错！
```

**这条校验只在「提供了组合配置」时才触发**（`config.default || config.editor || config.domains` 任一为真）。完全不传这三者时根本不会走进组合分支，`this.stores` 就是 `undefined`——不报错，但也没有任何 domain 可用。

**真正会抛错的场景**：提供了 `domains` 但里面全是 `undefined`（没有实际来源）：

```ts
new MastraCompositeStore({ id: 'empty', domains: { memory: undefined } })
// throws: "requires at least one storage source"
```

---

## 四、构造函数的 id 校验

```ts
new InMemoryStore({ id: '' }) // throws: "id must be provided and cannot be empty"
```

---

## 五、Debug 断点清单

| 断点                                          | 观察什么                                   |
| --------------------------------------------- | ------------------------------------------ |
| `storage/base.ts:316` 构造函数                | `resolve()` 函数的优先级判定               |
| `storage/mock.ts:45` `InMemoryStore` 构造函数 | 25 个 domain 如何共享 `#db`                |
| `MastraCompositeStore` 校验逻辑               | 「提供组合配置」和「完全不提供」的分支差异 |

**推荐动作**：跑 `examples/01`，在构造函数打断点，起一个混合了两个 store 的 composite，观察 `this.stores` 最终指向了谁。

---

## 六、设计取舍与坑

- **组合式存储是优势也是复杂度**：能混搭后端，但也意味着「数据在哪」这个问题的答案可能是好几个地方。
- **不提供组合配置不报错，但 `stores` 是 `undefined`**：容易被误认为是「用了默认行为」，实际是「什么都没配」。
- **`false` 显式禁用 vs `undefined` 未配置是两回事**：`false` 明确表示「不要这个 domain」，`undefined` 表示「用默认值」——别搞混。

---

## 七、后续细化 TODO

- [ ] `storage/types.ts`（3065 行）里 25 个 domain 的完整类型契约
- [ ] `parentDefault`/`parentEditor` 的 init() 委托机制（issue #16782 相关的 SQLITE_BUSY 修复）
- [ ] `retention` 配置与 `prune()` 方法的数据治理实践
- [ ] `disableInit` 的使用场景
