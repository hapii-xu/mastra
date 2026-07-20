# 14. Server & Deploy — 上线

## 模块职责

**把 Mastra 应用暴露为 HTTP 服务，并打包部署到目标平台。**

这是学习路线的终点：从「跑得起来」到「上得了线」。

**又是「契约在 core，实现在别处」的老套路**——`core/src` 里只有约 2k 行接口，实现分散在三个地方：

| 位置                     | 内容                | 规模                                  |
| ------------------------ | ------------------- | ------------------------------------- |
| `core/src/server/`       | HTTP 契约、认证接口 | 1.9k                                  |
| `core/src/bundler/`      | 打包抽象类          | 50 行                                 |
| `core/src/deployer/`     | 部署抽象类          | **14 行**                             |
| **`packages/deployer/`** | **真正的实现**      | **8.3k 行 / 69 文件**                 |
| **`deployers/`**         | **平台适配**        | cloud / cloudflare / netlify / vercel |

## 前置依赖

- **11-mastra**（必须）：server 从 Mastra 实例取一切
- 01-foundation：`RequestContext` 从 HTTP 请求构造

## 核心概念

### 1. 基于 Hono

`core/src/server/index.ts` 第一行就是：

```ts
import type { Handler, MiddlewareHandler } from 'hono'
import type { DescribeRouteOptions } from 'hono-openapi'
```

