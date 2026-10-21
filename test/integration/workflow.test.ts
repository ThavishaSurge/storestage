/**
 * End-to-end: duplicate a theme, record a baseline, edit both sides, compare, resolve a conflict,
 * export, and apply — in place and into a fresh copy. Shopify is simulated by FakeStore; the
 * database and every service are real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { PrismaClient } from "@prisma/client";
import { FakeStore } from "../fakes/fakeShopify";
import { addOfflineSession, createTestDb, registerStores, waitForJob } from "./harness";

vi.mock("../../app/shopify.server", () => ({
  default: {},
  unauthenticated: {
    admin: async (shop: string) => {
      const store = globalThis.__fakeStores[shop];
      if (!store) throw new Error(`No fake store for ${shop}`);
      return { admin: store };
    },
  },
  authenticate: {},
}));

const settingsData = (color: string, announcement: string) =>
  JSON.stringify({ current: { colors: { accent: color }, announcement } }, null, 2);
const indexTemplate = (sections: Record<string, unknown>, order: string[]) =>
  `/*\n * IMPORTANT: The contents of this file are auto-generated.\n */\n${JSON.stringify({ sections, order }, null, 2)}\n`;
const THEME_LIQUID = ["<html>", "<head>", "  {{ content_for_header }}", "</head>", "<body>", "  {{ content_for_layout }}", "</body>", "</html>", ""].join("\n");

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
type Services = {
  themeMerge: typeof import("../../app/services/themeMerge.server");
  themes: typeof import("../../app/services/themes.server");
};
let svc: Services;

beforeAll(async () => {
  ({ prisma, cleanup } = await createTestDb());
  process.env.THEME_WRITES_ENABLED = "true";
  await import("../../app/services/registry.server");
  svc = {
    themeMerge: await import("../../app/services/themeMerge.server"),
    themes: await import("../../app/services/themes.server"),
  };
}, 30_000);

afterAll(async () => {
  clearInterval(globalThis.__thememergeWorker?.timer);
  await cleanup();
});

describe("theme merge", () => {
  it("merges client edits on live into the working copy", async () => {
    const shop = new FakeStore("solo.myshopify.com", 900000);
    registerStores(shop);
    await addOfflineSession(prisma, shop.shop);
    const main = shop.addTheme(
      "Dawn",
      "MAIN",
      {
        "layout/theme.liquid": THEME_LIQUID,
        "templates/index.json": indexTemplate({ hero: { type: "image-banner", settings: { heading: "Welcome" } } }, ["hero"]),
        "config/settings_data.json": settingsData("#000000", "Free shipping"),
        "sections/header.liquid": "<header>v1</header>\n",
      },
      "2026-09-01T00:00:00Z",
    );

    // The team duplicated the theme by hand and recorded the baseline straight away.
    shop.clock = Date.parse("2026-10-01T10:00:00Z");
    const copy = (shop.op_ThemeMergeThemeDuplicate({ id: main.id, name: "Dawn — redesign" }) as { themeDuplicate: { newTheme: { id: string } } }).themeDuplicate.newTheme;
    const baselineJob = await (await import("../../app/services/jobs.server")).enqueueJob(shop.shop, "theme.recordBaseline", { sourceThemeId: main.id, workingThemeId: copy.id });
    await waitForJob(prisma, baselineJob);

    // Developer work on the copy
    shop.writeThemeFile(copy.id, "sections/header.liquid", "<header>v2 redesign</header>\n");
    shop.writeThemeFile(copy.id, "templates/index.json", indexTemplate({ hero: { type: "image-banner-v2", settings: { heading: "Welcome" } }, reviews: { type: "reviews", settings: {} } }, ["hero", "reviews"]));
    shop.writeThemeFile(copy.id, "config/settings_data.json", settingsData("#ff0000", "Free shipping"));
    // Client work on live
    shop.writeThemeFile(main.id, "layout/theme.liquid", THEME_LIQUID.replace("</head>", "  <script src=\"tracking.js\"></script>\n</head>"));
    shop.writeThemeFile(main.id, "templates/index.json", indexTemplate({ hero: { type: "image-banner", settings: { heading: "Black Friday!" } } }, ["hero"]));
    shop.writeThemeFile(main.id, "config/settings_data.json", settingsData("#00ff00", "Sale this weekend"));

    const mergeId = await svc.themeMerge.startThemeMerge({ shop: shop.shop, admin: shop, liveThemeId: main.id, targetThemeId: copy.id });
    await waitForJob(prisma, (await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId } })).jobId!);

    const merge = await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId } });
    expect(merge.mode).toBe("three-way"); // baseline picked up automatically from the ThemeLink
    const files = await prisma.themeMergeFile.findMany({ where: { mergeId } });
    const by = (f: string) => files.find((x) => x.filename === f)!;
    expect(by("layout/theme.liquid")).toMatchObject({ status: "live-changed", resolution: "live" });
    expect(by("sections/header.liquid")).toMatchObject({ status: "target-changed", resolution: "keep" });
    expect(by("templates/index.json")).toMatchObject({ status: "auto-merged", resolved: true });
    expect(JSON.parse(by("templates/index.json").resultBody!.replace(/^\/\*[\s\S]*?\*\/\s*/, ""))).toEqual({
      sections: { hero: { type: "image-banner-v2", settings: { heading: "Black Friday!" } }, reviews: { type: "reviews", settings: {} } },
      order: ["hero", "reviews"],
    });
    expect(by("config/settings_data.json")).toMatchObject({ status: "conflict", resolved: false, conflictCount: 1 });

    await expect(svc.themeMerge.startApply(shop.shop, mergeId)).rejects.toThrow(/need a decision/);
    // The accent colour clashed: keep the developer's; the announcement merged automatically.
    await svc.themeMerge.setConflictDecision(shop.shop, mergeId, "config/settings_data.json", "current.colors.accent", "right");

    const zip = unzipSync((await svc.themeMerge.buildExportZip(shop.shop, mergeId)).bytes);
    expect(Object.keys(zip).sort()).toEqual(["MERGE-REPORT.md", "deletions.txt", "theme/config/settings_data.json", "theme/layout/theme.liquid", "theme/templates/index.json"]);
    expect(strFromU8(zip["MERGE-REPORT.md"])).toContain("shopify theme push");

    // The full-theme zip is the whole working copy with merged bodies swapped in: importable as-is.
    const fullZip = unzipSync((await svc.themeMerge.buildFullThemeZip(shop.shop, mergeId)).bytes);
    expect(Object.keys(fullZip).sort()).toEqual([
      "config/settings_data.json",
      "layout/theme.liquid",
      "sections/header.liquid",
      "templates/index.json",
    ]); // no theme/ prefix and no MERGE-REPORT.md — Shopify imports theme files only
    expect(strFromU8(fullZip["layout/theme.liquid"])).toContain("tracking.js"); // merged in
    expect(strFromU8(fullZip["sections/header.liquid"])).toBe("<header>v2 redesign</header>\n"); // carried over untouched
    expect(JSON.parse(strFromU8(fullZip["config/settings_data.json"]))).toEqual({
      current: { colors: { accent: "#ff0000" }, announcement: "Sale this weekend" },
    });

    const jobId = await svc.themeMerge.startApply(shop.shop, mergeId);
    await waitForJob(prisma, jobId);
    expect(shop.readThemeFile(copy.id, "layout/theme.liquid")).toContain("tracking.js");
    expect(shop.readThemeFile(copy.id, "sections/header.liquid")).toContain("v2 redesign");
    expect(JSON.parse(shop.readThemeFile(copy.id, "config/settings_data.json")!)).toEqual({ current: { colors: { accent: "#ff0000" }, announcement: "Sale this weekend" } });
    expect(shop.readThemeFile(main.id, "sections/header.liquid")).toBe("<header>v1</header>\n"); // live untouched
    expect((await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId } })).status).toBe("applied");

    // Same decisions, written into a fresh duplicate instead: the working copy stays as it was.
    const mergeId2 = await svc.themeMerge.startThemeMerge({ shop: shop.shop, admin: shop, liveThemeId: main.id, targetThemeId: copy.id });
    await waitForJob(prisma, (await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId2 } })).jobId!);
    shop.writeThemeFile(copy.id, "sections/footer.liquid", "<footer>copy only</footer>\n");
    // The accent colour still differs on both sides, so it comes back as a conflict.
    await svc.themeMerge.setConflictDecision(shop.shop, mergeId2, "config/settings_data.json", "current.colors.accent", "right");
    const newCopyJob = await svc.themeMerge.startApply(shop.shop, mergeId2, "new-copy");
    await waitForJob(prisma, newCopyJob);
    const merged = (await prisma.job.findUniqueOrThrow({ where: { id: newCopyJob } })).result!;
    const mergedThemeId = (JSON.parse(merged) as { themeId: string }).themeId;
    expect(mergedThemeId).not.toBe(copy.id);
    expect(shop.themes.find((t) => t.id === mergedThemeId)!.role).toBe("UNPUBLISHED");
    expect(shop.readThemeFile(mergedThemeId, "layout/theme.liquid")).toContain("tracking.js");
    expect(shop.readThemeFile(mergedThemeId, "sections/footer.liquid")).toContain("copy only"); // unchanged files carried over by the duplicate
    expect(shop.readThemeFile(main.id, "sections/header.liquid")).toBe("<header>v1</header>\n"); // live still untouched

    // A full theme library fails before anything is written, so the merge can be re-applied
    // once an old theme is deleted.
    const mergeId3 = await svc.themeMerge.startThemeMerge({ shop: shop.shop, admin: shop, liveThemeId: main.id, targetThemeId: copy.id });
    await waitForJob(prisma, (await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId3 } })).jobId!);
    const pad: { id: string }[] = [];
    while (shop.themes.filter((t) => t.role !== "DEVELOPMENT").length < svc.themes.THEME_LIBRARY_LIMIT) pad.push(shop.addTheme(`Filler ${pad.length}`, "UNPUBLISHED", {}));
    await svc.themeMerge.setConflictDecision(shop.shop, mergeId3, "config/settings_data.json", "current.colors.accent", "right");
    const fullJob = await svc.themeMerge.startApply(shop.shop, mergeId3, "new-copy");
    await expect(waitForJob(prisma, fullJob)).rejects.toThrow(/theme library is full/);
    expect((await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId3 } })).status).toBe("ready"); // retryable

    shop.themes = shop.themes.filter((t) => t.id !== pad[0]!.id); // the merchant deletes one
    const retryJob = await svc.themeMerge.startApply(shop.shop, mergeId3, "new-copy");
    await waitForJob(prisma, retryJob);
    expect((await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId3 } })).status).toBe("applied");
    expect(await prisma.themeSnapshot.count({ where: { shop: shop.shop, reason: "pre-apply" } })).toBe(1);
  });

  it("falls back to timestamps without a baseline", async () => {
    const shop = globalThis.__fakeStores["solo.myshopify.com"];
    const main = shop.themes.find((t) => t.role === "MAIN")!;
    shop.clock = Date.parse("2026-10-10T10:00:00Z");
    const copy = (shop.op_ThemeMergeThemeDuplicate({ id: main.id, name: "Dawn — hand copy" }) as { themeDuplicate: { newTheme: { id: string } } }).themeDuplicate.newTheme;
    shop.clock += 60 * 60 * 1000;
    shop.writeThemeFile(main.id, "sections/header.liquid", "<header>client edit</header>\n");
    shop.writeThemeFile(copy.id, "layout/theme.liquid", "<html>dev</html>\n");

    const mergeId = await svc.themeMerge.startThemeMerge({ shop: shop.shop, admin: shop, liveThemeId: main.id, targetThemeId: copy.id });
    await waitForJob(prisma, (await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId } })).jobId!);
    const merge = await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId }, include: { files: true } });
    expect(merge.mode).toBe("heuristic");
    const by = (f: string) => merge.files.find((x) => x.filename === f)!;
    expect(by("sections/header.liquid")).toMatchObject({ status: "live-changed", resolution: "live" });
    expect(by("layout/theme.liquid")).toMatchObject({ status: "target-changed", resolution: "keep" });
  });
});
