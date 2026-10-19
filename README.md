# StoreStage

A Shopify app for staging changes safely.

- **Theme Compare** (single store): the client edited the live theme while you worked on a copy. StoreStage finds every file
  either side changed, merges theme-editor JSON (`templates/*.json`, section groups, `settings_data.json`) key by key, merges
  Liquid/CSS/JS line by line, and leaves only the real conflicts for you to decide. Then it writes the result into your copy
  (or gives you a zip to push with Shopify CLI).
- **Staging** (two stores): pair a staging store with the live store, clone live into staging, make changes there, review a
  three-way diff (staging vs live vs the clone baseline), and promote only what you approve. Client edits on live are never
  overwritten silently. Every promotion takes a pre-push snapshot and can be rolled back. Store-level settings
  (currency, tax, units, order numbering, policies…) are compared read-only, since apps can't change most of them.

Built on Shopify's official React Router app template, Admin GraphQL API **2026-10**.

---

## Quick start

Prerequisites: Node 22.12+, [Shopify CLI](https://shopify.dev/docs/apps/tools/cli), a Partner account, and two development
stores if you want to try Staging.

```bash
npm install
npm run config:link      # create or link the app in your Partner/Dev Dashboard (fills client_id in shopify.app.toml)
npm run dev              # runs migrations, starts the app, opens the install URL for your dev store
```

To use **Staging**, install the app on the second store as well (Dev Dashboard → your app → Test on development store, or
switch stores with `shopify app dev --reset`). Then open **Staging** in one store, generate a pairing code, and enter it in
the other.

Environment variables (set them in `.env` or your host):

| Variable | Default | What it does |
| --- | --- | --- |
| `THEME_WRITES_ENABLED` | off | Allows theme duplication and theme file writes. Leave off until Shopify grants the exemption (below). |
| `PUBLISH_CREATED_TO_ONLINE_STORE` | `true` | Publish products/collections that a promotion *creates* on live to the Online Store channel. |

## Theme writes need a Shopify exemption

Reading theme files works with `read_themes`. **Writing** them (`themeFilesUpsert`, `themeFilesDelete`) requires
`write_themes` *plus* Shopify's "Online Store protected scope" exemption, which is reviewed per app (dev, staging and
production apps each need their own request). Shopify says it responds within two weeks.

StoreStage fits two listed categories: *developer tooling and testing* and *backups* (it snapshots themes before every
write and can restore). A draft of the request is in [`docs/theme-exemption-request.md`](docs/theme-exemption-request.md).

Until it's granted, everything still works except the "Apply" buttons: compare, decide, then **Download merged files** —
the zip contains the files in theme layout plus `MERGE-REPORT.md` with the exact `shopify theme push --only …` command.
Without the exemption, also duplicate themes in the Shopify admin and click **Record baseline** right after, so later
merges are three-way.

## How it works

### Theme Compare

