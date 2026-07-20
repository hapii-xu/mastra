import { describe, expect, it } from 'vitest'
import { MastraVector } from '../../../../packages/core/src/vector/vector'
import type {
  CreateIndexParams,
  DeleteIndexParams,
  DeleteVectorParams,
  DeleteVectorsParams,
  DescribeIndexParams,
  IndexStats,
  QueryResult,
  QueryVectorParams,
  UpdateVectorParams,
  UpsertVectorParams,
} from '../../../../packages/core/src/vector/types'

/**
 * 10.2 · MastraVector 抽象契约 —— 只有 199 行，9 个方法
 *
 * 源码：packages/core/src/vector/vector.ts:72
 *
 * 对比 storage（3065 行接口 + 25 个 domain），vector 的抽象干净得多——
 * 自研向量适配器的成本远低于自研存储适配器。
 *
 * 没有官方的内存 mock，本文件自己实现一个最小可用版本，
 * 既验证契约、也是「怎么写自己的向量适配器」的实战范例。
 */

/** 最小的内存向量实现：暴力余弦相似度，仅用于学习契约，不是生产实现 */
class InMemoryVector extends MastraVector {
  #indexes = new Map<string, { dimension: number; vectors: Map<string, { vector: number[]; metadata?: any }> }>()

  constructor() {
    super({ id: 'in-memory-vector' })
  }

  async createIndex(params: CreateIndexParams): Promise<void> {
    this.#indexes.set(params.indexName, { dimension: params.dimension, vectors: new Map() })
  }

  async listIndexes(): Promise<string[]> {
    return [...this.#indexes.keys()]
  }

  async describeIndex(params: DescribeIndexParams): Promise<IndexStats> {
    const idx = this.#indexes.get(params.indexName)
    if (!idx) throw new Error(`Index ${params.indexName} not found`)
    return { dimension: idx.dimension, count: idx.vectors.size }
  }

  async deleteIndex(params: DeleteIndexParams): Promise<void> {
    this.#indexes.delete(params.indexName)
  }

  async upsert(params: UpsertVectorParams): Promise<string[]> {
    const idx = this.#indexes.get(params.indexName)
    if (!idx) throw new Error(`Index ${params.indexName} not found`)
    const ids = params.ids ?? params.vectors.map((_, i) => `vec-${i}`)
    params.vectors.forEach((vector, i) => {
      idx.vectors.set(ids[i]!, { vector, metadata: params.metadata?.[i] })
    })
    return ids
  }

  async updateVector(params: UpdateVectorParams): Promise<void> {
    const idx = this.#indexes.get(params.indexName)
    const existing = idx?.vectors.get(params.id)
    if (!existing) throw new Error('vector not found')
    if (params.update.vector) existing.vector = params.update.vector
    if (params.update.metadata) existing.metadata = params.update.metadata
  }

  async deleteVector(params: DeleteVectorParams): Promise<void> {
    this.#indexes.get(params.indexName)?.vectors.delete(params.id)
  }

  async deleteVectors(params: DeleteVectorsParams): Promise<void> {
    const idx = this.#indexes.get(params.indexName)
    if (!idx) return
    if (params.ids) {
      params.ids.forEach(id => idx.vectors.delete(id))
    }
  }

  async query(params: QueryVectorParams): Promise<QueryResult[]> {
    const idx = this.#indexes.get(params.indexName)
    if (!idx || !params.queryVector) return []
    const results: QueryResult[] = []
    for (const [id, { vector, metadata }] of idx.vectors) {
      const score = cosineSimilarity(params.queryVector, vector)
      results.push({ id, score, metadata })
    }
    return results.sort((a, b) => b.score - a.score).slice(0, params.topK ?? 10)
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i]!, 0)
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0))
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0))
  return dot / (magA * magB)
}

describe('构造函数：id 校验', () => {
  it('空 id 会抛 MastraError', () => {
    class BadVector extends MastraVector {
      async query() {
        return []
      }
      async upsert() {
        return []
      }
      async createIndex() {}
      async listIndexes() {
        return []
      }
      async describeIndex() {
        return { dimension: 0, count: 0 }
      }
      async deleteIndex() {}
      async updateVector() {}
      async deleteVector() {}
      async deleteVectors() {}
      constructor() {
        super({ id: '' })
      }
    }
    expect(() => new BadVector()).toThrow(/id must be provided/)
  })
})

describe('9 个抽象方法的完整生命周期', () => {
  it('createIndex → upsert → query → 相似度排序正确', async () => {
    const vector = new InMemoryVector()
    await vector.createIndex({ indexName: 'docs', dimension: 3 })

    await vector.upsert({
      indexName: 'docs',
      vectors: [
        [1, 0, 0],
        [0, 1, 0],
        [0.9, 0.1, 0], // 接近第一个向量
      ],
      metadata: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
      ids: ['v1', 'v2', 'v3'],
    })

    const results = await vector.query({ indexName: 'docs', queryVector: [1, 0, 0], topK: 2 })

    // v1 应该是最相似的（完全一致），v3 次之
    expect(results[0]?.id).toBe('v1')
    expect(results[0]?.score).toBeCloseTo(1, 5)
    expect(results[1]?.id).toBe('v3')
  })

  it('describeIndex 返回正确的 count', async () => {
    const vector = new InMemoryVector()
    await vector.createIndex({ indexName: 'idx', dimension: 2 })
    await vector.upsert({
      indexName: 'idx',
      vectors: [
        [1, 0],
        [0, 1],
      ],
    })

    const stats = await vector.describeIndex({ indexName: 'idx' })
    expect(stats).toEqual({ dimension: 2, count: 2 })
  })

  it('deleteVector 移除单个向量', async () => {
    const vector = new InMemoryVector()
    await vector.createIndex({ indexName: 'idx', dimension: 2 })
    await vector.upsert({ indexName: 'idx', vectors: [[1, 0]], ids: ['v1'] })
    await vector.deleteVector({ indexName: 'idx', id: 'v1' })

    const stats = await vector.describeIndex({ indexName: 'idx' })
    expect(stats.count).toBe(0)
  })

  it('deleteIndex 移除整个索引', async () => {
    const vector = new InMemoryVector()
    await vector.createIndex({ indexName: 'idx', dimension: 2 })
    await vector.deleteIndex({ indexName: 'idx' })

    expect(await vector.listIndexes()).not.toContain('idx')
  })

  it('updateVector 更新已有向量的 metadata', async () => {
    const vector = new InMemoryVector()
    await vector.createIndex({ indexName: 'idx', dimension: 2 })
    await vector.upsert({ indexName: 'idx', vectors: [[1, 0]], ids: ['v1'], metadata: [{ tag: 'old' }] })
    await vector.updateVector({ indexName: 'idx', id: 'v1', update: { metadata: { tag: 'new' } } })

    const results = await vector.query({ indexName: 'idx', queryVector: [1, 0], topK: 1 })
    expect(results[0]?.metadata).toEqual({ tag: 'new' })
  })
})

describe('indexSeparator getter：默认值', () => {
  it('默认分隔符是下划线', async () => {
    const vector = new InMemoryVector()
    expect(vector.indexSeparator).toBe('_')
  })
})
