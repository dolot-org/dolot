# Dotlo

Dotlo 提供免费二级域名注册、Passkey 登录与 DNS 管理。前端使用 React、Vite 和 Tailwind CSS，API 使用 Hono 与 Cloudflare Workers，数据保存在 D1。

## 本地开发

使用 Node.js 22 或更新的 LTS 版本，并使用 `package.json` 指定的 pnpm。

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev:api
```

另开终端运行 `pnpm dev`，通过 `http://localhost:5173` 打开应用。示例配置使用 `CF_MOCK=true` 和 `REQUIRE_PWA=false`，无需真实 DNS 或安装 PWA。Passkey 与站点来源关联，本地使用固定地址 `localhost`。

用示例配置中的管理员用户名注册第一个 Passkey，然后在管理端添加一个测试后缀，例如 `example.test`，区域 ID 可填 `mock-zone`。选择普通用户注册或管理员注册均可创建域名并修改模拟 DNS 记录。

## 编译与产物

GitHub Actions 的 Build 工作流在推送到 main 和提交拉取请求时编译项目。成功后可从运行页面下载 `dotlo-build` 构建产物。

```sh
pnpm build
pnpm check:worker
```

第一条执行 TypeScript 检查并构建 PWA，输出到 `dist/client`。第二条打包 Worker 并演练 Wrangler 构建，输出到 `dist/worker`。单独运行 `pnpm icons` 可重新生成 PWA PNG 图标。

## 运行配置

- `wrangler.jsonc` 中的 `DB` 是 D1 绑定。迁移位于 `migrations/`。
- `ADMIN_USERNAMES` 指定注册时赋予管理员角色的保留用户名。运行公开实例前先注册这些账户，之后可在管理端更改角色。
- `ORIGINS` 指定允许的来源。省略时使用请求自身的来源。`RP_ID` 默认从来源域名推导。
- 生产 DNS 需要通过 Worker 密钥注入 `CF_API_TOKEN`，权限范围应覆盖需要管理的区域及其 DNS。配置 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET` 可启用注册和举报的人机验证。
- `REQUIRE_PWA` 默认开启。建议使用同一 HTTPS 来源提供前端及 API。
