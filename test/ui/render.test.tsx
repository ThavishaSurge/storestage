/**
 * Render smoke tests: every admin page renders with realistic loader data (and its edge states)
 * without throwing. Router hooks are stubbed; Polaris web components render as plain custom tags.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";

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
    Link: ({ to, children }: { to: string; children: unknown }) => <a href={to}>{children as never}</a>,
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

const now = "2026-10-18T03:00:00.000Z";
const themes = [
  { id: "gid://shopify/OnlineStoreTheme/1", name: "Dawn", role: "MAIN", createdAt: now, updatedAt: now, processing: false },
  { id: "gid://shopify/OnlineStoreTheme/2", name: "Dawn redesign", role: "UNPUBLISHED", createdAt: now, updatedAt: now, processing: false },
];

describe("admin pages render", () => {
  it("overview", async () => {
    const { default: Page } = await import("../../app/routes/app._index");
    const html = render(<Page />, {
      shop: "a.myshopify.com",
      pair: { role: "staging", otherShop: "live.myshopify.com", clonedAt: now },
      merges: [{ id: "m1", liveThemeName: "Dawn", targetThemeName: "Redesign", status: "ready", kind: "same-store", createdAt: now }],
      promotions: [{ id: "p1", status: "done", createdAt: now }],
      flags: { themeWrites: false, publishCreated: true },
    });
    expect(html).toContain("live.myshopify.com");
  });

  it("theme compare index (with and without baseline)", async () => {
    const { default: Page } = await import("../../app/routes/app.themes._index");
    const data = {
      themes,
      snapshots: [{ id: "s1", themeId: themes[0].id, themeName: "Dawn", reason: "manual", label: "Before sale", createdAt: now, files: 120 }],
      merges: [{ id: "m1", liveThemeName: "Dawn", targetThemeName: "Dawn redesign", status: "ready", mode: "three-way", summary: { unresolved: 2, counts: {} }, createdAt: now }],
      links: [],
      writesEnabled: false,
    };
    expect(render(<Page />, data)).toContain("No baseline for this pair");
    expect(render(<Page />, { ...data, links: [{ workingThemeId: themes[1].id, sourceThemeId: themes[0].id, baselineSnapshotId: "s1" }] })).toContain("Three-way compare");
    expect(render(<Page />, { ...data, themes: [themes[0]] })).toContain("Theme Compare"); // single theme: nothing to compare against
    expect(render(<Page />, data, { jobId: "j1", label: "Taking snapshot" })).toContain("Starting");
  });

  it("theme merge overview in every state", async () => {
    const { default: Page } = await import("../../app/routes/app.themes.merge.$id._index");
    const merge = {
      id: "m1",
      kind: "same-store",
      liveThemeName: "Dawn",
      targetThemeName: "Dawn redesign",
      liveShop: "a.myshopify.com",
      targetShop: "a.myshopify.com",
      mode: "heuristic",
      status: "ready",
      jobId: "j1",
      forkTime: now,
      createdAt: now,
      appliedAt: null,
      summary: { counts: { "live-changed": 1, "target-changed": 2, "auto-merged": 1, conflict: 1, unchanged: 300 }, unresolved: 1, total: 305 },
    };
    const files = [
      { filename: "config/settings_data.json", kind: "json", status: "conflict", reason: "Changed on both sides.", resolution: "merged", resolved: false, conflictCount: 2, presence: { base: null, live: true, target: true } },
      { filename: "layout/theme.liquid", kind: "text", status: "live-changed", reason: "Edited on live", resolution: "live", resolved: true, conflictCount: 0, presence: { base: null, live: true, target: true } },
      { filename: "snippets/gone.liquid", kind: "text", status: "live-changed", reason: "Deleted on live", resolution: "delete", resolved: true, conflictCount: 0, presence: { base: null, live: false, target: true } },
      { filename: "assets/logo.png", kind: "binary", status: "conflict", reason: "Binary file", resolution: "keep", resolved: false, conflictCount: 1, presence: { base: null, live: true, target: true } },
    ];
    const ready = render(<Page />, { merge, files, applyJob: null, writesEnabled: false });
    expect(ready).toContain("config/settings_data.json");
    expect(ready).toContain("Download changed files");
    expect(ready).toContain("Download full theme");
    // Undecided files: the full-theme zip would contain conflict markers, so it is blocked.
    expect(ready).toContain('title="Resolve every file first"');
    expect(render(<Page />, { merge: { ...merge, status: "analyzing" }, files: [], applyJob: null, writesEnabled: true })).toContain("Analyzing");
    expect(render(<Page />, { merge: { ...merge, status: "applied", appliedAt: now, kind: "cross-store" }, files, applyJob: { id: "j2", status: "done", result: { themeName: "Dawn + staging" }, error: null }, writesEnabled: true })).toContain("Dawn + staging");
    expect(render(<Page />, { merge, files, applyJob: null, writesEnabled: true }, undefined, "filter=conflict")).toContain("assets/logo.png");
  });

  it("theme merge file page (json conflicts, text hunks, binary)", async () => {
    const { default: Page } = await import("../../app/routes/app.themes.merge.$id.file");
    const base = {
      merge: { id: "m1", kind: "same-store", liveThemeName: "Dawn", targetThemeName: "Redesign", status: "ready" },
      diffs: { liveVsTarget: [{ type: "del", text: "a", oldNo: 1, newNo: null }, { type: "add", text: "b", oldNo: null, newNo: 1 }], baseVsLive: null, baseVsTarget: null, resultVsTarget: [] },
      resultBody: "{}",
    };
    const json = render(<Page />, {
      ...base,
      file: { filename: "config/settings_data.json", kind: "json", status: "conflict", reason: "Both", resolution: "merged", resolved: false, presence: { base: true, live: true, target: true }, hasBase: true, text: true },
      mergeData: { mode: "json", header: "", merged: {}, conflicts: [{ path: ["current", "accent"], id: "current.accent", base: "#000", left: "#0f0", right: "#f00", kind: "value" }], decisions: {} },
    });
    expect(json).toContain("current.accent");
    const text = render(<Page />, {
      ...base,
      file: { filename: "layout/theme.liquid", kind: "text", status: "conflict", reason: "Both", resolution: "merged", resolved: false, presence: { base: true, live: true, target: true }, hasBase: true, text: true },
      mergeData: { mode: "text", regions: [{ type: "ok", lines: ["<head>\n"] }, { type: "conflict", id: 0, base: ["x\n"], left: ["live\n"], right: ["dev\n"] }], decisions: { 0: "left" } },
    });
    expect(text).toMatch(/Hunk (<!-- -->)?1/);
    const binary = render(<Page />, {
      ...base,
      diffs: null,
      file: { filename: "assets/logo.png", kind: "binary", status: "conflict", reason: "Binary", resolution: "keep", resolved: false, presence: { base: true, live: true, target: true }, hasBase: true, text: false },
      mergeData: null,
    });
    expect(binary).toContain("Binary assets");
  });

  it("staging: unpaired, code issued, paired", async () => {
    const { default: Page } = await import("../../app/routes/app.staging._index");
    expect(render(<Page />, { shop: "a.myshopify.com", pair: null, code: null })).toContain("Generate code");
    expect(render(<Page />, { shop: "a.myshopify.com", pair: null, code: { code: "ABCD-EFGH", role: "live", expiresAt: now } })).toContain("ABCD-EFGH");
    const paired = render(<Page />, {
      shop: "s.myshopify.com",
      code: null,
      pair: { id: "p", role: "staging", stagingShop: "s.myshopify.com", liveShop: "l.myshopify.com", otherShop: "l.myshopify.com", clonedAt: now, baselineSnapshotId: "b" },
      compares: [{ id: "c1", status: "ready", createdAt: now, jobId: "j", summary: { promotable: 4, byStatus: { conflict: 1 } } }],
      promotions: [{ id: "pr1", status: "partial", createdAt: now, summary: { done: 3, failed: 1 } }],
      cloneJob: { id: "j0", status: "done", error: null, createdAt: now, result: { copied: 10, failed: 1, unchanged: 2, failures: [{ type: "product", key: "x", error: "boom" }], theme: "Theme not copied" } },
      baseline: [{ type: "product", count: 12 }],
      writesEnabled: false,
    });
    expect(paired).toContain("Clone live → staging");
    expect(paired).toContain("boom");
  });

  it("staging compare, item and promotion pages", async () => {
    const pair = { id: "p", role: "staging", stagingShop: "s.myshopify.com", liveShop: "l.myshopify.com", otherShop: "l.myshopify.com", clonedAt: now, baselineSnapshotId: "b" };
    const { default: Compare } = await import("../../app/routes/app.staging.compare.$id");
    const items = [
      { id: "i1", type: "product", key: "linen-shirt", title: "Linen shirt", status: "auto-merged", action: "update", selected: true, conflictCount: 0, undecided: 0 },
      { id: "i2", type: "page", key: "about", title: "About", status: "conflict", action: "update", selected: true, conflictCount: 1, undecided: 1 },
      { id: "i3", type: "metaobject", key: "designer/ana", title: "Ana", status: "live-changed", action: "none", selected: false, conflictCount: 0, undecided: 0 },
    ];
    const compareHtml = render(<Compare />, {
      pair,
      compare: { id: "c1", status: "ready", jobId: "j", createdAt: now },
      summary: { themeMergeId: "m1", themeNote: null, settingsDiff: [{ key: "ianaTimezone", label: "Time zone", staging: "UTC", live: "Europe/Helsinki" }] },
      themeMerge: { id: "m1", status: "ready", mode: "three-way", summary: { unresolved: 0, counts: { "target-changed": 2 } } },
      items,
    });
    expect(compareHtml).toContain("Linen shirt");
    expect(compareHtml).toContain("Europe/Helsinki");
    expect(compareHtml).toContain("conflicts to decide");
    expect(render(<Compare />, { pair, compare: { id: "c1", status: "running", jobId: "j", createdAt: now }, summary: null, themeMerge: null, items: [] })).toContain("Comparing stores");

    const { default: Item } = await import("../../app/routes/app.staging.item.$id");
    expect(
      render(<Item />, {
        pair,
        item: { id: "i2", compareId: "c1", type: "page", key: "about", title: "About", status: "conflict", action: "update", selected: true },
        conflicts: [{ path: ["body"], id: "body", base: "<p>a</p>", left: "<p>client</p>", right: "<p>staging</p>", kind: "value" }],
        decisions: {},
        willChangeLive: [],
        stagingChanges: [],
        liveChanges: [],
      }),
    ).toContain("Keep live");

    const { default: Promotion } = await import("../../app/routes/app.staging.promotion.$id");
    expect(
      render(<Promotion />, {
        pair,
        promotion: { id: "pr1", compareId: "c1", status: "done", jobId: "j", createdAt: now, finishedAt: now },
        items: [{ id: "x", type: "product", key: "linen-shirt", title: "Linen shirt", action: "update", status: "done", error: null }],
        rollbackJob: null,
      }),
    ).toContain("Roll back");
  });
});
