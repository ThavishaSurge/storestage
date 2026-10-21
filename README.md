# ThemeMerge

**Publish your theme without losing the client's edits.**

The client kept editing the live theme while you built a redesign on a copy. Publishing your copy would silently throw
their work away. ThemeMerge finds every file either side changed, merges theme-editor JSON key by key and Liquid, CSS and
JS line by line, and leaves only the real conflicts for you to decide. Then it hands you the merged theme — as a new
theme, a zip you can upload, or written straight into your working copy.

The live theme is never written.

Built on Shopify's official React Router app template, Admin GraphQL API **2026-10**.

---

## Quick start

Prerequisites: Node 22.12+, [Shopify CLI](https://shopify.dev/docs/apps/tools/cli), a Postgres database, a Partner
account, and a development store. Set `DATABASE_URL` before running anything (see `.env`).

```bash
npm install
npm run config:link      # create or link the app in your Partner/Dev Dashboard (fills client_id in shopify.app.toml)
npm run dev              # runs migrations, starts the app, opens the install URL for your dev store
```

Environment variables (set them in `.env` or your host):

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | — | Postgres connection string. Required. |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | — | App credentials from the Dev Dashboard. |
| `SHOPIFY_APP_URL` | — | Public HTTPS URL of the deployment, no trailing slash. |
| `THEME_WRITES_ENABLED` | off | Allows theme duplication and theme file writes. Leave off until Shopify grants the exemption (below). |
| `SHOPIFY_APP_HANDLE` | — | App handle, used to link to Shopify's hosted pricing page. Without it the upgrade link falls back to the store's apps settings. |

## Plans

Two plans, sold through Shopify **Managed Pricing** — the tiers are configured in the Partner
Dashboard and Shopify owns the checkout, plan changes and proration. The app only reads the
resulting subscription (`currentAppInstallation.activeSubscriptions`) and maps its name onto a
plan: any active subscription whose name contains "Pro" is Pro, everything else is Free. So the
Dashboard plan can be called "Pro", "ThemeMerge Pro" or "Pro (annual)" without a code change.

| | Free | Pro |
| --- | --- | --- |
| Compare themes (diff view) | Unlimited | Unlimited |
| Merges (analyze + resolve) | 1 per calendar month | Unlimited |
| Apply merge to theme | ✓ | ✓ |
| Download merged zip | — | ✓ |
| Automatic snapshots kept | Newest 3 | 90 days |
| Theme update mode | — | planned |
| One-click restore | — | planned |

Limits live in [`app/lib/billing/plans.ts`](app/lib/billing/plans.ts) — pure, unit-tested, and the
only place to change them. Enforcement is in `services/billing.server.ts`: the merge quota is
checked in `startThemeMerge`, exports in the export route, and retention runs after every
automatic snapshot. **Baselines a working copy still points at are never pruned**, whatever the
plan says — deleting one silently downgrades every later merge of that copy to timestamp
guessing.

Going live checklist:

1. In the Dev Dashboard, enable Managed Pricing and create the two plans. Name the paid one so
   it contains "Pro".
2. Set `SHOPIFY_APP_HANDLE` so the in-app upgrade buttons reach the hosted pricing page.
3. Install on a development store and confirm the Free limits bite: the second merge in a month
   is refused with an upgrade link, and the download buttons are replaced by one.
4. Subscribe to Pro on that store (test charge) and confirm the limits lift.

**Open question before launch:** on Free, Apply is included but Download is not — and Apply is
blocked for every shop until Shopify grants the theme-write exemption. Until that grant lands, a
Free shop can run its one merge but has no way to ship the result. Either include the export on
Free, or hold the Free plan back until the exemption is granted.

## Theme writes need a Shopify exemption

Reading theme files works with `read_themes`. **Writing** them (`themeFilesUpsert`, `themeFilesDelete`, `themeDuplicate`)
requires `write_themes` *plus* Shopify's "Online Store protected scope" exemption, which is reviewed per app (dev,
staging and production apps each need their own request). Shopify says it responds within two weeks.

ThemeMerge fits two listed categories: *developer tooling and testing* and *backups* (it snapshots themes before every
write and can restore). A draft of the request is in [`docs/theme-exemption-request.md`](docs/theme-exemption-request.md).

Until it's granted everything works except the two Apply buttons. Compare, decide, then export:

