# 10. Storage & Vector — 可插拔持久化

## 模块职责

**把框架的一切状态落库，并抽象向量检索。**

企业级第一优先级：**默认配置是内存存储，生产必须换掉。** 不配 `storage` 时 Mastra 会注入 `InMemoryStore` 并打 warning——重启即丢。

## 学习路径（3 篇深度文档）

| 主题            | 文档                                                           | 一句话                                      |
| --------------- | -------------------------------------------------------------- | ------------------------------------------- |
| 组合存储        | [01-composite-store.md](./01-composite-store.md)               | MastraCompositeStore 混搭不同后端，实测验证 |
| Vector 抽象     | [02-vector-abstraction.md](./02-vector-abstraction.md)         | 只有 9 个方法，自己写一个内存实现作范例     |
| ⭐ 自动补齐陷阱 | [03-mastra-domain-patching.md](./03-mastra-domain-patching.md) | **静默正确但实际错误：数据流向的陷阱**      |

### ⭐ 本模块最重要的一课：静默补齐的 domain 不是你的后端

```ts
const partial = new MastraCompositeStore({ domains: { memory: yourMemoryStore } });
const mastra = new Mastra({ storage: partial });

await mastra.getStorage()?.getStore('workflows')
  .persistWorkflowSnapshot({...});  // 能正常写入、读取，一切正常

// 但这份数据完全没经过你配置的后端——它存在 Mastra 自动补的内存实现里
```

**功能正常 ≠ 数据流向正确。** 详见 [03](./03-mastra-domain-patching.md) 的企业级检查清单。

## 可跑示例

`examples/` 下 **3 个测试文件、17 个用例**，零构建，大部分 <1s（无 agent 开销）：

```bash
cd docs/learning/10-storage-vector/examples
npx vitest run                          # 全跑
npx vitest run 03-mastra-domain-patching # 只跑招牌课
```

## 示例里挖到的真实细节（已验证）

- **⭐ 组合模式确实能混搭不同 store 的 domain**：实测验证了「memory 用 A、workflows 用 B」的场景（[01](./01-composite-store.md)）
- **⚠️ `MastraCompositeStore` 构造函数校验只在提供组合配置时才触发**：完全不传时 `stores` 是 `undefined`，不报错（[01](./01-composite-store.md)）
- **`MastraVector` 只有 9 个抽象方法，199 行**：自己实现一个内存版只需要几十行（[02](./02-vector-abstraction.md)）
- **⭐⭐⭐ Mastra 会静默补齐缺失的 domain**：实测确认——只配 memory 的 store，注册后 workflows 变得"可用"，但那是自动补的内存实现，不是你的后端（[03](./03-mastra-domain-patching.md)）

## 关键源码文件

| 路径               | 行数 | 作用                              | 文档  |
| ------------------ | ---- | --------------------------------- | ----- |
| `storage/base.ts`  | 603  | `MastraCompositeStore`(287)       | 01    |
| `storage/mock.ts`  | —    | `InMemoryStore`，25 domain 全实现 | 01/03 |
| `storage/types.ts` | 3065 | 25 个 domain 的完整类型契约       | —     |
| `vector/vector.ts` | 199  | `MastraVector`(72)                | 02    |
| `mastra/index.ts`  | 5725 | 自动补齐 domain 的逻辑（见 11）   | 03    |

## 校正记录

相对初版（导航索引）的补充：

- ✅ ⭐ **自动补齐是静默正确但实际错误的陷阱**：实测验证并给出企业级检查清单（初版只提了概念，本轮才真正证实并给出可操作的验证方法）
- ✅ 组合模式的混搭行为经实测确认（初版只描述设计意图）
- ✅ `MastraCompositeStore` 构造函数校验的真实触发条件（初版没有覆盖这个边界情况）
- ✅ 自己实现 `MastraVector` 的完整范例代码（初版没有示例）
