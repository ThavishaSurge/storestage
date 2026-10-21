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
      merges: [{ id: "m1", liveThemeName: "Dawn", targetThemeName: "Redesign", status: "ready", createdAt: now }],
      workingCopies: 2,
      flags: { themeWrites: false },
    });
    expect(html).toContain("ThemeMerge");
    expect(html).toContain("Redesign");
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
    expect(render(<Page />, { ...data, themes: [themes[0]] })).toContain("Compare themes"); // single theme: nothing to compare against
    expect(render(<Page />, data, { jobId: "j1", label: "Taking snapshot" })).toContain("Starting");
  });

  it("theme merge overview in every state", async () => {
    const { default: Page } = await import("../../app/routes/app.themes.merge.$id._index");
    const merge = {
      id: "m1",

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
    expect(render(<Page />, { merge: { ...merge, status: "applied", appliedAt: now }, files, applyJob: { id: "j2", status: "done", result: { themeName: "Dawn merged" }, error: null }, writesEnabled: true })).toContain("Dawn merged");
    expect(render(<Page />, { merge, files, applyJob: null, writesEnabled: true }, undefined, "filter=conflict")).toContain("assets/logo.png");
  });

  it("theme merge file page (json conflicts, text hunks, binary)", async () => {
    const { default: Page } = await import("../../app/routes/app.themes.merge.$id.file");
    const base = {
      merge: { id: "m1", liveThemeName: "Dawn", targetThemeName: "Redesign", status: "ready" },
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
});
