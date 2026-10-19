# StoreStage — notes for coding agents

Shopify embedded app (React Router 7 template, Polaris web components, Prisma/Postgres, Admin GraphQL 2026-10).
Read README.md for the product; this file is the working map.

## Commands

- `npm run check` — typecheck + GraphQL validation + all tests. Run before finishing any change.
- `npm test` — vitest: unit tests in `app/**/*.test.ts`, end-to-end flows in `test/integration` (fake Shopify, real Postgres
  in-process via PGlite — no database server needed).
- `npm run validate:graphql` — validates every `` `#graphql` `` template literal in `app/` against `.schema/admin-2026-10.json.gz`.
  Documents must not use `${}` interpolation (the validator skips them).
- `npm run dev` — `shopify app dev`.

## Architecture rules

- `app/lib/**` is pure (no I/O, no `.server` imports) and must stay unit-testable. Put merge/diff/normalize/build logic here.
- `app/services/*.server.ts` own all Shopify and database access. Never import them from a route component's render path —
  only from `loader`/`action` (Vite will fail the build otherwise).
- Long work goes through jobs: `registerJobHandler(type, fn)` in the service module, `enqueueJob()` from actions,
  `<JobProgress jobId>` in the UI. Handlers get a shop-scoped context; use `adminForShop(shop)` for Shopify access.
- All Shopify calls go through `gql()` in `services/admin.server.ts` (throttling, typed userErrors, ACCESS_DENIED → `ShopifyAccessError`).
- Theme writes must call `requireWrites()` (via the helpers in `services/themes.server.ts`) and never target the MAIN theme.

## Adding a synced resource type

1. Add the type to `RESOURCE_TYPES` (dependency order matters) and `RESOURCE_LABELS` in `lib/resources/types.ts`.
2. Query + raw type in `lib/shopify/queries.ts`; mutations in `lib/shopify/mutations.ts`.
3. Normalizer in `lib/resources/normalize.ts` (natural key, comparable `data`, `transfer` for non-comparable values, `aliases`
   for sub-objects other resources may reference).
4. Builder branch in `lib/resources/build.ts` (create/update/delete).
5. Fetch in `services/storeData.server.ts` (`fetchFull`, and `fetchIndex` if it's referenceable).
6. Handlers in `test/fakes/fakeShopify.ts` and coverage in `test/integration/workflow.test.ts`.

## Gotchas

- GIDs differ per store: compare/store only portable data (`toPortable` / `fromPortable` in `lib/resources/refs.ts`).
- Shopify theme JSON files start with a `/* ... */` comment; use `parseThemeJson` / `serializeThemeJson`.
- Collections still use the deprecated `ruleSet` / `collectionAddProducts` APIs (see README limitations).
- Prisma migrations in `prisma/migrations` are committed SQL; after changing `schema.prisma` run `npx prisma migrate dev`.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for Shopify API and platform work.
