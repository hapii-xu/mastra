import { describe, expect, it } from 'vitest'
import {
  ErrorCategory,
  ErrorDomain,
  getErrorFromUnknown,
  MastraBaseError,
  MastraError,
  MastraNonRetryableError,
} from '../../../../packages/_internal-core/src/error'

/**
 * 06 · MastraError 错误体系
 *
 * 源码：packages/_internal-core/src/error/index.ts（153 行）+ error/utils.ts
 *
 * 仓库原生测试（packages/core/src/error/index.test.ts）只有 8 个用例覆盖 153 行，
 * message 三级回退、toString、跨子类 instanceof 都没测到。这里补上。
 */

describe('domain / category 枚举（index.ts:7-34）', () => {
  it('ErrorDomain 有 19 个值', () => {
    expect(Object.keys(ErrorDomain)).toHaveLength(19)
    expect(ErrorDomain.MASTRA_WORKFLOW).toBe('MASTRA_WORKFLOW')
  })

  it('ErrorCategory 有 4 个值：UNKNOWN / USER / SYSTEM / THIRD_PARTY', () => {
    expect(Object.keys(ErrorCategory)).toHaveLength(4)
    expect(Object.values(ErrorCategory)).toEqual(['UNKNOWN', 'USER', 'SYSTEM', 'THIRD_PARTY'])
  })

  /**
   * ⭐ 枚举是约定不是强制：MastraError（index.ts:142）用的是
   *    MastraBaseError<`${ErrorDomain}`, `${ErrorCategory}`>
   * 模板字面量联合，所以裸字符串和枚举成员在类型上完全等价。
   */
  it('⭐ 裸字符串 domain 与枚举成员等价（类型上都合法）', () => {
    const withEnum = new MastraError({ id: 'X', domain: ErrorDomain.TOOL, category: ErrorCategory.USER })
    const withLiteral = new MastraError({ id: 'X', domain: 'TOOL', category: 'USER' })

    expect(withEnum.domain).toBe(withLiteral.domain)
  })
})

describe('IErrorDefinition 与 details 的真实约束（index.ts:48-64）', () => {
  it('id / domain / category 必填，text / details 可选', () => {
    const e = new MastraError({ id: 'MINIMAL_ERROR', domain: ErrorDomain.AGENT, category: ErrorCategory.SYSTEM })

    expect(e.id).toBe('MINIMAL_ERROR')
    expect(e.details).toEqual({}) // 不传时默认 {}，不是 undefined（index.ts:107）
  })

  /**
   * ⭐ details 实际只能放平铺标量。
   * Json<Scalar>（index.ts:38-42）递归塌缩成 Scalar，
   * 所以 details ≈ Record<string, null|boolean|number|string>。
   * 这就是为什么调用点要写 errorMessage: String(err)（tool-builder/builder.ts:843）。
   */
  it('⭐ details 只吃标量：所以调用点要 String(err) 而不是塞对象', () => {
    const err = new Error('原始错误')
    const e = new MastraError({
      id: 'TOOL_EXECUTION_FAILED',
      domain: ErrorDomain.TOOL,
      category: ErrorCategory.USER,
      details: { errorMessage: String(err), toolName: 'search', attempt: 2, fatal: false },
    })

    expect(e.details).toEqual({ errorMessage: 'Error: 原始错误', toolName: 'search', attempt: 2, fatal: false })
  })

  // details.status 是全仓库夹带 HTTP 码的潜规则（mastra/index.ts:1938 塞 404）
  it('details.status 是夹带 HTTP 码的约定', () => {
    const e = new MastraError({
      id: 'MASTRA_GET_AGENT_BY_NAME_NOT_FOUND',
      domain: ErrorDomain.MASTRA,
      category: ErrorCategory.USER,
      text: 'Agent with name foo not found',
      details: { status: 404 },
    })

    expect(e.details?.status).toBe(404)
  })
})

