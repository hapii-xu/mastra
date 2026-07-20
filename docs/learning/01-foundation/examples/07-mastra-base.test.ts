import { describe, expect, it, vi } from 'vitest'
import { MastraBase } from '../../../../packages/_internal-core/src/base'
import { RegisteredLogger } from '../../../../packages/_internal-core/src/logger'

/**
 * 07 · MastraBase 公共基类
 *
 * 源码：packages/_internal-core/src/base/MastraBase.ts（51 行）
 *
 * 全框架约 30 个类继承它：Agent(agent.ts:457)、Workflow(workflow.ts:1544)、
 * MastraMemory(memory.ts:114)、MastraVector(vector.ts:72)、MastraCompositeStore(storage/base.ts:287)…
 * 它只干三件事：挂 logger、存 rawConfig、标 component。
 */

describe('构造函数与 component（MastraBase.ts:10-23）', () => {
  class MyPrimitive extends MastraBase {}

  it('name 与 component 被记录在实例上', () => {
    const p = new MyPrimitive({ component: RegisteredLogger.AGENT, name: 'my-agent' })

    expect(p.name).toBe('my-agent')
    expect(p.component).toBe('AGENT')
  })

  /**
   * ⚠️ 陷阱：component 忘了传就静默变成 LLM（MastraBase.ts:19 的 `component || RegisteredLogger.LLM`）
   * 后果是日志归错类，而且不会有任何提示。
   * 断点：MastraBase.ts:19。观察 component 为 undefined 时的兜底。
   */
  it('⚠️ 不传 component → 静默默认成 LLM（日志会归错类）', () => {
    const p = new MyPrimitive({ name: 'forgot-component' })

    expect(p.component).toBe('LLM') // 不是 undefined，也不报错
  })

  // 断点：MastraBase.ts:22。观察 logger 是构造时就 new 出来的，不是懒加载。
  it('logger 在构造时就创建好，命名格式是 `${component} - ${name}`', () => {
    const p = new MyPrimitive({ component: RegisteredLogger.WORKFLOW, name: 'my-wf' })

    // logger 是 protected，从子类内部读
    const logger = (p as unknown as { logger: unknown }).logger
    expect(logger).toBeDefined() // 永远非空，无需判空
  })
})

describe('rawConfig：区分「代码 new 的」vs「从存储反序列化的」（MastraBase.ts:29-39）', () => {
  class MyPrimitive extends MastraBase {}

  // 这是 Studio / Agent Builder 能把 agent 存进数据库再还原的基础
  it('代码里 new 出来的 → toRawConfig() 返回 undefined', () => {
    const p = new MyPrimitive({ name: 'from-code' })

    expect(p.toRawConfig()).toBeUndefined()
  })

  it('从存储配置构造的 → toRawConfig() 返回原始配置', () => {
    const rawConfig = { id: 'agent-1', instructions: '...', resolvedVersionId: 'v3' }
    const p = new MyPrimitive({ name: 'from-storage', rawConfig })

    expect(p.toRawConfig()).toEqual(rawConfig)
  })

  /**
   * __setRawConfig 全仓库只有 1 个生产调用点：
   *   packages/editor/src/namespaces/agent.ts:676
   *     const existing = fork.toRawConfig() ?? {};
   *     fork.__setRawConfig({ ...existing, resolvedVersionId: storedConfig.resolvedVersionId });
   * 这一个 read-merge-writeback 就是该方法存在的全部理由。
   */
  it('复刻 editor 的 read-merge-writeback（唯一的生产用法）', () => {
    const p = new MyPrimitive({ name: 'x', rawConfig: { id: 'agent-1', status: 'draft' } })

    const existing = p.toRawConfig() ?? {}
    p.__setRawConfig({ ...existing, resolvedVersionId: 'v9' })

    expect(p.toRawConfig()).toEqual({ id: 'agent-1', status: 'draft', resolvedVersionId: 'v9' })
  })

  // #rawConfig 是真 ES 私有字段（MastraBase.ts:8），与 RequestContext 的 TS-only private 形成对照
  it('⭐ #rawConfig 是真 ES 私有：外部完全拿不到（对比 RequestContext 的 private registry）', () => {
    const p = new MyPrimitive({ name: 'x', rawConfig: { secret: 'hidden' } })

    // RequestContext 的 private registry 运行时可枚举（所以才需要 serializeForSpan）；
    // 而 # 私有字段连 Object.keys 都看不见 —— 两种私有，两种后果。
    expect(Object.keys(p)).not.toContain('rawConfig')
    expect(JSON.stringify(p)).not.toContain('hidden')
  })
})

