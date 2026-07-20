# 10.2 MastraVector 抽象契约 —— 只有 199 行

> 源码：`packages/core/src/vector/vector.ts:72`
> 示例：[`examples/02-vector-abstraction.test.ts`](./examples/02-vector-abstraction.test.ts)
> 跑：`cd docs/learning/10-storage-vector/examples && npx vitest run 02`

对比 storage（3065 行接口 + 25 个 domain），vector 的抽象**干净得多**——自研向量适配器的成本远低于自研存储适配器。

---

## 一、9 个抽象方法

```ts
abstract query(params: QueryVectorParams<Filter>): Promise<QueryResult[]>;
abstract upsert(params: UpsertVectorParams): Promise<string[]>;
abstract createIndex(params: CreateIndexParams): Promise<void>;
abstract listIndexes(): Promise<string[]>;
abstract describeIndex(params: DescribeIndexParams): Promise<IndexStats>;
abstract deleteIndex(params: DeleteIndexParams): Promise<void>;
abstract updateVector(params: UpdateVectorParams<Filter>): Promise<void>;
abstract deleteVector(params: DeleteVectorParams): Promise<void>;
abstract deleteVectors(params: DeleteVectorsParams<Filter>): Promise<void>;
```

**199 行就定义完了整个向量抽象**——比 storage 干净得多。想理解 Mastra 的抽象风格，这是最好的样本。

---

## 二、⭐ 没有官方 mock，本篇自己写一个（也是自研适配器的实战范例）

`packages/core` 没有提供内存版 `MastraVector` mock（不像 `MockMemory`/`InMemoryStore`）。`examples/02` 自己实现了一个 `InMemoryVector`（暴力余弦相似度），既验证了契约，也是「怎么写自己的向量适配器」的完整范例：

```ts
class InMemoryVector extends MastraVector {
  #indexes = new Map<string, { dimension: number; vectors: Map<string, { vector: number[]; metadata?: any }> }>()
  constructor() {
    super({ id: 'in-memory-vector' })
  }

  async createIndex(params) {
    this.#indexes.set(params.indexName, { dimension: params.dimension, vectors: new Map() })
  }
  async upsert(params) {
    /* 存进 Map */
  }
  async query(params) {
    /* 遍历算余弦相似度，排序取 topK */
  }
  // ... 其余 6 个方法
}
```

**实测验证**：`createIndex → upsert → query` 的完整生命周期，相似度排序正确（完全一致的向量得分最高，`toBeCloseTo(1, 5)`）。

---

## 三、构造函数的 id 校验

```ts
new MastraVector({ id: '' })
// throws MastraError { id: 'VECTOR_INVALID_ID', domain: MASTRA_VECTOR, category: USER }
```

⚠️ 注意这里抛的是 `MastraError`（结构化错误，见 01.2），不是普通 `Error`——和 `MastraCompositeStore` 的普通 `Error` 校验不同。

---

## 四、`indexSeparator` getter

```ts
vector.indexSeparator // 默认 '_'
```

用于某些 provider 需要把 index 名字和其他标识符拼接时的分隔符约定，子类可以覆盖。

---

## 五、Debug 断点清单

| 断点                           | 观察什么                    |
| ------------------------------ | --------------------------- |
| `vector/vector.ts:72` 构造函数 | id 校验、MastraError 的构造 |
| 你自己实现的 `query` 方法      | 相似度计算、排序逻辑        |

**推荐动作**：跑 `examples/02` 的完整生命周期用例，理解 `InMemoryVector` 的实现后，对照你要接入的真实向量数据库（Pinecone/Qdrant/Chroma）的 API，看差异在哪。

---

## 六、设计取舍与坑

- **9 个方法就是全部契约**：自研适配器工作量可控，不像 storage 那样有 25 个 domain。
- **`deleteVectors`（复数）与 `deleteVector`（单数）是两个方法**：批量删除支持按 ID 列表或按 metadata filter，两者互斥。
- **`queryVector` 是可选的**：省略时执行纯 metadata 过滤查询（并非所有后端都支持，见类型定义里的注释）。
- **`MastraEmbeddingModel` 独立于 `MastraVector`**：向量存储只管存/查向量，embedding（把文本变成向量）是另一层，在 `vector/embed.ts`，兼容 EmbeddingModel V1/V2/V3。

---

## 七、后续细化 TODO

- [ ] `VectorFilter` 过滤 DSL 的完整语法（`vector/filter/`）
- [ ] `sparseVector`（稀疏向量，混合检索）的用法
- [ ] `deleteFilter`（upsert 时先删后插的原子操作）的事务语义
- [ ] `MastraEmbeddingModel` 与 V1/V2/V3 兼容（关联 03-llm、09-memory 的语义召回）
- [ ] 对照真实 Pinecone/Qdrant 适配器的实现，看生产级考量（分批、重试、速率限制）