describe('⭐ message 三级回退：text ?? error?.message ?? "Unknown error"（index.ts:101）', () => {
  // 断点：index.ts:101。三个入参组合各跑一次，看 message 从哪来。
  it('① text 优先（覆盖原始错误的 message）', () => {
    const e = new MastraError(
      { id: 'X', domain: ErrorDomain.LLM, category: ErrorCategory.THIRD_PARTY, text: '自定义文案' },
      new Error('原始文案'),
    )

    expect(e.message).toBe('自定义文案')
  })

  it('② 没有 text → 用原始错误的 message', () => {
    const e = new MastraError(
      { id: 'X', domain: ErrorDomain.LLM, category: ErrorCategory.THIRD_PARTY },
      new Error('原始文案'),
    )

    expect(e.message).toBe('原始文案')
  })

  it('③ 都没有 → "Unknown error"', () => {
    const e = new MastraError({ id: 'X', domain: ErrorDomain.LLM, category: ErrorCategory.THIRD_PARTY })

    expect(e.message).toBe('Unknown error')
  })
})

describe('⭐ 原型链：setPrototypeOf 与 instanceof（index.ts:111, 151）', () => {
  /**
   * Object.setPrototypeOf(this, new.target.prototype) 是修复
   * 「extends Error 后 instanceof 失效」的经典手法（ES5 target 下）。
   * 它是 load-bearing 的 —— workflows/default.ts:458 靠 instanceof 判重试。
   */
  it('MastraError 的 instanceof 链完整', () => {
    const e = new MastraError({ id: 'X', domain: ErrorDomain.AGENT, category: ErrorCategory.USER })

    expect(e).toBeInstanceOf(MastraError)
    expect(e).toBeInstanceOf(MastraBaseError)
    expect(e).toBeInstanceOf(Error)
  })

  it('自定义子类也能保持 instanceof（因为用了 new.target）', () => {
    class MyError extends MastraError {}
    const e = new MyError({ id: 'X', domain: ErrorDomain.AGENT, category: ErrorCategory.USER })

    expect(e).toBeInstanceOf(MyError)
    expect(e).toBeInstanceOf(MastraError)
  })
})

describe('序列化：toJSON vs toJSONDetails vs toString（index.ts:117-139）', () => {
  // 断点：index.ts:131（code: this.id）。注意 id → code 的字段改名。
  it('⭐ toJSON 把 id 改名成 code', () => {
    const e = new MastraError({
      id: 'MY_ERROR_ID',
      domain: ErrorDomain.STORAGE,
      category: ErrorCategory.SYSTEM,
      text: 'boom',
      details: { table: 'threads' },
    })

    expect(e.toJSON()).toEqual({
      message: 'boom',
      domain: 'STORAGE',
      category: 'SYSTEM',
      code: 'MY_ERROR_ID', // ← 不叫 id
      details: { table: 'threads' },
      cause: undefined,
    })
  })

  it('toJSONDetails 没有 code、也没有 cause（index.ts:117）', () => {
    const e = new MastraError({ id: 'X', domain: ErrorDomain.STORAGE, category: ErrorCategory.SYSTEM, text: 'boom' })

    const d = e.toJSONDetails()

    expect(d).toEqual({ message: 'boom', domain: 'STORAGE', category: 'SYSTEM', details: {} })
    expect('code' in d).toBe(false)
  })

  it('toString 就是 JSON.stringify(toJSON())（index.ts:137）', () => {
    const e = new MastraError({ id: 'X', domain: ErrorDomain.EVAL, category: ErrorCategory.USER, text: 'oops' })

    expect(e.toString()).toBe(JSON.stringify(e.toJSON()))
  })

  it('cause 链会被序列化进去', () => {
    const e = new MastraError(
      { id: 'X', domain: ErrorDomain.LLM, category: ErrorCategory.THIRD_PARTY },
      new Error('底层原因'),
    )

    expect(e.toJSON().cause?.message).toBe('底层原因')
  })

  /**
   * serializeStack: false 是硬编码的（index.ts:96-97）——
   * MastraError 的 cause.toJSON() 永远不带 stack（stack 留在实例上供调试）。
   */
  it('⭐ cause 的 JSON 里没有 stack（serializeStack 硬编码为 false）', () => {
    const e = new MastraError(
      { id: 'X', domain: ErrorDomain.LLM, category: ErrorCategory.THIRD_PARTY },
      new Error('底层'),
    )

    expect(e.toJSON().cause?.stack).toBeUndefined()
    expect(e.cause?.stack).toBeDefined() // 但实例上有
  })
})

