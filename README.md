# Dotlo

Dotlo 是一个提供免费二级域名注册和 DNS 管理的 PWA。用户通过 Passkey 登录，可管理解析记录、续期或转移域名。管理后台负责后缀配置、注册审核和滥用举报。

## 架构与目录

React 前端由 Vite 构建。Cloudflare Workers 提供静态资源，并将 `/api/*` 交给 Hono 处理。D1 保存账户、域名、DNS 记录和审计数据。Worker 调用 Cloudflare DNS 发布解析，并每小时处理域名到期和回收。

| 路径 | 职责 |
| --- | --- |
| `src/client/` | PWA 页面、Passkey 交互和 API 客户端 |
| `src/worker/` | API 路由、会话、Cloudflare DNS 和定时维护 |
| `src/shared/` | API 类型、DNS 记录校验和中英文消息 |
| `migrations/` | 按编号顺序执行的 D1 迁移 |
| `public/` | PWA 图标和静态资源响应头 |

## 本地开发

使用 Node.js 22.12 或更新的 LTS 版本，以及 `package.json` 指定的 pnpm。GitHub Actions 使用 Node.js 24。

```sh
pnpm install --frozen-lockfile
test -f .dev.vars || cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev:api
```

另开终端运行 `pnpm dev`，访问 `http://localhost:5173`。Vite 将 `/api` 转发给监听 `8787` 的 Wrangler。Passkey 校验使用配置中的来源，直接把浏览器地址换成 `127.0.0.1` 会导致验证失败。

示例配置使用 `CF_MOCK=true`，并允许直接在浏览器中登录。用用户名 `admin` 注册 Passkey，在管理后台添加 `example.test` 后缀，区域 ID 填 `mock-zone`。随后即可在本地 D1 中注册域名并管理模拟 DNS 记录。

## API

- `GET /api/config` 返回公开配置与可注册后缀。公开查询使用 `/api/domains/check` 和 `/api/domains/resolve`，举报提交到 `POST /api/reports`。
- `/api/auth` 处理 Passkey 注册、登录和退出。账户、域名管理和转移分别使用 `/api/account`、`/api/domains` 和 `/api/transfers`。
- `/api/admin` 管理 DNS 后缀、域名、账户、举报、保留名称和站点设置，需要管理员会话。路由实现见 [`src/worker/routes/`](src/worker/routes/)。

登录后使用 Cookie 会话。写请求需要 `X-Dotlo-Client: web` 并通过来源校验。开启 PWA 限制时，受限接口还要求 `X-Dotlo-Display: standalone`。

## 构建

| 命令 | 用途 |
| --- | --- |
| `pnpm build` | 执行 TypeScript 检查并将 PWA 构建到 `dist/client` |
| `pnpm check:worker` | 用 Wrangler dry run 将 Worker 打包到 `dist/worker` |
| `pnpm icons` | 重新生成 `public/` 下的 PWA PNG 图标 |

GitHub Actions 的 [Build 工作流](.github/workflows/build.yml) 在推送到 `main`、拉取请求和手动触发时构建。成功后可从运行页面下载包含前端与 Worker 的 `dotlo-build` 产物。

## 运行配置

- **D1** 在 `wrangler.jsonc` 中为 `DB` 绑定填入实际数据库 ID。远程数据库使用 `pnpm db:migrate:remote` 应用迁移。
- **Passkey** `ORIGINS` 接受逗号分隔的来源，默认使用请求自身的来源。`RP_ID` 默认取来源的主机名。线上前端与 API 使用同一 HTTPS 来源。
- **管理员** `ADMIN_USERNAMES` 为匹配的用户名在注册时授予管理员角色。面向公众开放前先创建管理员账户，再清空初始化名单。现有角色通过管理后台维护。
- **DNS** 通过 Worker 密钥注入 `CF_API_TOKEN`，仅授权需管理的 Cloudflare 区域，并授予 Zone Read 与 DNS Edit 权限。`CF_MOCK=true` 用于本地模拟。
- **人机验证** 成对配置 `TURNSTILE_SITE_KEY` 与 Worker 密钥 `TURNSTILE_SECRET`，用于注册和举报。
- **PWA** `REQUIRE_PWA` 默认开启。设为 `false` 可在普通浏览器窗口使用受限功能。

## 许可证

Dotlo 采用 GNU Affero General Public License 第 3 版（`AGPL-3.0-only`）。完整条款见 [LICENSE](LICENSE)。