**Mastra 的 server 层建立在 [Hono](https://hono.dev) 之上**，并用 `hono-openapi` 生成 OpenAPI 文档。

好处：Hono 跨运行时（Node / Bun / Deno / Cloudflare Workers / Vercel Edge），这是 Mastra 能部署到 4 个平台的基础。

**如果你对 Hono 不熟，先花一小时看它的文档**，否则这个模块会读得很别扭。

### 2. 认证 —— 企业级重点

`core/src/server/` 的认证是**可组合**的：

| 导出                  | 文件                | 作用                   |
| --------------------- | ------------------- | ---------------------- |
| `MastraAuthProvider`  | `auth.ts`           | **认证提供者抽象基类** |
| `IMastraAuthProvider` | —                   | 接口                   |
| **`CompositeAuth`**   | `composite-auth.ts` | **组合多个认证方式**   |
| `SimpleAuth`          | `simple-auth.ts`    | 简单认证               |
| `MastraAuthConfig`    | `types.ts`          | 配置                   |

**`CompositeAuth` 是企业级接入点**：内部系统可能同时需要 API key（服务间）+ OIDC（用户）+ mTLS。组合起来。

测试很全（`auth.test.ts` 371 行、`simple-auth.test.ts` 366 行、`composite-auth.test.ts` 95 行）——**认证的规格说明就在这些测试里**。

关联：`core/src/auth/`（33 个小文件，含 `ee/` 企业版）+ agent 里的 `#requireAgentExecutionFGA`（见 06）。

### 3. `MastraServerBase` 与自定义路由

`core/src/server/base.ts` 导出 `MastraServerBase`。

自定义 API 路由靠 `ApiRoute` / `ApiRouteHandler`（`server/types.ts`，484 行）。有个很讲究的类型：

```ts
type ParamsFromPath<P extends string> = { ... }
```

**从路径字符串字面量推导出参数类型**——写 `/agents/:agentId` 就自动有 `{ agentId: string }`。TS 类型体操的好例子。

Hono context 里可以 `c.get()` 拿到 server 中间件注入的变量（`server/index.ts:38` 附近注释）。

中间件：`Middleware` 类型 + Mastra 的 `#serverMiddleware` 字段（见 11）。

### 4. 其他 server 能力

- `HttpLoggingConfig` —— HTTP 日志
- `CorsOptions` —— CORS
- `ValidationErrorContext` / `ValidationErrorResponse` / `ValidationErrorHook` —— 校验错误处理
- `StudioConfig` —— Studio 配置
- `A2AConfig` / `A2AAgentCardSigningConfig` —— A2A 协议（agent 间通信，关联 `core/src/a2a/`）
- `getRequestHeader` / `getWebRequest` —— 请求工具

### 5. `MastraBundler` —— 打包抽象

`core/src/bundler/index.ts`，50 行。**不是空壳**，是个有实际方法的抽象类：

```ts
export interface IBundler {
  loadEnvVars(): Promise<Map<string, string>>
  getEnvFiles(): Promise<string[]>
  getAllToolPaths(mastraDir, toolsPaths): (string | string[])[]
  bundle(entryFile, outputDirectory, options): Promise<void>
  prepare(outputDirectory): Promise<void>
  writePackageJson(outputDirectory, dependencies): Promise<void>
  lint(entryFile, outputDirectory, toolsPaths): Promise<void>
}
```

`MastraBundler extends MastraBase` 自带了 `loadEnvVars()` 的默认实现（读 `.env` 用 dotenv）。

### 6. `MastraDeployer` —— 部署抽象（14 行）

`core/src/deployer/index.ts` **全文 14 行**：

```ts
export interface IDeployer extends IBundler {
  deploy(outputDirectory: string): Promise<void>
}

export abstract class MastraDeployer extends MastraBundler implements IDeployer {
  constructor({ name }: { name: string }) {
    super({ component: 'DEPLOYER', name })
  }
  abstract deploy(outputDirectory: string): Promise<void>
}
```

**Deployer = Bundler + 一个 `deploy()` 方法。** 就这么简单。

**这 14 行是整个部署体系的全部抽象**——干净得令人愉快。要部署到公司自己的平台？实现这一个方法。

### 7. 实现层

**`packages/deployer/`（8.3k 行 / 69 文件）** 才是真正的实现：

```
packages/deployer/src/
├── build/       构建
├── bundler/     打包（Rollup 等）
├── deploy/      部署
├── server/      服务实现（Hono app 组装）
├── services/
└── validator/
```

**`deployers/`（平台适配）**：`cloud`（Mastra Cloud）、`cloudflare`、`netlify`、`vercel`

## 关键源码文件

| 路径                                | 行数   | 作用                                  | 建议             |
| ----------------------------------- | ------ | ------------------------------------- | ---------------- |
| `core/src/deployer/index.ts`        | **14** | **`MastraDeployer`**                  | **先读，1 分钟** |
| `core/src/bundler/index.ts`         | 50     | `MastraBundler` / `IBundler`          | **先读，5 分钟** |
| `core/src/server/index.ts`          | 124    | 导出面 + `ParamsFromPath`             | **先读**         |
| `core/src/server/types.ts`          | 484    | **`ApiRoute`、`MastraAuthConfig` 等** | **精读**         |
| `core/src/server/auth.ts`           | —      | `MastraAuthProvider`                  | **企业级必读**   |
| `core/src/server/composite-auth.ts` | —      | **`CompositeAuth`**                   | **企业级必读**   |
| `core/src/server/simple-auth.ts`    | —      | 参考实现                              | 先读             |
| `core/src/server/base.ts`           | —      | `MastraServerBase`                    | 先读             |
| `core/src/server/request-types.ts`  | —      | 请求工具                              | 短               |
| `packages/deployer/src/server/`     | —      | **Hono app 实际组装**                 | **精读**         |
| `packages/deployer/src/bundler/`    | —      | 打包实现                              | 后读             |
| `deployers/cloudflare` 等           | —      | 平台适配                              | 用哪个读哪个     |
| `core/src/auth/`                    | 1.6k   | 认证细节（含 `ee/`）                  | 企业级读         |

## 执行链路追踪

```
【启动】
new Mastra({ server: {...}, deployer: new CloudflareDeployer({...}) })   见 11
  └─ #server / #serverAdapter / #serverMiddleware / #deployer
       ↓
packages/deployer/src/server/  组装 Hono app
  ├─ 注册内置路由（agents / workflows / memory / ...）
  ├─ 注册自定义 ApiRoute            core/src/server/types.ts
  ├─ 挂 middleware                  Mastra.#serverMiddleware
  └─ 挂认证                         MastraAuthProvider / CompositeAuth
       ↓
【请求】
HTTP 请求
  └─ Hono middleware
       ├─ 认证 → MastraAuthProvider.authenticate()
       ├─ 构造 RequestContext        见 01
       └─ c.set('mastra', mastraInstance)
            ↓
       route handler
         └─ agent.stream({ requestContext })    见 06
              └─ #requireAgentExecutionFGA()    权限检查（auth/ee）

【部署】
mastra deploy
  └─ MastraDeployer (extends MastraBundler)     core/src/deployer/index.ts
       ├─ loadEnvVars()      读 .env
       ├─ getAllToolPaths()
       ├─ lint()
       ├─ bundle()           packages/deployer/src/bundler/
       ├─ prepare()
       ├─ writePackageJson()
       └─ deploy()           deployers/cloudflare | vercel | netlify | cloud
```

## 示例与测试入口

```bash
pnpm --filter @mastra/core test server/auth.test.ts            # 371 行 ← 认证规格
pnpm --filter @mastra/core test server/simple-auth.test.ts     # 366 行
pnpm --filter @mastra/core test server/composite-auth.test.ts  # 95 行
pnpm --filter @mastra/core test server/server.test.ts
pnpm --filter @mastra/deployer test
```

`server/server.test-d.ts`（235 行）是类型层测试——**`ParamsFromPath` 那套路径推导的验证在这**。

**实操路径**（比读源码更快建立手感）：

```bash
npx create-mastra@latest      # 建项目
mastra dev                    # 起本地服务 + Studio
```

仓库里有 `smoke-test` / `mastra-smoke-test` skill 覆盖这个流程。

可跑项目：`examples/studio-preview`

## Debug 断点建议

| 断点                                            | 观察什么                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/deployer/src/server/` 的 app 组装处   | **最有价值**：内置路由到底注册了哪些——**这就是 Mastra 的完整 HTTP API 面** |
| `MastraAuthProvider.authenticate()`（你的实现） | 认证上下文                                                                 |
| RequestContext 构造处                           | **HTTP 请求怎么变成 requestContext**——多租户的关键切点                     |
| `agent/agent.ts:6467` (`#execute`)              | 从 HTTP 进来的 options 长什么样                                            |
| `MastraDeployer.deploy()`（平台实现）           | 部署产物                                                                   |

**建议动作**：`mastra dev` 起服务，在 Hono 路由注册处打断点，把所有内置路由列出来。这份清单就是你的 API 文档（也可以直接看 OpenAPI 输出）。

## 设计取舍与坑

- **`MastraDeployer` 只有 14 行**——部署抽象干净到极致。自研平台部署成本极低。
- **Hono 是硬依赖**。不喜欢也得接受，好处是跨运行时。
- **`CompositeAuth` 是企业级认证的正解**。别自己在中间件里堆 if-else。
- **RequestContext 的构造点是多租户的命门**。租户 ID 从哪来（header？JWT？子域名？）在这里决定，然后一路流到 agent、memory、storage。**设计错了后面全乱。**
- **`bundler/index.ts` 只有 50 行但不是空壳**——它有 `loadEnvVars()` 的实际实现。别被行数骗了跳过它。
- **权限有两层**：server 层认证（你是谁）+ agent 层 FGA（`#requireAgentExecutionFGA`，你能不能调这个 agent）。企业级两层都要设计。
- **`packages/deployer` 才是重头**（8.3k 行）。core 里那 2k 行只是接口。

## 后续细化 TODO

- [ ] **内置 HTTP 路由完整清单**——Mastra 的 API 面到底有多大（**先做这个**，直接看 OpenAPI 输出）
- [ ] **`CompositeAuth` 组合机制** + 自定义 `MastraAuthProvider`（**企业级最该先做的**）
- [ ] **RequestContext 从 HTTP 请求的构造过程**——多租户设计的命门
- [ ] 两层权限：server 认证 vs agent FGA（`auth/ee`）的完整模型（关联 06）
- [ ] `ApiRoute` 自定义路由 + `ParamsFromPath` 类型推导
- [ ] `#serverMiddleware` 的注入时机与顺序（关联 11）
- [ ] `packages/deployer/src/server/` 的 Hono app 组装全过程
- [ ] 打包流程：`bundle()` 用的什么（Rollup？）、产物结构、体积优化
- [ ] 自研部署器：实现 `MastraDeployer` 部署到公司 K8s / 内部平台
- [ ] 4 个平台 deployer 的差异与选型
- [ ] 多实例部署：evented 引擎 + pubsub + 存储的完整架构（关联 05/10/11）
- [ ] `A2AConfig`：agent 间通信协议（关联 `core/src/a2a/`）
- [ ] `HttpLoggingConfig` + 生产日志方案（关联 12）
