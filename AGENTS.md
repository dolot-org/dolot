# Repository Guidelines

## Project Structure

Dotlo is a DNS management PWA with a React frontend and a Hono API on Cloudflare Workers. `src/shared/` contains API types, DNS validation, and Chinese and English messages. `src/worker/env.ts` defines Worker bindings and database row types. `src/worker/lib/` handles Passkeys, sessions, DNS updates, auditing, and scheduled maintenance. `migrations/` contains numbered D1 SQL migrations, starting with `0001_init.sql`.

See `HANDOFF.md` for the scaffold status and planned locations for the Worker routes, React code in `src/client/`, and PWA assets in `public/`. Vite writes client assets to `dist/client`.

## Build and Development

- `pnpm install --frozen-lockfile` installs the locked dependencies. Use the pnpm version in `package.json`.
- `pnpm db:migrate:local` applies migrations to the local D1 database.
- `pnpm dev:api` starts Wrangler on port 8787. In another terminal, `pnpm dev` starts Vite and proxies `/api` to Wrangler. Both need their entry points in place.
- `pnpm build` runs TypeScript checks and builds the Vite client. `pnpm check:worker` packages the Worker without deploying. Use daumhost for full builds and type checks.

## Coding Style

Use strict TypeScript, two-space indentation, single quotes, and semicolons. Follow existing naming patterns with camelCase for functions and API fields, PascalCase for types, and snake_case for database columns. Reuse DNS validation in `src/shared/dns.ts` and update both language catalogs in `src/shared/messages.ts` when adding message codes.

## Testing and Configuration

The scaffold has no configured test runner or coverage target. For behavior changes, verify one affected scenario. For example, exercise DNS record validation against local D1 with `CF_MOCK=true`. Use `.dev.vars.example` as the local configuration reference and keep credentials outside the checkout.

## Commits and Pull Requests

This checkout has no Git history to establish a commit convention. Use short, imperative commit subjects. Summarize behavior changes and verification in pull requests, link related issues when available, and include screenshots for visible UI changes.
