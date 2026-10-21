import { describe, expect, it } from "vitest";
import {
  buildWritePlan,
  classifyFiles,
  mergeThemeFile,
  renderFileMerge,
  summarize,
  type ThemeFileMeta,
} from "./compare";
import { parseThemeJson, serializeThemeJson } from "./files";

const FORK = new Date("2026-10-01T10:00:00Z");
const before = "2026-09-20T10:00:00Z";
const atFork = "2026-10-01T10:01:00Z";
const after = "2026-10-05T10:00:00Z";

function meta(filename: string, checksum: string, updatedAt = before): ThemeFileMeta {
  return { filename, checksum, size: 10, contentType: "text/plain", updatedAt };
}
function map(...files: ThemeFileMeta[]) {
  return new Map(files.map((f) => [f.filename, f]));
}

describe("classifyFiles — three-way", () => {
  const base = map(meta("layout/theme.liquid", "b1"), meta("sections/a.liquid", "a1"), meta("assets/x.css", "x1"), meta("snippets/old.liquid", "o1"));

  it("classifies every combination", () => {
    const live = map(
      meta("layout/theme.liquid", "b2"), // client edit
      meta("sections/a.liquid", "a1"),
      meta("assets/x.css", "x2"), // both edited
      meta("snippets/old.liquid", "o1"),
      meta("snippets/client-added.liquid", "c1"), // client added
    );
    const target = map(
      meta("layout/theme.liquid", "b1"),
      meta("sections/a.liquid", "a9"), // dev edit
      meta("assets/x.css", "x3"),
      // snippets/old.liquid deleted by dev
      meta("snippets/dev-added.liquid", "d1"),
    );
    const plans = Object.fromEntries(classifyFiles({ base, live, target }).map((p) => [p.filename, p]));

    expect(plans["layout/theme.liquid"]).toMatchObject({ status: "live-changed", resolution: "live" });
    expect(plans["sections/a.liquid"]).toMatchObject({ status: "target-changed", resolution: "keep" });
    expect(plans["assets/x.css"]).toMatchObject({ status: "conflict", resolution: "merged", needsMerge: true, resolved: false });
    expect(plans["snippets/old.liquid"]).toMatchObject({ status: "target-changed", resolution: "keep" });
    expect(plans["snippets/client-added.liquid"]).toMatchObject({ status: "live-changed", resolution: "live" });
    expect(plans["snippets/dev-added.liquid"]).toMatchObject({ status: "target-changed", resolution: "keep" });
  });

  it("detects live deletions and delete/modify clashes", () => {
    const live = map(meta("sections/a.liquid", "a1"), meta("assets/x.css", "x1"));
    const target = map(meta("layout/theme.liquid", "b1"), meta("sections/a.liquid", "a1"), meta("assets/x.css", "x1"), meta("snippets/old.liquid", "o2"));
    const plans = Object.fromEntries(classifyFiles({ base, live, target }).map((p) => [p.filename, p]));
    expect(plans["layout/theme.liquid"]).toMatchObject({ status: "live-changed", resolution: "delete" });
    expect(plans["snippets/old.liquid"]).toMatchObject({ status: "conflict", resolved: false, needsMerge: false });
  });
});

describe("classifyFiles — heuristic (no baseline)", () => {
  it("uses timestamps relative to the fork time", () => {
    const live = map(
      meta("layout/theme.liquid", "L", after), // client edited after fork
      meta("sections/a.liquid", "A", before),
      meta("config/settings_data.json", "S-live", after),
      meta("snippets/client.liquid", "C", after),
    );
    const target = map(
      meta("layout/theme.liquid", "T", atFork), // untouched since duplication
      meta("sections/a.liquid", "A2", after), // dev edit
      meta("config/settings_data.json", "S-dev", after),
      meta("snippets/gone.liquid", "G", atFork),
    );
    const plans = Object.fromEntries(classifyFiles({ base: null, live, target, forkTime: FORK }).map((p) => [p.filename, p]));
    expect(plans["layout/theme.liquid"]).toMatchObject({ status: "live-changed", resolution: "live" });
    expect(plans["sections/a.liquid"]).toMatchObject({ status: "target-changed", resolution: "keep" });
    expect(plans["config/settings_data.json"]).toMatchObject({ status: "conflict", needsMerge: true });
    expect(plans["snippets/client.liquid"]).toMatchObject({ status: "live-changed", resolution: "live" });
    expect(plans["snippets/gone.liquid"]).toMatchObject({ status: "live-changed", resolution: "delete" });
  });

  it("falls back to two-way when there is no fork time", () => {
    const plans = classifyFiles({ base: null, live: map(meta("a.liquid", "1")), target: map(meta("a.liquid", "2")) });
    expect(plans[0]).toMatchObject({ status: "conflict", needsMerge: true });
  });
});

