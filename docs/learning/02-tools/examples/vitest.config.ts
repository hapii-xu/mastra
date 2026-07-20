import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 学习用示例的独立 vitest 配置 —— 零构建可跑。
 *
 * 原理：examples 通过相对路径直接 import packages/core/src/ 的源码，
 * 但 core 源码会引用一批 @internal/* 和 @mastra/schema-compat 的 bare specifier，
 * 这些包的 package.json exports 指向 dist/（未构建时不存在）。
 * 这里用 alias 把它们全部重定向到各自的 src/，绕开构建。
 *
 * 这套 alias 是实测出来的最小收敛集（8 个）：
 *   @internal/core, 4 个 vendored ai 包, @internal/auth, @internal/voice, @mastra/schema-compat
 *
 * 跑法：cd 到本目录，执行 npx vitest run（~1-2s）
 * 06-agent / 07-loop 的 examples/ 复用同一份配置。
 */
const ROOT = path.resolve(__dirname, '../../../..')
const V = (p: string) => path.resolve(ROOT, p)

export default defineConfig({
  resolve: {
    alias: {
      '@internal/core': V('packages/_internal-core/src'),
      '@internal/ai-sdk-v4': V('packages/_vendored/ai_v4/src'),
      '@internal/ai-sdk-v5': V('packages/_vendored/ai_v5/src'),
      '@internal/ai-v6': V('packages/_vendored/ai_v6/src'),
      '@internal/ai-v7': V('packages/_vendored/ai_v7/src'),
      '@internal/auth': V('packages/_internals/auth/src'),
      '@internal/voice': V('packages/_internals/voice/src'),
      '@mastra/schema-compat': V('packages/schema-compat/src'),
    },
  },
  define: {
    __MASTRA_VERSION__: JSON.stringify('0.0.0'),
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
})
