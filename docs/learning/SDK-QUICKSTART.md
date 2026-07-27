# SDK 快速入门（配合源码学习）

在啃 `docs/learning` 源码路线之前或并行，用下面路径建立「会用」的手感（约 2 小时）。

## 路径 A：官方课程（推荐，无需 API Key 也能跟）

仓库内课程 Markdown：

| 模块 | 目录 | 内容 |
|------|------|------|
| 1 | [`docs/src/course/01-first-agent/`](../src/course/01-first-agent/) | 第一个 Agent |
| 2 | [`docs/src/course/02-agent-tools-mcp/`](../src/course/02-agent-tools-mcp/) | Tools + MCP |
| 3 | [`docs/src/course/03-agent-memory/`](../src/course/03-agent-memory/) | Memory |
| 4 | [`docs/src/course/04-workflows/`](../src/course/04-workflows/) | Workflows + Playground |

在线版：<https://mastra.ai/course>

## 路径 B：脚手架小项目

```bash
npx create-mastra@latest my-mastra-app
cd my-mastra-app
cp .env.example .env   # 填入 OPENAI_API_KEY 等
pnpm dev               # 或 mastra dev
```

浏览器打开 **http://localhost:4111**（Mastra Studio）。

## 路径 C：在本 monorepo 里跑示例（链接本地源码）

### C1. 学习沙箱（推荐，依赖最少）

[`examples/my-learning`](../../examples/my-learning/README.md) — 一个 agent + echo tool，配合 `docs/learning` 练手。

```bash
# 仓库根目录（一次性）
pnpm install --ignore-scripts
pnpm build:cli

cd examples/my-learning
pnpm install --ignore-workspace
cp .env.example .env            # 填入 OPENAI_API_KEY
pnpm mastra:dev
```

### C2. 完整功能演示（examples/agent）

```bash
# 仓库根目录
pnpm install --ignore-scripts   # 若完整 install 因 onnxruntime 超时，可用此 flag
pnpm build:cli                  # 含 core / playground
# examples/agent 还依赖 editor、duckdb 等 link 包，首次需额外构建：
pnpm turbo build --filter @mastra/editor --filter @mastra/duckdb --filter "./auth/*"

# 终端 1：改 core 时自动重建
pnpm turbo watch build --filter="@mastra/core" --filter="mastra"

# 终端 2
cd examples/agent
pnpm install --ignore-workspace
cp .env.example .env            # 填入 OPENAI_API_KEY（voice agent 启动必需）
pnpm mastra:dev
```

Studio：**http://localhost:4111** · API 文档：**http://localhost:4111/swagger-ui**

## 与源码学习的对应关系

| Studio / SDK 操作 | 源码模块 |
|-------------------|----------|
| Agent Generate | 06-agent → 07-loop |
| Workflow 执行 | 05-workflows |
| Memory 线程 | 09-memory |
| Traces | 12-observability |
| REST `/api/*` | 14-server-deploy |

学完 05 + 06 后再开 Studio，用 UI 验证你在 Vitest 断点里看到的执行链。