- **Download full theme** — every file of the merged theme at the root of the zip. Upload it under Online Store → Themes →
  Add theme → Upload zip file and Shopify creates a new unpublished theme to preview and publish, no CLI needed. It reads
  the whole theme (binary assets included), so it takes a while and needs every file decided first.
- **Download changed files** — only the diff, in theme layout, plus `MERGE-REPORT.md` with the exact
  `shopify theme push --only …` command.

Without the exemption, also duplicate themes in the Shopify admin and click **Record baseline** right after, so later
merges are three-way.

## How it works

1. You pick the **live** theme (it has the client's edits) and the **working copy** (the one you want to publish).
2. If the copy was made by ThemeMerge, or you recorded a baseline when you duplicated it, the merge is **three-way**:
   ThemeMerge knows exactly what each side changed since the fork. Otherwise it falls back to **timestamps** (anything
   edited after the copy's `createdAt` counts as changed on that side).
3. Per file: changed only on live → take live; changed only in the copy → keep; changed on both → merge
   (JSON structurally, text with diff3). Ordered arrays like a template's `order` or a section's `block_order` merge as
   ordered sets, so a section the client added and a section you added both survive.
4. You resolve what's left per conflict, per file, or by editing the result by hand.
5. Finish either way: **Apply to working copy** snapshots it first (for rollback) and writes the merged files into it, or
   **Create merged theme** duplicates the working copy and writes the merged result into the duplicate, leaving the
   working copy untouched — preview it, then publish. If the store's 20-theme library is full, the duplicate fails before
   anything is written: delete an old theme and apply again.

## Project layout

```
app/
  lib/                     Pure logic, no I/O — unit tested
    merge/json3.ts         Three-way JSON merge (ordered-set arrays, conflict paths, decisions)
    merge/text3.ts         diff3 text merge, two-way hunk picking, conflict markers
    theme/compare.ts       Theme file classification (three-way / timestamp), file merge, write plans
    shopify/               GraphQL documents (validated against the 2026-10 schema)
  services/                Server side: Shopify client wrapper, jobs, snapshots, theme merges
  routes/                  Embedded admin UI (Polaris web components) and webhooks
prisma/                    Schema + migrations (Postgres)
test/                      Fake Shopify Admin API + end-to-end workflow tests
docs/                      Exemption request draft
```

Long operations (theme analysis, apply) run as **jobs** stored in the database and executed by an in-process worker
(`app/services/jobs.server.ts`). The UI polls job progress. The worker requeues anything left `running` at boot, so run a
single instance of the app; for more than one, swap the worker for a real queue — handler signatures stay the same.

## Brand

The mark is an orange stroke and a blue stroke meeting in one ink stem: the live theme, the working copy, the merged
result. The UI uses the same mapping — orange marks the live side of a conflict, blue the working copy, ink the outcome.

| Token | Hex |
| --- | --- |
| Orange | `#ff7a1a` |
| Blue | `#2f6bff` |
| Ink | `#15161a` |

## Development

```bash
npm run check             # typecheck + GraphQL validation + all tests
npm test                  # unit, end-to-end (simulated Shopify) and page render tests
npm run validate:graphql  # every #graphql document vs the Admin API 2026-10 schema (.schema/*.gz)
npm run build
```

The end-to-end suite (`test/integration`) duplicates a theme, records a baseline, edits both sides, compares, resolves a
conflict, exports, and applies both in place and into a fresh copy — against a real Postgres database created from the
committed migrations, run in-process with PGlite so no database server is needed. Set `DATABASE_URL_TEST` to run the
suite against a real Postgres instead.

## Status and known limitations

**Not yet verified against real stores** — do the first-run checklist below on a development store before using it on a
client.

First-run checklist:
1. Duplicate the live theme, record the baseline, edit both sides, compare, download the full theme zip, upload it.
2. Check the merged theme in the theme editor: section order, settings, and any section the client added.
3. Once the exemption is granted: `THEME_WRITES_ENABLED=true`, then Create merged theme and Apply to working copy.

Known limitations / next steps:
- The full-theme zip reads every file of the theme, downloading binary assets one at a time. On a large theme it is slow;
  move it behind a job with progress if that becomes a problem.
- Shopify's zip upload has a 50 MB limit. For a theme with heavy assets, use the changed-files zip and `shopify theme push`.
- Theme snapshots store full file bodies, so the database grows with every snapshot — prune old ones periodically.
