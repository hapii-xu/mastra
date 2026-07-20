import { describe, expect, it, vi } from 'vitest'
import { Mastra } from '../../../../packages/core/src/mastra'
import { InMemoryStore } from '../../../../packages/core/src/storage/mock'

/**
 * 11.1 · ⭐ 默认值注入 —— 「解析默认值 → 主动下推」的 DI 模式
 *
 * 源码：mastra/index.ts 构造函数（:1220 起）
 *
 * Mastra 的 DI 不是「注册-查找」式容器，是构造时主动解析默认值、
 * 下推给子对象。不配 storage、logger、cache、pubsub 时，全部有静默的默认行为。
 */

describe('⭐ 不配 storage → InMemoryStore + 完整 warning 文本', () => {
  it('实测：storage 默认是 InMemoryStore', async () => {
    const mastra = new Mastra({})
    const storage = mastra.getStorage()
    expect(storage).toBeInstanceOf(InMemoryStore)
  })

  it('实测：警告文本的完整内容（用自定义 logger 捕获）', async () => {
    const warnMock = vi.fn()
    const customLogger: any = {
      info: vi.fn(),
      warn: warnMock,
      error: vi.fn(),
      debug: vi.fn(),
      trackException: vi.fn(),
      child: () => customLogger,
    }

    new Mastra({ logger: customLogger })

    expect(warnMock).toHaveBeenCalledTimes(1)
    const [message] = warnMock.mock.calls[0]
    expect(message).toContain('No `storage` configured on Mastra')
    expect(message).toContain('not durable')
    expect(message).toContain('not safe for production')
    // 警告文本里直接给出了推荐方案
    expect(message).toContain('@mastra/libsql')
  })

  it('配置了 storage 就不会有这条警告', async () => {
    const warnMock = vi.fn()
    const customLogger: any = {
      info: vi.fn(),
      warn: warnMock,
      error: vi.fn(),
      debug: vi.fn(),
      trackException: vi.fn(),
      child: () => customLogger,
    }
    new Mastra({ logger: customLogger, storage: new InMemoryStore() as any })
    expect(warnMock).not.toHaveBeenCalled()
  })
})

describe('logger 的三种配置分支', () => {
  it('logger: false → 完全静默（noopLogger）', () => {
    const mastra = new Mastra({ logger: false })
    // noop logger 不会抛错，调用是安全的
    expect(() => mastra.getLogger().info('test')).not.toThrow()
  })

  it('自定义 logger 会被原样使用', () => {
    const customLogger: any = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trackException: vi.fn(),
      child: () => customLogger,
    }
    const mastra = new Mastra({ logger: customLogger })
    expect(mastra.getLogger()).toBe(customLogger)
  })

  it('不配置 logger 时使用默认 ConsoleLogger', () => {
    const mastra = new Mastra({})
    expect(mastra.getLogger()).toBeDefined()
    expect(mastra.getLogger().constructor.name).toBe('ConsoleLogger')
  })
})
