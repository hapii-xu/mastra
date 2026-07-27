# Agent / loop 三个总断点（学到 06/07 时在 VS Code 中设置）
#
# 1. packages/core/src/agent/agent.ts:6467  — #execute() 入口
# 2. packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts — execute
# 3. packages/core/src/loop/workflows/agentic-loop/index.ts:92 — .dowhile 停止条件
#
# Debug 步骤：
#   - 打开 docs/learning/07-loop/examples/02-loop-with-tools.test.ts
#   - 使用 launch.json 中 "Debug learning example (workflows+)" 或把 cwd 改为 07-loop/examples
#   - F5 启动，在上述源码行打断点
#
# 验证用例（mock 模型，响应确定）：
#   cd docs/learning/07-loop/examples
#   node ../../../node_modules/vitest/vitest.mjs run 02-loop-with-tools