describe('⭐ MastraNonRetryableError：workflow 重试的逃生舱（index.ts:145-153）', () => {
  it('它不继承 MastraBaseError，只是个纯标记类', () => {
    const e = new MastraNonRetryableError('永久失败')

    expect(e).toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(MastraBaseError) // ← 注意
    expect(e.name).toBe('MastraNonRetryableError')
  })

  it('靠 isNonRetryable = true as const 打标（index.ts:146）', () => {
    expect(new MastraNonRetryableError('x').isNonRetryable).toBe(true)
  })

  /**
   * 消费点：workflows/default.ts:458
   *   const isNonRetryable = e instanceof MastraNonRetryableError;
   *   if (isNonRetryable || i === params.retries) { ... }   ← :460 跳出重试循环
   * 结果打标：:491 → { nonRetryable: true }，类型在 workflows/types.ts:108
   * evented 引擎镜像了一份：evented/step-executor.ts:328
   *
   * 断点：workflows/default.ts:458（需要先修好构建才能跑 core 的测试）
   */
  it('复刻 default.ts:450-460 的重试循环：普通错误会重试到上限', () => {
    let attempts = 0
    const retries = 2

    for (let i = 0; i < retries + 1; i++) {
      try {
        attempts++
        throw new Error('临时故障')
      } catch (e) {
        const isNonRetryable = e instanceof MastraNonRetryableError
        if (isNonRetryable || i === retries) break
      }
    }

    expect(attempts).toBe(3) // 首次 + 2 次重试
  })

  it('⭐ 抛 MastraNonRetryableError → 第一次就跳出，不重试', () => {
    let attempts = 0
    const retries = 2

    for (let i = 0; i < retries + 1; i++) {
      try {
        attempts++
        throw new MastraNonRetryableError('参数非法，重试也没用')
      } catch (e) {
        const isNonRetryable = e instanceof MastraNonRetryableError
        if (isNonRetryable || i === retries) break
      }
    }

    expect(attempts).toBe(1) // 没有重试
  })

  /**
   * ⚠️ 原型链三连的最后一环 —— step-executor.ts:330-332 的警告注释原文：
   *   "Important: Check `error` not `errorInstance` because getErrorFromUnknown
   *    converts the error and loses the prototype chain."
   */
  it('⚠️ 用 getErrorFromUnknown 处理过的值判 instanceof 会怎样', () => {
    const raw = new MastraNonRetryableError('永久失败')
    const converted = getErrorFromUnknown(raw)

    // 原始值：判定成立
    expect(raw instanceof MastraNonRetryableError).toBe(true)

    // 转换后的值：这里 getErrorFromUnknown 对已是 Error 的入参按 identity 返回，
    // 所以这个用例里仍然成立 —— 但注释警告的是「不能依赖这一点」，
    // 因为入参不是 Error 实例时（如普通对象），返回的就是全新 Error，原型链没了。
    expect(converted).toBe(raw) // identity 返回（utils.ts:81-88）

    // 反例：非 Error 入参 → 新建 Error → 标记类信息彻底丢失
    const fromPlainObject = getErrorFromUnknown({ message: '永久失败', isNonRetryable: true })
    expect(fromPlainObject instanceof MastraNonRetryableError).toBe(false) // ← 判重试会误判！
  })
})

describe('getErrorFromUnknown 的几个关键行为（error/utils.ts:45）', () => {
  it('已是 Error → 就地改造并按 identity 返回（不拷贝）', () => {
    const original = new Error('原始')
    expect(getErrorFromUnknown(original)).toBe(original)
  })

  it('字符串 → 包成 Error', () => {
    expect(getErrorFromUnknown('出错了').message).toBe('出错了')
  })

  it('其他类型 → 用 fallbackMessage', () => {
    expect(getErrorFromUnknown(undefined).message).toBe('Unknown error')
  })

  it('会给 Error 挂上 toJSON（且是不可枚举的，避免干扰对象比较）', () => {
    const e = getErrorFromUnknown(new Error('x'))

    expect(typeof e.toJSON).toBe('function')
    expect(Object.keys(e)).not.toContain('toJSON') // 不可枚举（utils.ts:152）
  })
})
