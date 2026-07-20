import { defineConfig } from 'vitest/config'

/**
 * 学习用示例的独立 vitest 配置。
 *
 * 关键点：故意不设 setupFiles、不依赖任何 dist 产物。
 * 示例通过相对路径直接 import packages/_internal-core/src/ 下的源码，
 * 因此不受仓库 TS6 构建损坏的影响，可以零构建直接跑。
 *
 * 跑法：cd 到本目录，执行 npx vitest run（或 npx vitest 进 watch 模式）
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
})