describe('⭐ __setLogger：鸭子类型的两个分支（MastraBase.ts:45-50）', () => {
  class MyPrimitive extends MastraBase {
    getLogger() {
      return (this as unknown as { logger: unknown }).logger
    }
  }

  /**
   * 源码：
   *   this.logger = 'child' in logger && typeof (logger as any).child === 'function'
   *     ? (logger as any).child({ component: this.component })
   *     : logger;
   *
   * 注意是鸭子类型判别（有没有 .child 方法），不是 instanceof。
   * 断点：MastraBase.ts:47。观察走了哪个分支。
   */
  it('分支一：logger 有 child 方法 → 调 .child({ component }) 做作用域', () => {
    const childLogger = { tag: 'child-logger' }
    const parentLogger = { child: vi.fn(() => childLogger) }

    const p = new MyPrimitive({ component: RegisteredLogger.MEMORY, name: 'm' })
    p.__setLogger(parentLogger as never)

    // 用自己的 component 去 scope
    expect(parentLogger.child).toHaveBeenCalledWith({ component: 'MEMORY' })
    expect(p.getLogger()).toBe(childLogger)
  })

  it('分支二：logger 没有 child 方法 → 原样存下', () => {
    const plainLogger = { info: vi.fn() }

    const p = new MyPrimitive({ component: RegisteredLogger.MEMORY, name: 'm' })
    p.__setLogger(plainLogger as never)

    expect(p.getLogger()).toBe(plainLogger)
  })

  it('⚠️ 鸭子类型的后果：任何带 child 方法的对象都会被当成 logger', () => {
    const notReallyALogger = { child: vi.fn(() => ({})) }

    const p = new MyPrimitive({ name: 'x' })
    p.__setLogger(notReallyALogger as never)

    // 没有 instanceof 检查，形状对就走 child 分支
    expect(notReallyALogger.child).toHaveBeenCalled()
  })
})

describe('⭐ 两种枚举写法的对照（同一个 foundation 包里）', () => {
  /**
   * ErrorDomain（error/index.ts:7）      → TS 原生 enum
   * RegisteredLogger（logger/index.ts:3）→ const object + companion type
   *     export const RegisteredLogger = { AGENT: 'AGENT', ... };
   *     export type RegisteredLogger = (typeof RegisteredLogger)[keyof typeof RegisteredLogger];
   *
   * 后者的好处：编译产物更小、没有 TS enum 的双向映射，且值就是字面量联合。
   */
  it('RegisteredLogger 是 const object，不是 TS enum', () => {
    // TS enum 会有反向映射（数字枚举）或至少是编译期生成的对象；
    // 这里就是个普通冻结风格的字面量对象
    expect(typeof RegisteredLogger).toBe('object')
    expect(RegisteredLogger.AGENT).toBe('AGENT')
  })

  it('RegisteredLogger 有 20 个值', () => {
    expect(Object.keys(RegisteredLogger)).toHaveLength(20)
  })

  it('包含 component 会用到的主要分类', () => {
    expect(Object.values(RegisteredLogger)).toEqual(
      expect.arrayContaining(['AGENT', 'WORKFLOW', 'LLM', 'MEMORY', 'STORAGE', 'VECTOR']),
    )
  })
})

describe('继承关系：谁在用 MastraBase', () => {
  it('子类只需在 super 里传 component/name，就自动获得 logger', () => {
    // 复刻 MastraDeployer 的做法（core/src/deployer/index.ts:9）
    class MyDeployer extends MastraBase {
      constructor({ name }: { name: string }) {
        super({ component: 'DEPLOYER', name })
      }
    }

    const d = new MyDeployer({ name: 'my-deployer' })

    expect(d.component).toBe('DEPLOYER')
    expect((d as unknown as { logger: unknown }).logger).toBeDefined()
  })
})
