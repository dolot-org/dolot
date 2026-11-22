# 项目交接

Dotlo 的 Worker API、React PWA 和 D1 迁移已实现。见 [README](README.md) 了解模拟 DNS、首次创建管理员和本地开发步骤。

GitHub Actions 的 Build 工作流负责 TypeScript 编译、PWA 构建和 Worker 打包，并上传 `dotlo-build` 产物。此工作流使用 Wrangler 的 dry run，不执行部署。