describe("mergeThemeFile", () => {
  const header = "/*\n * IMPORTANT: The contents of this file are auto-generated.\n */";
  const template = (sections: object, order: string[]) => serializeThemeJson({ header, value: { sections, order } as never });

  it("structurally merges theme-editor JSON from both sides", () => {
    const base = template({ hero: { type: "image-banner", settings: { heading: "Welcome" } } }, ["hero"]);
    const live = template(
      { hero: { type: "image-banner", settings: { heading: "Black Friday!" } }, promo: { type: "rich-text", settings: {} } },
      ["hero", "promo"],
    );
    const target = template(
      { hero: { type: "image-banner-v2", settings: { heading: "Welcome" } }, reviews: { type: "reviews", settings: {} } },
      ["hero", "reviews"],
    );
    const outcome = mergeThemeFile({ kind: "json", base, live, target });
    expect(outcome.status).toBe("auto-merged");
    const merged = parseThemeJson(outcome.resultBody);
    expect(merged.header).toBe(header);
    expect(merged.value).toEqual({
      sections: {
        hero: { type: "image-banner-v2", settings: { heading: "Black Friday!" } },
        reviews: { type: "reviews", settings: {} },
        promo: { type: "rich-text", settings: {} },
      },
      order: ["hero", "promo", "reviews"],
    });
  });

  it("reports JSON conflicts and re-renders after decisions", () => {
    const base = template({ hero: { type: "a", settings: { heading: "x" } } }, ["hero"]);
    const live = template({ hero: { type: "a", settings: { heading: "live" } } }, ["hero"]);
    const target = template({ hero: { type: "a", settings: { heading: "dev" } } }, ["hero"]);
    const outcome = mergeThemeFile({ kind: "json", base, live, target });
    expect(outcome.status).toBe("conflict");
    expect(outcome.data.mode).toBe("json");
    if (outcome.data.mode !== "json") return;
    expect(outcome.data.conflicts[0].id).toBe("sections.hero.settings.heading");
    outcome.data.decisions["sections.hero.settings.heading"] = "left";
    expect(renderFileMerge(outcome.data)).toContain('"live"');
  });

  it("falls back to a text merge for malformed JSON", () => {
    const outcome = mergeThemeFile({ kind: "json", base: "{ bad", live: "{ bad\n", target: "{ bad" });
    expect(outcome.data.mode).toBe("text");
  });
});

describe("buildWritePlan / summarize", () => {
  it("emits only the writes that change the target theme", () => {
    const plan = buildWritePlan([
      { filename: "keep.liquid", resolution: "keep", targetBody: "t", liveBody: "l", resultBody: null },
      { filename: "live.liquid", resolution: "live", targetBody: "t", liveBody: "l", resultBody: null },
      { filename: "same.liquid", resolution: "live", targetBody: "x", liveBody: "x", resultBody: null },
      { filename: "merged.json", resolution: "merged", targetBody: "t", liveBody: "l", resultBody: "m" },
      { filename: "img.png", resolution: "live", targetBody: null, liveBody: "AAAA", resultBody: null, encoding: "base64" },
      { filename: "gone.liquid", resolution: "delete", targetBody: "t", liveBody: null, resultBody: null },
      { filename: "already-gone.liquid", resolution: "delete", targetBody: null, liveBody: null, resultBody: null },
    ]);
    expect(plan.upserts).toEqual([
      { filename: "live.liquid", body: "l", encoding: "text" },
      { filename: "merged.json", body: "m", encoding: "text" },
      { filename: "img.png", body: "AAAA", encoding: "base64" },
    ]);
    expect(plan.deletes).toEqual(["gone.liquid"]);
  });

  it("counts statuses", () => {
    const s = summarize([
      { status: "conflict", resolved: false },
      { status: "live-changed", resolved: true },
      { status: "unchanged", resolved: true },
    ]);
    expect(s.unresolved).toBe(1);
    expect(s.counts.conflict).toBe(1);
    expect(s.total).toBe(3);
  });
});