1. You pick the **live** theme (has client edits) and the **working copy** (to publish).
2. If the copy was made by StoreStage, or you recorded a baseline when you duplicated it, the merge is **three-way**:
   StoreStage knows exactly what each side changed since the fork. Otherwise it falls back to **timestamps** (anything
   edited after the copy's `createdAt` counts as changed on that side).
3. Per file: changed only on live → take live; changed only in the copy → keep; changed on both → merge
   (JSON structurally, text with diff3). Ordered arrays like a template's `order` or a section's `block_order` merge as
   ordered sets, so a section the client added and a section you added both survive.
4. You resolve what's left per conflict (live / copy / both), per file, or by editing the result by hand.
5. **Apply** snapshots the working copy (for rollback) and writes the merged files. The live theme is never written.

### Staging

```
          clone (baseline)                         promote (selected changes)
  LIVE ───────────────────────▶ STAGING ── edits ──▶ three-way diff ──────────────▶ LIVE
    ▲                                                     │
    └── client edits (drift) ────── shown, never overwritten
```

- **Portable references.** Every Shopify GID is store-specific. Before comparing, StoreStage replaces each GID with a
  placeholder built from the referenced resource's natural key (`@@ref:product:linen-shirt@@`), including inside metafield
  values, menu items, collection membership and metafield-definition validations. On write, placeholders become the
  target store's GIDs. That's what makes a menu cloned to staging point at staging's collections, and a metaobject
  reference promoted to live point at live's metaobject.
- **Natural keys.** Products, collections, pages, blogs, menus: handle. Articles: `blog/handle`. Metaobjects:
  `type/handle`. Redirects: path. Metafield definitions: `OWNER:namespace.key`. Files: CDN filename (Shopify's duplicate
  suffix removed). Variants: option values.
- **Three-way diff.** For each resource: changed only on staging → promotable; changed only on live → drift (info only);
  changed on both → field-level merge, clashing fields become conflicts you decide (keep live / use staging).
- **Safe promotion.** Live is re-read right before writing; anything that changed since the comparison is skipped with an
  explanation. A pre-push snapshot is saved, writes run in dependency order (definitions → files → metaobjects → products
  → collections → content → menus → redirects; deletes last, in reverse), variants and media are updated in place, and the
  baseline advances so promoted changes don't show up again.
- **Rollback** restores updated resources from the pre-push snapshot, deletes resources the promotion created, and
  recreates ones it deleted.
- **Themes across stores** reuse the Theme Compare engine with the clone-time theme snapshot as the baseline. Applying
  duplicates live's published theme and writes the merged result into the duplicate. You preview and publish it.

### What's synced

| Synced | Not synced (by design or not yet) |
| --- | --- |
| Products (options, variants, prices, SKUs, barcodes, media, metafields) | Orders, customers, inventory levels |
| Collections (manual membership and smart rules), pages, blogs, blog posts | Discounts, markets, translations, shipping, taxes |
| Navigation menus, URL redirects, files | Store settings (compared read-only), payment/checkout, notifications |
| Metafield definitions, metaobject definitions, metaobjects | Variant metafields, app-owned metafields/metaobjects |
| Published theme (via theme merge) | Third-party app configuration |

## Project layout

```
app/
  lib/                     Pure logic, no I/O — unit tested
    merge/json3.ts         Three-way JSON merge (ordered-set arrays, conflict paths, decisions)
    merge/text3.ts         diff3 text merge, two-way hunk picking, conflict markers
    theme/compare.ts       Theme file classification (three-way / timestamp), file merge, write plans
    resources/             Store resources: normalizers, portable refs, three-way diff, mutation builders
    shopify/               GraphQL documents (validated against the 2026-10 schema)
  services/                Server side: Shopify client wrapper, jobs, snapshots, theme merges, staging, pairing
  routes/                  Embedded admin UI (Polaris web components) and webhooks
prisma/                    Schema + migrations (SQLite by default)
test/                      Fake Shopify Admin API + end-to-end workflow tests
docs/                      Exemption request draft
```

Long operations (theme analysis, clone, compare, promote, rollback) run as **jobs** stored in the database and executed by
an in-process worker (`app/services/jobs.server.ts`). The UI polls job progress. For more than one app instance, swap the
worker for a real queue; handler signatures stay the same.

## Development

```bash
npm run check             # typecheck + GraphQL validation + all tests
npm test                  # unit, end-to-end (simulated Shopify) and page render tests
npm run validate:graphql  # every #graphql document vs the Admin API 2026-10 schema (.schema/*.gz)
npm run build
```

The end-to-end suite (`test/integration`) pairs two simulated stores, clones, edits both sides, compares, resolves a
conflict, promotes, checks the staleness guard, rolls back, and runs both theme flows — against a real SQLite database
created from the committed migrations.

## Status and known limitations

**Verified:** typecheck, lint, production build; all GraphQL validated against the 2026-10 schema; 58 tests — unit,
end-to-end against a simulated Admin API, and server-rendering of every admin page. **Not yet verified against real stores** — do the first-run checklist below on two
development stores before using it on a client.

First-run checklist:
1. Theme Compare on one store: duplicate the theme, record the baseline, edit both, compare, download the zip.
2. Pair two dev stores, clone with a handful of products, check staging (variants, images, menus, metaobject references).
3. Edit staging and live, compare, promote two or three items, check live, roll back.
4. Once the exemption is granted: `THEME_WRITES_ENABLED=true`, apply a theme merge, and a cross-store theme promotion.

Known limitations / next steps:
- **Collections** use `ruleSet`, `collectionAddProducts` and `collectionRemoveProducts`, which are deprecated in 2026-10
  in favour of the new collection `sources` model. They still work in this version; migrate before upgrading the API.
- Variant barcodes are read through the deprecated `barcode` field to keep query cost down.
- Manual collections: the first 250 products are compared. Products: >50 variants are paged in automatically.
- Large catalogs are read with paginated queries (a few products per request). For many thousands of products, switch
  reads to bulk operations.
- Metaobject fields cleared on staging aren't cleared on live (values are upserted, not removed).
- Rollback recreates deleted resources with new GIDs; references to them elsewhere aren't restored.
- SQLite is fine for development. Use Postgres in production (theme snapshots store full text bodies).
