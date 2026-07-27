# my-learning — Mastra 学习沙箱

链接 monorepo 本地源码的最小 Mastra 项目，配合 [`docs/learning`](../../docs/learning/README.md) 使用。

## 一次性准备（仓库根目录）

```bash
pnpm install --ignore-scripts   # 若完整 install 因 onnxruntime 超时
pnpm build:cli                  # 构建 CLI + core 依赖图
```

改 `packages/core` 时建议另开终端 watch：

```bash
pnpm turbo watch build --filter="@mastra/core" --filter="mastra"
```

## 启动

```bash
cd examples/my-learning
pnpm install --ignore-workspace   # 必须
cp .env.example .env              # 填入 OPENAI_API_KEY
pnpm mastra:dev
```

- Studio: http://localhost:4111
- Swagger: http://localhost:4111/swagger-ui
- 默认 agent: `learning-agent`（带 `echo` tool）

> 用 `pnpm mastra:dev`，不要用全局 `mastra dev`，确保走 workspace 链接版本。

## 目录

```text
src/mastra/
  index.ts              # Mastra 实例（CLI 入口）
  agents/
    learning-agent.ts   # 第一个 agent + tool
```

## 学习扩展建议

| 想学什么 | 在这里加什么 |
|----------|--------------|
| workflow | `src/mastra/workflows/` + 注册到 `index.ts` |
| memory | `@mastra/memory` + `memory` 配置到 agent |
| requestContext | `agent.generate({ requestContext })` 或 Studio Request Context 面板 |

源码断点练习仍在 `docs/learning/*/examples`（Vitest），本目录用于端到端体验与改 core 后验证。
