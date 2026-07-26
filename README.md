# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` defines the `order_history` table (Postgres, via `drizzle-orm/node-postgres`)
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm run start`: run the built app as a plain Node HTTP server (what Render uses)
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run db:migrate`: apply pending migrations to the Postgres database at `DATABASE_URL`

## Deploying to Render

This app's history feature (`/history`, `/api/history`) reads and writes a
Postgres database via `drizzle-orm/node-postgres`, so it needs a real
Postgres instance — Cloudflare D1 does not work outside Cloudflare Workers.

1. Push this repo to GitHub.
2. In Render, create a Blueprint from the repo — it will read
   [`render.yaml`](render.yaml) and provision both the web service and a
   Postgres database, wiring `DATABASE_URL` automatically. (Or create the two
   resources by hand and set `DATABASE_URL` on the web service to the
   Postgres instance's **Internal Database URL**.)
3. That's it — migrations run automatically on startup, so the
   `order_history` table is created on the first boot. No shell access
   needed, which matters because Render's Shell tab is a paid-plan feature.
4. For local development against the same database, add `DATABASE_URL` to a
   git-ignored `.env.local` file.

Migrations are applied by [`db/migrate.mjs`](db/migrate.mjs) using
`drizzle-orm/node-postgres/migrator`, reading the committed SQL in
[`drizzle/`](drizzle/). It deliberately avoids `drizzle-kit` at runtime,
since that's a devDependency and won't be installed when Render builds with
`NODE_ENV=production`. A failed migration is logged but does not block
startup: screenshot analysis works without a database, only `/history` needs
one.

`npm run build` + `npm run start` is a portable Node server (respects
`$PORT`) — it does not depend on Cloudflare Workers, `wrangler`, or the
`worker/index.ts` entry point, which only matters for the separate Cloudflare
Sites deployment path this starter also supports.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle Postgres Guide](https://orm.drizzle.team/docs/get-started/postgresql-new)
