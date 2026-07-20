# 10.3 ⭐ Mastra 自动补齐缺失 domain（实测验证）

> 源码：`storage/storageWithInit.ts`（`augmentWithInit`）；`mastra/index.ts` 构造函数
> 示例：[`examples/03-mastra-domain-patching.test.ts`](./examples/03-mastra-domain-patching.test.ts)
> 跑：`cd docs/learning/10-storage-vector/examples && npx vitest run 03`

11-mastra 索引提到「Mastra 会自动补齐缺失的 domain（`workflows`、`backgroundTasks`）为内存实现，因为 evented workflow 引擎强依赖它们」——**本文件用真实断言验证了这一点**，这是企业级存储配置里最容易被忽视的一个坑。

---

## 一、实测：只配置部分 domain 时会怎样

```ts
const partial = new MastraCompositeStore({
  id: 'partial',
  domains: { memory: full.stores?.memory }, // 只给 memory
})
partial.stores?.workflows // undefined —— 注册前确实没有
```

---

## 二、⭐ 注册到 Mastra 后，缺失的 domain 被自动补齐

```ts
const mastra = new Mastra({ storage: partial })
const storage = mastra.getStorage()
const workflowsStore = await storage?.getStore('workflows')

workflowsStore // 有值了！从 undefined 变成可用
```

**这是 `Mastra` 构造函数的静默行为**——它检测到 `workflows` domain 缺失，自动补上一个内存实现（因为 evented workflow 引擎强依赖这个 domain 才能运作）。

---

## 三、⚠️ 关键陷阱：补的是内存实现，不是你的自定义后端

```ts
await workflowsStore?.persistWorkflowSnapshot({ workflowName: 'wf', runId: 'r1', snapshot: {...} });
// 能正常写入、读取 —— 看起来一切正常

workflowsStore !== full.stores?.workflows  // true！这不是你以为的持久化后端
```

**这份数据完全没有经过你原本配置的存储后端（PG/Redis/...），它存在 Mastra 自动创建的一个内存实例里。** 重启进程，这部分数据就丢了——即使你其他 domain（比如 memory）都配置了持久化后端。

---

## 四、对照：完整配置时不会被覆盖

```ts
const full = new InMemoryStore() // 全部 25 个 domain 都有
const mastra = new Mastra({ storage: full })
const memoryStore = await mastra.getStorage()?.getStore('memory')

memoryStore === full.stores?.memory // true —— 就是你传入的那个实例，没有被替换
```

**只有真正缺失的 domain 才会被补，已配置的 domain 保持原样。**

---

## 五、企业级检查清单

自己实现存储适配器或组合多个 store 时，上线前务必确认：

```ts
const mastra = new Mastra({ storage: yourCustomStorage })
// 逐个检查关键 domain 是否真的来自你配置的后端
console.log((await mastra.getStorage()?.getStore('workflows')) === yourCustomStorage.stores?.workflows)
console.log((await mastra.getStorage()?.getStore('memory')) === yourCustomStorage.stores?.memory)
console.log((await mastra.getStorage()?.getStore('observability')) === yourCustomStorage.stores?.observability)
```

**如果任何一个返回 `false`，说明那个 domain 被静默补成了内存实现**——数据不会持久化到你期望的地方。

---

## 六、Debug 断点清单

| 断点                                           | 观察什么                                |
| ---------------------------------------------- | --------------------------------------- |
| `mastra/index.ts` 构造函数里补 domain 的逻辑   | 具体补了哪些 domain、用什么条件判断缺失 |
| `storage/storageWithInit.ts` `augmentWithInit` | 懒初始化包装                            |

**推荐动作**：跑 `examples/03` 的完整对比（部分配置 vs 完整配置），在 Mastra 构造函数里打断点，亲眼看到自动补齐发生的那一刻。

---

## 七、设计取舍与坑

- **⭐ 这是全模块最容易被忽视的坑**：功能一切正常（能存能取），唯独数据没有落在预期的地方——这种「静默正确但实际错误」的行为最难被发现。
- **只有特定 domain 会被自动补**（`workflows`、`backgroundTasks`），不是所有缺失 domain 都会被兜底——如果你缺了 `memory` domain，agent 的记忆功能可能直接不可用，而不是静默换成内存版。
- **上线前的验证不能只测「功能正常」，要验证「数据流向正确」**：本篇的检查清单应该作为生产部署前的标准动作。

---

## 八、后续细化 TODO

- [ ] Mastra 构造函数里补 domain 的完整判断逻辑与列表（除了 workflows/backgroundTasks，还有哪些）
- [ ] 是否有办法在启动时输出警告，明确告知哪些 domain 被自动补了
- [ ] `augmentWithInit` 的懒初始化机制与补齐时机的先后关系
- [ ] 这个行为在 evented 引擎和 direct 引擎下是否有差异
