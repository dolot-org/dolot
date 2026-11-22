# Dotlo

[![Open the Dotlo app][badge-app]][app]
[![AGPL version 3 license][badge-license]](LICENSE)
[![GitHub Actions build status][badge-build]](.github/workflows/build.yml)
[![GitHub releases][badge-releases]][releases]

[![Cloudflare Workers][badge-workers]][workers]
[![Cloudflare D1][badge-d1]][d1]
[![Cloudflare DNS][badge-dns]][dns]
[![Passkey authentication][badge-passkeys]](#local-development)

[![React][badge-react]][react]
[![TypeScript][badge-typescript]][typescript]
[![Vite][badge-vite]][vite]
[![pnpm][badge-pnpm]][pnpm]
[![Rust and MCP][badge-mcp]](#dotlo-mcp)

Dotlo is a free, open-source subdomain registration and DNS management PWA. Sign in with a passkey to claim a name, manage DNS records, renew it, or transfer it to another account. The admin console manages available suffixes, registration reviews, and abuse reports.

## Architecture

Vite builds the React frontend. Cloudflare Workers serves the PWA and routes `/api/*` to Hono. D1 stores accounts, registrations, DNS records, and audit events. The Worker publishes records through Cloudflare DNS and processes expirations and reclamation on an hourly schedule.

| Path | Purpose |
| --- | --- |
| `src/client/` | PWA screens, passkey flows, and API client |
| `src/worker/` | API routes, sessions, DNS integration, and scheduled maintenance |
| `src/shared/` | API types, DNS validation, and English and Chinese messages |
| `migrations/` | Numbered D1 migrations |
| `mcp/` | Rust MCP server and local client configuration |
| `scripts/` | MCP installers and PWA icon generation |
| `public/` | PWA icons and static asset headers |

## Local Development

Use Node.js 22.12 or newer and the pnpm version pinned in [package.json](package.json). GitHub Actions uses Node.js 24.

```sh
pnpm install --frozen-lockfile
test -f .dev.vars || cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev:api
```

In a second terminal, run `pnpm dev` and open `http://localhost:5173`. Vite proxies `/api` to Wrangler on port `8787`. Use the configured `localhost` origin for passkey flows.

The example configuration uses `CF_MOCK=true` for simulated DNS and allows browser sign-in. Register the username `admin`, then add `example.test` in the admin console with `mock-zone` as its zone ID. You can then claim names and edit simulated records against local D1.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/config` | Public settings and available suffixes |
| `/api/domains/check` and `/api/domains/resolve` | Check name availability and look up DNS records |
| `POST /api/reports` | Submit an abuse report |
| `/api/auth` | Register with a passkey, sign in, and sign out |
| `/api/account`, `/api/domains`, and `/api/transfers` | Manage accounts, domains, and transfers |
| `/api/admin` | Manage suffixes, domains, accounts, reports, reserved names, and settings as an administrator |

Browser sign-in creates a cookie session. Write requests require `X-Dotlo-Client: web` and an allowed origin. When the PWA requirement is enabled, restricted routes also require `X-Dotlo-Display: standalone`. See the [route implementations](src/worker/routes/).

## Dotlo MCP

These instructions apply to checkouts and releases that include Dotlo MCP.

Dotlo MCP connects AI clients over local standard input and output. It can look up domains and DNS records, claim and renew names, edit DNS, and process transfers within the authorized account.

Download the installer for your platform from [GitHub Releases][releases]. It downloads the matching binary, verifies its SHA-256 checksum, and starts setup and sign-in.

**Linux and macOS**

```sh
bash ./install-mcp.sh --url https://your-dotlo.example
```

**Windows x64 with PowerShell**

```powershell
.\install-mcp.ps1 -Url https://your-dotlo.example
```

Replace the URL with your Dotlo instance. The installer prompts for the URL if you omit it. Enter the pairing code shown in the terminal in your browser and confirm access with your passkey.

The installer detects and configures Codex, Claude Code, Cursor, Claude Desktop, and VS Code when available. Claude Code and VS Code must be available on your command path. Select only Codex with `--agent codex` or `-Agent codex`. Restart the AI client after setup.

With Rust installed, you can build from the checkout using `bash scripts/install-mcp.sh --from-source` or `.\scripts\install-mcp.ps1 -FromSource`.

| Option or command | Use |
| --- | --- |
| `--read-only` | Allow domain and DNS lookups only. Reauthorize an existing connection with `dotlo-mcp login --read-only`. |
| `--no-browser` | Print the authorization URL for pairing from a separate browser. |
| `dotlo-mcp status` | Check the current connection. |
| `dotlo-mcp logout` | Revoke access. You can also revoke it from **MCP connections** in your web account. |
| `DOTLO_MCP_HOME` | Set the credential directory. Use the same absolute path for the terminal and MCP client. |

For manual client setup, point the MCP command at the binary's absolute path with arguments `["serve"]`, then run `dotlo-mcp login --url https://your-dotlo.example`. Connections expire after 30 days.

Self-hosted instances need the `0004_mcp_authorizations.sql` migration and the MCP-enabled Worker and frontend. Use `http://localhost:5173` for local pairing. The `mcp.yml` workflow in MCP-enabled checkouts builds binaries and publishes releases for `mcp-v*` tags.

## Build and Deployment

| Command | Result |
| --- | --- |
| `pnpm build` | Type-checks the project and builds the PWA into `dist/client`. |
| `pnpm check:worker` | Runs a Wrangler dry run and bundles the Worker into `dist/worker`. |
| `pnpm icons` | Regenerates the PWA PNG icons in `public/`. |
| `pnpm db:migrate:remote` | Applies pending migrations to the configured remote D1 database. |

The [Build workflow](.github/workflows/build.yml) runs for pushes to `main`, pull requests, and manual runs. Download the Worker and PWA from the successful run's `dotlo-build` artifact. Deploy the artifact separately after applying any pending migrations.

### Runtime Configuration

| Setting | Purpose |
| --- | --- |
| `DB` | Set the D1 database ID in `wrangler.jsonc`. |
| `ORIGINS` and `RP_ID` | Set allowed origins as a comma-separated list and the passkey relying-party ID. They default to the request origin and its hostname. Serve the production frontend and API from the same HTTPS origin. |
| `ADMIN_USERNAMES` | Grants administrator access to matching usernames at registration. Create the initial administrator accounts before opening public registration, then clear the bootstrap list. Use the admin console to manage existing roles. |
| `CF_API_TOKEN` | Add as a Worker secret with Zone Read and DNS Edit permissions scoped to the zones Dotlo manages. Use `CF_MOCK=true` for local simulation. |
| `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` | Configure both to enable human verification for registrations and reports. Store the secret as a Worker secret. |
| `REQUIRE_PWA` | Enabled by default. Set to `false` to make restricted features available in a regular browser window. |

## Friends and Acknowledgments

[![Friend link to Cloudflare][badge-cloudflare]][cloudflare]

Cloudflare makes it practical for a small open-source project like Dotlo to operate a free public service. Workers serves the app and API, D1 takes care of the database, and Cloudflare DNS publishes the records our users create. Thanks to the Cloudflare teams for building developer tools that work well together and for supporting open-source maintainers through programs like [Project Alexandria][alexandria].

## License and Corresponding Source

Dotlo is available under the GNU Affero General Public License version 3 only. See the [full license](LICENSE).

Self-hosted deployments should publish the exact source commit they run. Set `VITE_SOURCE_REPOSITORY` and `VITE_SOURCE_REVISION` to the public GitHub repository URL and full commit SHA when building the frontend. Set the same values in the Worker's `SOURCE_REPOSITORY` and `SOURCE_REVISION` variables. The [About page][about], footer, and API response headers provide corresponding-source links.

[app]: https://app.dotlo.org/
[about]: https://app.dotlo.org/about
[releases]: https://github.com/dolot-org/dolot/releases
[workers]: https://developers.cloudflare.com/workers/
[d1]: https://developers.cloudflare.com/d1/
[dns]: https://developers.cloudflare.com/dns/
[react]: https://react.dev/
[typescript]: https://www.typescriptlang.org/
[vite]: https://vite.dev/
[pnpm]: https://pnpm.io/
[cloudflare]: https://www.cloudflare.com/
[alexandria]: https://www.cloudflare.com/lp/project-alexandria/
[badge-app]: https://img.shields.io/badge/Dotlo-Open_App-2947D1?style=for-the-badge
[badge-license]: https://img.shields.io/badge/License-AGPLv3-315B45?style=for-the-badge
[badge-build]: https://img.shields.io/github/actions/workflow/status/dolot-org/dolot/build.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=Build
[badge-releases]: https://img.shields.io/badge/GitHub-Releases-24292F?style=for-the-badge&logo=github&logoColor=white
[badge-workers]: https://img.shields.io/badge/Cloudflare-Workers-B44E12?style=for-the-badge&logo=cloudflare&logoColor=white
[badge-d1]: https://img.shields.io/badge/Cloudflare-D1-B44E12?style=for-the-badge&logo=cloudflare&logoColor=white
[badge-dns]: https://img.shields.io/badge/Cloudflare-DNS-B44E12?style=for-the-badge&logo=cloudflare&logoColor=white
[badge-passkeys]: https://img.shields.io/badge/Authentication-Passkeys-324E76?style=for-the-badge
[badge-react]: https://img.shields.io/badge/Frontend-React-054F66?style=for-the-badge&logo=react&logoColor=white
[badge-typescript]: https://img.shields.io/badge/Language-TypeScript-235A97?style=for-the-badge&logo=typescript&logoColor=white
[badge-vite]: https://img.shields.io/badge/Bundler-Vite-5336B3?style=for-the-badge&logo=vite&logoColor=white
[badge-pnpm]: https://img.shields.io/badge/Packages-pnpm-76510B?style=for-the-badge&logo=pnpm&logoColor=white
[badge-mcp]: https://img.shields.io/badge/MCP-Rust-774330?style=for-the-badge&logo=rust&logoColor=white
[badge-cloudflare]: https://img.shields.io/badge/Friend_Link-Cloudflare-B44E12?style=for-the-badge&logo=cloudflare&logoColor=white
