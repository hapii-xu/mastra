# 03. LLM — 模型路由与网关

## 模块职责

**把「模型 ID 字符串」解析成「可调用的模型对象」，并处理多 provider、网关、fallback、重试。**

企业级场景里这个模块的价值很直接：**多模型容灾**（主模型挂了自动切备用）、**成本路由**（简单任务走便宜模型）、**私有化网关**（走公司自建的 Azure / 代理）。

模块标称 22k 行，但**其中 5063 行是 `provider-types.generated.d.ts`——自动生成的类型，一行都不用读**。实际要读的核心不到 2000 行，且**大部分是纯函数**，是本路线里最容易零构建测试的模块之一。

## 学习路径（3 篇深度文档）

| 主题               | 文档                                                       | 一句话                                                  |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------- |
| 模型 ID 解析       | [01-model-id-parsing.md](./01-model-id-parsing.md)         | parseModelRouterId，含 2 段格式特例                     |
| ⭐ 服务端 fallback | [02-server-side-fallback.md](./02-server-side-fallback.md) | **你请求 A 模型，网关可能实际用了 B——成本核算要用这个** |
| ⭐ 客户端 fallback | [03-client-fallback.md](./03-client-fallback.md)           | **主模型挂了自动切备用，实测验证**                      |

### ⭐ 两层 fallback，别搞混

|            | 服务端 fallback                        | 客户端 fallback             |
| ---------- | -------------------------------------- | --------------------------- |
| 谁在切换   | provider（如 Anthropic）自己           | Mastra agent 配置的模型数组 |
| 你能感知吗 | 不能，除非解析 providerMetadata        | 能，配置里明确写了          |
| 成本核算   | 必须用 `resolveResponseModelId()` 校正 | 每个模型独立计费            |

详见 [02](./02-server-side-fallback.md) 和 [03](./03-client-fallback.md)。

## 可跑示例

`examples/` 下 **3 个测试文件、22 个用例**，零构建，大部分 <200ms（纯函数）：

```bash
cd docs/learning/03-llm/examples
npx vitest run                        # 全跑
npx vitest run 03-client-fallback      # 只跑招牌课（实测 fallback 切换）
```

## 示例里挖到的真实细节（已验证）

- **⭐ 主模型失败会自动切换备用模型**：用总是抛错的 mock 模型实测验证（[03](./03-client-fallback.md)）
- **⭐ 所有模型都失败时最终抛错**：fallback 链不是无限重试（[03](./03-client-fallback.md)）
- **⚠️ 2 段模型 ID 不一定报错**：`netlify/openai` 配 `gatewayPrefix='netlify'` 会走 provider-equals-gateway 分支，不报错——这是容易误判的边界（[01](./01-model-id-parsing.md)）
- **`resolveResponseModelId` 优先用 fallback 报告的模型**：成本核算不能只信任请求参数（[02](./02-server-side-fallback.md)）
- **多个 fallback_message 时取最后一个**：`[...iterations].reverse().find(...)`（[02](./02-server-side-fallback.md)）

## 关键源码文件

| 路径                                      | 行数 | 作用                                                                  | 文档 |
| ----------------------------------------- | ---- | --------------------------------------------------------------------- | ---- |
| `llm/model/gateway-resolver.ts`           | —    | `parseModelRouterId`                                                  | 01   |
| `llm/model/server-side-fallback.ts`       | —    | `getServerSideFallbackInfo`、`resolveResponseModelId`                 | 02   |
| `agent.ts` 模型解析方法                   | —    | `getLLM`(2665)、`getModelList`(2945)、`normalizeModelFallbacks`(2785) | 03   |
| `llm/model/model.loop.ts`                 | 382  | `MastraLLMVNext`——agent 与 loop 的桥（见 07）                         | —    |
| `llm/model/router.ts`                     | 608  | `ModelRouterLanguageModel`                                            | —    |
| `llm/model/provider-registry.ts`          | 899  | provider 注册表                                                       | —    |
| `llm/model/provider-types.generated.d.ts` | 5063 | **自动生成，跳过**                                                    | —    |

## 校正记录

相对初版（导航索引）的补充：

- ✅ 客户端 fallback 的实际切换行为（初版只提了概念，本轮用 mock 实测验证了切换和边界）
- ✅ `parseModelRouterId` 的完整分支逻辑与边界情况（初版没有细节）
- ✅ `resolveResponseModelId` 的成本核算实战场景（初版只提了字段存在）
