# Project Handoff

Dotlo includes a Cloudflare Worker API, a React PWA, and a D1 database. The [README](README.md) covers local setup with simulated DNS, administrator bootstrap, runtime configuration, and the MCP client.

The [Build workflow](.github/workflows/build.yml) type-checks the project, builds the PWA, and packages the Worker using a Wrangler dry run. Each successful run uploads the `dotlo-build` artifact for manual deployment.
