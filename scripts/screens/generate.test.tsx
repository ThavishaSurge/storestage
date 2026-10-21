/**
 * Renders every admin screen to static HTML for marketing screenshots.
 *
 *   npx vitest run --config vitest.screens.config.ts
 *
 * The page content is the real route components fed with data produced by the real merge
 * engine, so what you see is what the product renders. Only the Shopify admin chrome and the
 * Polaris web components are stand-ins (see shell.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { mergeThemeFile } from "../../app/lib/theme/compare";
import { lineDiff } from "../../app/lib/merge/lineDiff";
import { SHELL_CSS, shell } from "./shell";

const state = vi.hoisted(() => ({ loaderData: undefined as unknown, fetcherData: undefined as unknown, params: new URLSearchParams() }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const fetcher = () => ({
    state: "idle",
    data: state.fetcherData,
    formData: undefined,
    Form: (props: Record<string, unknown>) => <form {...(props as object)} />,
    submit: () => {},
    load: () => {},
  });
  return {
    ...actual,
    useLoaderData: () => state.loaderData,
    useFetcher: fetcher,
    useRevalidator: () => ({ revalidate: () => {}, state: "idle" }),
    useSearchParams: () => [state.params, () => {}],
    Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
      <a href={to} className={className}>
        {children as never}
      </a>
    ),
  };
});

vi.mock("../../app/shopify.server", () => ({ default: {}, authenticate: {}, unauthenticated: {}, login: null }));
vi.mock("../../app/db.server", () => ({ default: {} }));

function render(element: ReactElement, loaderData: unknown, fetcherData?: unknown, params = "") {
  state.loaderData = loaderData;
  state.fetcherData = fetcherData;
  state.params = new URLSearchParams(params);
  return renderToString(element);
}

// --------------------------------------------------------------------------
// Fixtures: a redesign of Dawn while the merchant ran a Black Friday campaign
// --------------------------------------------------------------------------

const ts = (d: string) => new Date(d).toISOString();

const themes = [
  { id: "gid://shopify/OnlineStoreTheme/901", name: "Dawn", role: "MAIN", createdAt: ts("2026-03-04"), updatedAt: ts("2026-10-18T14:20:00Z"), processing: false },
  { id: "gid://shopify/OnlineStoreTheme/944", name: "Dawn — 2026 redesign", role: "UNPUBLISHED", createdAt: ts("2026-10-02"), updatedAt: ts("2026-10-18T09:40:00Z"), processing: false },
  { id: "gid://shopify/OnlineStoreTheme/938", name: "Dawn — holiday promo", role: "UNPUBLISHED", createdAt: ts("2026-09-21"), updatedAt: ts("2026-10-05T11:02:00Z"), processing: false },
  { id: "gid://shopify/OnlineStoreTheme/855", name: "Dawn (pre-migration backup)", role: "ARCHIVED", createdAt: ts("2026-02-11"), updatedAt: ts("2026-02-11"), processing: false },
];

const themeJson = (sections: Record<string, unknown>, order: string[]) =>
  `/*\n * IMPORTANT: The contents of this file are auto-generated.\n */\n${JSON.stringify({ sections, order }, null, 2)}\n`;

const BASE_INDEX = themeJson(
  {
    hero: { type: "image-banner", settings: { heading: "New season", button_label: "Shop now" } },
    featured: { type: "featured-collection", settings: { collection: "new-in", products_to_show: 4 } },
  },
  ["hero", "featured"],
);
// The merchant edited the live theme in the theme editor during the campaign.
const LIVE_INDEX = themeJson(
  {
    hero: { type: "image-banner", settings: { heading: "Black Friday — up to 40% off", button_label: "Shop the sale" } },
    featured: { type: "featured-collection", settings: { collection: "new-in", products_to_show: 6 } },
    countdown: { type: "countdown-timer", settings: { ends_at: "2026-11-29" } },
  },
  ["hero", "countdown", "featured"],
);
// Meanwhile the agency rebuilt the hero and added a reviews section on the copy.
const COPY_INDEX = themeJson(
  {
    hero: { type: "image-banner-v2", settings: { heading: "New season essentials", button_label: "Shop now", layout: "split" } },
    featured: { type: "featured-collection", settings: { collection: "new-in", products_to_show: 8 } },
    reviews: { type: "product-reviews", settings: { source: "judge-me" } },
  },
  ["hero", "featured", "reviews"],
);

const CSS_HEAD = [
  "/* Product card */",
  ".card-grid { display: grid; gap: 16px; grid-template-columns: repeat(4, 1fr); }",
  "",
];
const CSS_TAIL = [
  "",
  ".card__price { font-variant-numeric: tabular-nums; }",
  ".card__media { aspect-ratio: 1 / 1; object-fit: cover; }",
  "",
];
const BASE_CSS = [...CSS_HEAD, ".card { border-radius: 8px; padding: 16px; }", ...CSS_TAIL].join("\n");
// Live: the merchant's developer tightened the card for the campaign banner.
const LIVE_CSS = [...CSS_HEAD, ".card { border-radius: 8px; padding: 12px; background: #fff8f0; }", ...CSS_TAIL].join("\n");
// Copy: the redesign restyled the same rule.
const COPY_CSS = [...CSS_HEAD, ".card { border-radius: 14px; padding: 24px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }", ...CSS_TAIL].join("\n");

const jsonMerge = mergeThemeFile({ kind: "json", base: BASE_INDEX, live: LIVE_INDEX, target: COPY_INDEX });
const textMerge = mergeThemeFile({ kind: "text", base: BASE_CSS, live: LIVE_CSS, target: COPY_CSS });

const mergeHeader = {
  id: "m_4kz19",
  liveThemeName: "Dawn",
  targetThemeName: "Dawn — 2026 redesign",
  mode: "three-way",
  status: "ready",
  jobId: "j_1",
  forkTime: ts("2026-10-02T10:00:00Z"),
  createdAt: ts("2026-10-18T15:05:00Z"),
  appliedAt: null as string | null,
  summary: {
    counts: { unchanged: 284, "live-changed": 3, "target-changed": 11, "both-same": 1, "auto-merged": 4, conflict: 2 },
    unresolved: 2,
    total: 305,
  },
};

const mergeFiles = [
  { filename: "templates/index.json", kind: "json", status: "conflict", reason: "Changed on both sides.", resolution: "merged", resolved: false, conflictCount: 2, presence: { base: true, live: true, target: true } },
  { filename: "assets/base.css", kind: "text", status: "conflict", reason: "Changed on both sides.", resolution: "merged", resolved: false, conflictCount: 1, presence: { base: true, live: true, target: true } },
  { filename: "config/settings_data.json", kind: "json", status: "auto-merged", reason: "Merged key by key.", resolution: "merged", resolved: true, conflictCount: 0, presence: { base: true, live: true, target: true } },
  { filename: "sections/header.liquid", kind: "text", status: "target-changed", reason: "Only the working copy changed it.", resolution: "keep", resolved: true, conflictCount: 0, presence: { base: true, live: true, target: true } },
  { filename: "layout/theme.liquid", kind: "text", status: "live-changed", reason: "Only the live theme changed it — analytics snippet added.", resolution: "live", resolved: true, conflictCount: 0, presence: { base: true, live: true, target: true } },
  { filename: "sections/countdown-timer.liquid", kind: "text", status: "live-changed", reason: "Added on live during the campaign.", resolution: "live", resolved: true, conflictCount: 0, presence: { base: false, live: true, target: false } },
  { filename: "sections/product-reviews.liquid", kind: "text", status: "target-changed", reason: "Added in the working copy.", resolution: "keep", resolved: true, conflictCount: 0, presence: { base: false, live: false, target: true } },
  { filename: "assets/logo.png", kind: "binary", status: "target-changed", reason: "Binary file — replaced in the working copy.", resolution: "keep", resolved: true, conflictCount: 0, presence: { base: true, live: true, target: true } },
];

// --------------------------------------------------------------------------

const OUT = path.resolve(__dirname, "../../build/screens");

const screens: { slug: string; title: string; caption: string; url: string; nav: string; html: string }[] = [];

async function screen(args: { slug: string; title: string; caption: string; url: string; nav: string; route: string; data: unknown; fetcher?: unknown; params?: string }) {
  const { default: Page } = (await import(args.route)) as { default: () => ReactElement };
  screens.push({
    slug: args.slug,
    title: args.title,
    caption: args.caption,
    url: args.url,
    nav: args.nav,
    html: shell({ title: args.title, url: args.url, nav: args.nav, body: render(<Page />, args.data, args.fetcher, args.params ?? ""), appCss: "" }),
  });
}

it("renders every screen", async () => {
  await screen({
    slug: "01-overview",
    title: "Overview",
    caption: "What the app does, and every merge you have run.",
    url: "admin.shopify.com/store/your-store/apps/thememerge",
    nav: "Overview",
    route: "../../app/routes/app._index",
    data: {
      shop: "your-store.myshopify.com",
      merges: [
        { id: "m_4kz19", liveThemeName: "Dawn", targetThemeName: "Dawn — 2026 redesign", status: "ready", createdAt: ts("2026-10-18T15:05:00Z") },
        { id: "m_3ab02", liveThemeName: "Dawn", targetThemeName: "Dawn — holiday promo", status: "applied", createdAt: ts("2026-10-05T11:30:00Z") },
      ],
      workingCopies: 2,
      flags: { themeWrites: true },
    },
  });

  await screen({
    slug: "02-compare",
    title: "Pick two themes",
    caption: "Live theme, working copy, and the baseline that makes it a three-way merge.",
    url: "admin.shopify.com/store/your-store/apps/thememerge/themes",
    nav: "Compare themes",
    route: "../../app/routes/app.themes._index",
    data: {
      themes,
      snapshots: [
        { id: "s1", themeId: themes[0].id, themeName: "Dawn", reason: "working-copy", label: "Baseline for Dawn — 2026 redesign", createdAt: ts("2026-10-02T10:00:00Z"), files: 305 },
        { id: "s2", themeId: themes[1].id, themeName: "Dawn — 2026 redesign", reason: "pre-apply", label: "Before merge m_3ab02", createdAt: ts("2026-10-05T11:28:00Z"), files: 305 },
      ],
      merges: [
        { id: "m_4kz19", liveThemeName: "Dawn", targetThemeName: "Dawn — 2026 redesign", status: "ready", mode: "three-way", summary: { unresolved: 2, counts: { conflict: 2, "auto-merged": 4 } }, createdAt: ts("2026-10-18T15:05:00Z") },
        { id: "m_3ab02", liveThemeName: "Dawn", targetThemeName: "Dawn — holiday promo", status: "applied", mode: "three-way", summary: { unresolved: 0, counts: { conflict: 0, "auto-merged": 2 } }, createdAt: ts("2026-10-05T11:30:00Z") },
      ],
      links: [{ workingThemeId: themes[1].id, sourceThemeId: themes[0].id, baselineSnapshotId: "s1" }],
      writesEnabled: true,
    },
  });

  await screen({
    slug: "03-merge-review",
    title: "Review the merge",
    caption: "Every changed file, classified. Only genuine conflicts need a decision.",
    url: "admin.shopify.com/store/your-store/apps/thememerge/themes/merge/m_4kz19",
    nav: "Compare themes",
    route: "../../app/routes/app.themes.merge.$id._index",
    data: { merge: mergeHeader, files: mergeFiles, applyJob: null, writesEnabled: true },
    params: "filter=all",
  });

  await screen({
    slug: "04-json-conflict",
    title: "Resolve a theme-editor conflict",
    caption: "templates/index.json merged key by key — the client's countdown section and your new reviews section both survive.",
    url: "admin.shopify.com/store/your-store/apps/thememerge/themes/merge/m_4kz19/file?f=templates/index.json",
    nav: "Compare themes",
    route: "../../app/routes/app.themes.merge.$id.file",
    data: {
      merge: { id: "m_4kz19", liveThemeName: "Dawn", targetThemeName: "Dawn — 2026 redesign", status: "ready" },
      file: { filename: "templates/index.json", kind: "json", status: "conflict", reason: "Changed on both sides.", resolution: "merged", resolved: false, presence: { base: true, live: true, target: true }, hasBase: true, text: true },
      diffs: {
        liveVsTarget: lineDiff(LIVE_INDEX, COPY_INDEX),
        baseVsLive: lineDiff(BASE_INDEX, LIVE_INDEX),
        baseVsTarget: lineDiff(BASE_INDEX, COPY_INDEX),
        resultVsTarget: lineDiff(COPY_INDEX, jsonMerge.resultBody),
      },
      mergeData: jsonMerge.data,
      resultBody: jsonMerge.resultBody,
    },
  });

  await screen({
    slug: "05-text-conflict",
    title: "Resolve a Liquid/CSS conflict",
    caption: "assets/base.css merged line by line, hunk by hunk, with the live and working-copy versions side by side.",
    url: "admin.shopify.com/store/your-store/apps/thememerge/themes/merge/m_4kz19/file?f=assets/base.css",
    nav: "Compare themes",
    route: "../../app/routes/app.themes.merge.$id.file",
    data: {
      merge: { id: "m_4kz19", liveThemeName: "Dawn", targetThemeName: "Dawn — 2026 redesign", status: "ready" },
      file: { filename: "assets/base.css", kind: "text", status: "conflict", reason: "Changed on both sides.", resolution: "merged", resolved: false, presence: { base: true, live: true, target: true }, hasBase: true, text: true },
      diffs: {
        liveVsTarget: lineDiff(LIVE_CSS, COPY_CSS),
        baseVsLive: lineDiff(BASE_CSS, LIVE_CSS),
        baseVsTarget: lineDiff(BASE_CSS, COPY_CSS),
        resultVsTarget: lineDiff(COPY_CSS, textMerge.resultBody),
      },
      mergeData: textMerge.data,
      resultBody: textMerge.resultBody,
    },
  });

  await screen({
    slug: "06-ready-to-ship",
    title: "Everything decided",
    caption: "Download the full merged theme, or write it into a new theme — the live theme is never touched.",
    url: "admin.shopify.com/store/your-store/apps/thememerge/themes/merge/m_4kz19",
    nav: "Compare themes",
    route: "../../app/routes/app.themes.merge.$id._index",
    data: {
      merge: { ...mergeHeader, summary: { ...mergeHeader.summary, unresolved: 0 } },
      files: mergeFiles.map((f) => ({ ...f, resolved: true, conflictCount: 0, status: f.status === "conflict" ? "auto-merged" : f.status })),
      applyJob: null,
      writesEnabled: true,
    },
    params: "filter=all",
  });

  await screen({
    slug: "07-merged-theme-created",
    title: "Merged theme created",
    caption: "A new unpublished theme containing the merged result, ready to preview and publish.",
    url: "admin.shopify.com/store/your-store/apps/thememerge/themes/merge/m_4kz19",
    nav: "Compare themes",
    route: "../../app/routes/app.themes.merge.$id._index",
    data: {
      merge: { ...mergeHeader, status: "applied", appliedAt: ts("2026-10-18T15:42:00Z"), summary: { ...mergeHeader.summary, unresolved: 0 } },
      files: mergeFiles.map((f) => ({ ...f, resolved: true, conflictCount: 0, status: f.status === "conflict" ? "auto-merged" : f.status })),
      applyJob: { id: "j_9", status: "done", result: { themeId: "gid://shopify/OnlineStoreTheme/971", themeName: "Dawn — 2026 redesign merged 2026-10-18", written: 18, deleted: 0 }, error: null },
      writesEnabled: true,
    },
    params: "filter=all",
  });

  fs.mkdirSync(OUT, { recursive: true });
  const appCss = fs.readFileSync(path.resolve(__dirname, "../../app/styles/app.css"), "utf8");
  fs.writeFileSync(path.join(OUT, "screens.json"), JSON.stringify({ screens, css: SHELL_CSS + "\n" + appCss }, null, 2));
  for (const s of screens) {
    fs.writeFileSync(
      path.join(OUT, `${s.slug}.html`),
      `<!doctype html><html><head><meta charset="utf-8"><title>${s.title}</title><style>${SHELL_CSS}\n${appCss}</style></head><body>${s.html}</body></html>`,
    );
  }
  console.log(`wrote ${screens.length} screens to ${OUT}`);
});
