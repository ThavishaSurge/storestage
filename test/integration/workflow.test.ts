/**
 * End-to-end: pair two stores, clone live -> staging, edit both, compare, resolve a conflict,
 * promote, verify live, roll back, verify again. Then the theme flows (same-store and
 * cross-store). Shopify is simulated by FakeStore; the database and every service are real.
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

const LIVE = "live-shop.myshopify.com";
const STAGING = "staging-shop.myshopify.com";

const settingsData = (color: string, announcement: string) =>
  JSON.stringify({ current: { colors: { accent: color }, announcement } }, null, 2);
const indexTemplate = (sections: Record<string, unknown>, order: string[]) =>
  `/*\n * IMPORTANT: The contents of this file are auto-generated.\n */\n${JSON.stringify({ sections, order }, null, 2)}\n`;
const THEME_LIQUID = ["<html>", "<head>", "  {{ content_for_header }}", "</head>", "<body>", "  {{ content_for_layout }}", "</body>", "</html>", ""].join("\n");

function seedLive(live: FakeStore) {
  live.metaobjectDefinitions.push({
    id: live.gid("MetaobjectDefinition"),
    type: "designer",
    name: "Designer",
    description: null,
    displayNameKey: "name",
    capabilities: { publishable: { enabled: true }, translatable: { enabled: false }, renderable: { enabled: false }, onlineStore: { enabled: false, data: null } },
    fieldDefinitions: [{ key: "name", name: "Name", description: null, required: true, type: { name: "single_line_text_field" }, validations: [] }],
  });
  const designer = { id: live.gid("Metaobject"), handle: "ana", type: "designer", displayName: "Ana", fields: [{ key: "name", value: "Ana", type: "single_line_text_field" }], capabilities: { publishable: { status: "ACTIVE" }, onlineStore: null } };
  live.metaobjects.push(designer);
  live.metafieldDefinitions.push({
    id: live.gid("MetafieldDefinition"),
    namespace: "custom",
    key: "designer",
    name: "Designer",
    description: null,
    ownerType: "PRODUCT",
    pinnedPosition: 1,
    type: { name: "metaobject_reference" },
    validations: [{ name: "metaobject_definition_id", value: live.metaobjectDefinitions[0].id }],
  });
  const shirt = live.addProduct({
    handle: "linen-shirt",
    title: "Linen shirt",
    vendor: "Acme",
    tags: ["summer"],
    imageNames: ["linen-front.jpg"],
    variants: [
      { sku: "LS-S", options: { Size: "S" }, price: "49.00" },
      { sku: "LS-M", options: { Size: "M" }, price: "49.00" },
    ],
    metafields: { nodes: [{ namespace: "custom", key: "designer", type: "metaobject_reference", value: designer.id }] },
  });
  const hat = live.addProduct({ handle: "straw-hat", title: "Straw hat", vendor: "Acme" });
  live.collections.push({
    id: live.gid("Collection"),
    handle: "summer",
    title: "Summer",
    descriptionHtml: "",
    sortOrder: "MANUAL",
    templateSuffix: null,
    seo: { title: null, description: null },
    image: null,
    ruleSet: null,
    products: { nodes: [{ id: shirt.id }, { id: hat.id }] },
    metafields: { nodes: [] },
  });
  live.pages.push({ id: live.gid("Page"), handle: "about", title: "About", body: "<p>We make shirts.</p>", isPublished: true, templateSuffix: null, metafields: { nodes: [] } });
  const blog = { id: live.gid("Blog"), handle: "journal", title: "Journal", commentPolicy: "CLOSED", templateSuffix: null, metafields: { nodes: [] } };
  live.blogs.push(blog);
  live.articles.push({ id: live.gid("Article"), handle: "hello", title: "Hello", body: "<p>First post</p>", summary: null, tags: [], isPublished: true, templateSuffix: null, author: { name: "Ana" }, blog: { id: blog.id, handle: blog.handle }, image: null, metafields: { nodes: [] } });
  live.menus.push({
    id: live.gid("Menu"),
    handle: "main-menu",
    title: "Main menu",
    isDefault: true,
    items: [
      { title: "Summer", type: "COLLECTION", url: "/collections/summer", resourceId: live.collections[0].id, tags: [], items: [] },
      { title: "About", type: "PAGE", url: "/pages/about", resourceId: live.pages[0].id, tags: [], items: [] },
    ],
  });
  live.redirects.push({ id: live.gid("UrlRedirect"), path: "/old-shirts", target: "/collections/summer" });
  live.addFile("size-guide.pdf");
  live.addTheme(
    "Dawn",
    "MAIN",
    {
      "layout/theme.liquid": THEME_LIQUID,
      "templates/index.json": indexTemplate({ hero: { type: "image-banner", settings: { heading: "Welcome" } } }, ["hero"]),
      "config/settings_data.json": settingsData("#000000", "Free shipping"),
      "assets/logo.png": "iVBORw0KGgo=",
    },
    "2026-09-01T00:00:00Z",
  );
}

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let live: FakeStore;
let staging: FakeStore;
type Services = {
  pairing: typeof import("../../app/services/pairing.server");
  staging: typeof import("../../app/services/staging.server");
  themeMerge: typeof import("../../app/services/themeMerge.server");
  themes: typeof import("../../app/services/themes.server");
};
let svc: Services;

beforeAll(async () => {
  ({ prisma, cleanup } = await createTestDb());
  live = new FakeStore(LIVE, 1000);
  staging = new FakeStore(STAGING, 500000);
  seedLive(live);
  staging.addTheme("Dawn", "MAIN", { "layout/theme.liquid": THEME_LIQUID }, "2026-09-01T00:00:00Z");
  registerStores(live, staging);
  await addOfflineSession(prisma, LIVE);
  await addOfflineSession(prisma, STAGING);
  process.env.THEME_WRITES_ENABLED = "true";
  await import("../../app/services/registry.server");
  svc = {
    pairing: await import("../../app/services/pairing.server"),
    staging: await import("../../app/services/staging.server"),
    themeMerge: await import("../../app/services/themeMerge.server"),
    themes: await import("../../app/services/themes.server"),
  };
}, 30_000);

afterAll(async () => {
  clearInterval(globalThis.__storestageWorker?.timer);
  await cleanup?.();
});

describe("two-store staging workflow", () => {
  let pairId: string;

  it("pairs the stores with a one-time code", async () => {
    const { code } = await svc.pairing.createPairingCode(LIVE, "live");
    await expect(svc.pairing.redeemPairingCode(LIVE, code)).rejects.toThrow(/other store/);
    const pair = await svc.pairing.redeemPairingCode(STAGING, code.toLowerCase().replace("-", ""));
    expect(pair).toMatchObject({ role: "staging", stagingShop: STAGING, liveShop: LIVE });
    pairId = pair.id;
    expect((await svc.pairing.getPairForShop(LIVE))?.role).toBe("live");
  });

  it("clones live into staging with every reference remapped", async () => {
    const jobId = await svc.staging.startClone(STAGING, pairId, { types: svc.staging.DEFAULT_TYPES, copyTheme: true, baselineOnly: false });
    const result = await waitForJob(prisma, jobId);
    expect(result).toMatchObject({ failed: 0 });

    const shirt = staging.product("linen-shirt")!;
    expect(shirt).toBeDefined();
    expect(shirt.variants.nodes.map((v) => v.sku)).toEqual(["LS-S", "LS-M"]);
    expect(shirt.media.nodes).toHaveLength(1);
    const designer = staging.metaobjects.find((m) => m.handle === "ana")!;
    expect(designer.id).not.toBe(live.metaobjects[0].id);
    expect(shirt.metafields.nodes[0].value).toBe(designer.id); // reference points at STAGING's metaobject
    expect(staging.metafieldDefinitions[0].validations[0].value).toBe(staging.metaobjectDefinitions[0].id);

    const collection = staging.collections.find((c) => c.handle === "summer")!;
    expect(collection.products.nodes.map((n) => n.id).sort()).toEqual([shirt.id, staging.product("straw-hat")!.id].sort());
    const menu = staging.menus.find((m) => m.handle === "main-menu")!;
    expect(menu.items.map((i) => i.resourceId)).toEqual([collection.id, staging.pages.find((p) => p.handle === "about")!.id]);
    expect(staging.articles[0].blog.handle).toBe("journal");
    expect(staging.redirects).toEqual([expect.objectContaining({ path: "/old-shirts" })]);
    expect(staging.files.some((f) => f.url?.includes("size-guide.pdf"))).toBe(true);

    // Theme copied into staging as an unpublished theme
    const copy = staging.themes.find((t) => t.role === "UNPUBLISHED")!;
    expect(staging.readThemeFile(copy.id, "config/settings_data.json")).toContain("Free shipping");
    expect(String(result?.theme)).toMatch(/copied to staging/);

    const pair = await prisma.storePair.findUniqueOrThrow({ where: { id: pairId } });
    expect(pair.baselineSnapshotId).toBeTruthy();
  });

  it("re-cloning is idempotent", async () => {
    const before = staging.log.length;
    const jobId = await svc.staging.startClone(STAGING, pairId, { types: svc.staging.DEFAULT_TYPES, copyTheme: false, baselineOnly: false });
    const result = await waitForJob(prisma, jobId);
    expect(result).toMatchObject({ copied: 0, failed: 0 });
    expect(staging.log.slice(before)).toEqual([]);
  });

  let compareId: string;

  it("compares: staging edits, live drift, auto-merges and conflicts", async () => {
    // Publish the copied theme on staging and edit it (theme compare is cross-store).
    const stagingCopy = staging.themes.find((t) => t.role === "UNPUBLISHED")!;
    staging.themes.find((t) => t.role === "MAIN")!.role = "UNPUBLISHED";
    stagingCopy.role = "MAIN";
    staging.writeThemeFile(stagingCopy.id, "layout/theme.liquid", THEME_LIQUID.replace("</head>", "  {% render 'new-fonts' %}\n</head>"));
    staging.writeThemeFile(stagingCopy.id, "snippets/new-fonts.liquid", "<link rel=\"preload\">");

    // Staging edits
    const sShirt = staging.product("linen-shirt")!;
    sShirt.title = "Linen shirt — new season";
    sShirt.variants.nodes[1].price = "55.00";
    staging.addProduct({ handle: "canvas-tote", title: "Canvas tote", vendor: "Acme" });
    staging.pages[0].body = "<p>Staging copy</p>";
    staging.redirects.push({ id: staging.gid("UrlRedirect"), path: "/tote", target: "/products/canvas-tote" });
    staging.collections[0].products.nodes.push({ id: staging.product("canvas-tote")!.id });

    // Live drift (client edits)
    const lShirt = live.product("linen-shirt")!;
    lShirt.vendor = "Acme Studio";
    live.pages[0].body = "<p>Client copy</p>";
    live.writeThemeFile(live.themes[0].id, "config/settings_data.json", settingsData("#000000", "Sale this weekend"));

    compareId = await svc.staging.startCompare(STAGING, pairId, { includeTheme: true });
    const record = await prisma.storeCompare.findUniqueOrThrow({ where: { id: compareId } });
    await waitForJob(prisma, record.jobId!);

    const items = await prisma.storeCompareItem.findMany({ where: { compareId } });
    const by = (type: string, key: string) => items.find((i) => i.type === type && i.key === key);
    expect(by("product", "linen-shirt")).toMatchObject({ status: "auto-merged", action: "update", selected: true });
    expect(JSON.parse(by("product", "linen-shirt")!.mergedData!)).toMatchObject({ title: "Linen shirt — new season", vendor: "Acme Studio" });
    expect(by("product", "canvas-tote")).toMatchObject({ status: "staging-changed", action: "create", selected: true });
    expect(by("page", "about")).toMatchObject({ status: "conflict", selected: false });
    expect(by("urlRedirect", "/tote")).toMatchObject({ action: "create" });
    expect(by("collection", "summer")).toMatchObject({ status: "staging-changed", action: "update" });
    // Untouched resources don't appear
    expect(by("product", "straw-hat")).toBeUndefined();

    // Store settings are compared read-only
    const summary = JSON.parse((await prisma.storeCompare.findUniqueOrThrow({ where: { id: compareId } })).summary!);
    expect(summary.settingsDiff).toEqual([{ key: "contactEmail", label: "Contact email", staging: `hello@${STAGING}`, live: `hello@${LIVE}` }]);
  });

  it("refuses to promote while a selected conflict is undecided", async () => {
    const page = await prisma.storeCompareItem.findFirstOrThrow({ where: { compareId, type: "page" } });
    await svc.staging.setItemSelected(STAGING, compareId, [page.id], true);
    await expect(svc.staging.startPromotion(STAGING, compareId)).rejects.toThrow(/undecided/);
    await svc.staging.setItemDecision(STAGING, page.id, "body", "right");
  });

  let promotionId: string;

  it("promotes the selected changes and keeps live's own edits", async () => {
    promotionId = await svc.staging.startPromotion(STAGING, compareId);
    const promotion = await prisma.promotion.findUniqueOrThrow({ where: { id: promotionId } });
    await waitForJob(prisma, promotion.jobId!);

    const after = await prisma.promotion.findUniqueOrThrow({ where: { id: promotionId }, include: { items: true } });
    expect(after.items.filter((i) => i.status !== "done")).toEqual([]);
    expect(after.status).toBe("done");

    const shirt = live.product("linen-shirt")!;
    expect(shirt.title).toBe("Linen shirt — new season");
    expect(shirt.vendor).toBe("Acme Studio"); // client's drift preserved
    expect(shirt.variants.nodes.map((v) => v.price)).toEqual(["49.00", "55.00"]);
    expect(shirt.variants.nodes[0].id).toMatch(/ProductVariant\/1\d{3}$/); // updated in place, not recreated
    const tote = live.product("canvas-tote")!;
    expect(tote).toBeDefined();
    expect(live.published.has(tote.id)).toBe(true);
    expect(live.collections[0].products.nodes.map((n) => n.id)).toContain(tote.id); // manual membership uses LIVE gid
    expect(live.pages[0].body).toBe("<p>Staging copy</p>"); // conflict decided for staging
    expect(live.redirects.map((r) => r.path)).toContain("/tote");
  });

  it("shows nothing left to promote afterwards", async () => {
    const id = await svc.staging.startCompare(STAGING, pairId, { includeTheme: false });
    await waitForJob(prisma, (await prisma.storeCompare.findUniqueOrThrow({ where: { id } })).jobId!);
    const items = await prisma.storeCompareItem.findMany({ where: { compareId: id, NOT: { action: "none" } } });
    expect(items).toEqual([]);
  });

  it("detects live changing between compare and promote", async () => {
    staging.pages[0].title = "About us";
    const id = await svc.staging.startCompare(STAGING, pairId, { includeTheme: false });
    await waitForJob(prisma, (await prisma.storeCompare.findUniqueOrThrow({ where: { id } })).jobId!);
    live.pages[0].title = "About (client)";
    const pid = await svc.staging.startPromotion(STAGING, id);
    await waitForJob(prisma, (await prisma.promotion.findUniqueOrThrow({ where: { id: pid } })).jobId!);
    const item = await prisma.promotionItem.findFirstOrThrow({ where: { promotionId: pid } });
    expect(item).toMatchObject({ status: "failed" });
    expect(item.error).toMatch(/Live changed/);
    expect(live.pages[0].title).toBe("About (client)");
    live.pages[0].title = "About";
    staging.pages[0].title = "About";
  });

  it("rolls the promotion back", async () => {
    const jobId = await svc.staging.startRollback(STAGING, promotionId);
    await waitForJob(prisma, jobId);
    expect(live.product("linen-shirt")!.title).toBe("Linen shirt");
    expect(live.product("linen-shirt")!.vendor).toBe("Acme Studio");
    expect(live.product("canvas-tote")).toBeUndefined();
    expect(live.pages[0].body).toBe("<p>Client copy</p>");
    expect(live.redirects.map((r) => r.path)).not.toContain("/tote");
    const promotion = await prisma.promotion.findUniqueOrThrow({ where: { id: promotionId } });
    expect(promotion.status).toBe("rolled-back");

    // The staging changes show up as pending again.
    const id = await svc.staging.startCompare(STAGING, pairId, { includeTheme: false });
    await waitForJob(prisma, (await prisma.storeCompare.findUniqueOrThrow({ where: { id } })).jobId!);
    const pending = await prisma.storeCompareItem.findMany({ where: { compareId: id, NOT: { action: "none" } } });
    expect(pending.map((p) => `${p.type}:${p.key}`).sort()).toEqual(
      ["collection:summer", "page:about", "product:canvas-tote", "product:linen-shirt", "urlRedirect:/tote"].sort(),
    );
  });

  it("promotes theme changes into a new copy of the live theme", async () => {
    const summary = JSON.parse((await prisma.storeCompare.findUniqueOrThrow({ where: { id: compareId } })).summary!);
    const mergeId = summary.themeMergeId as string;
    const merge = await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId } });
    await waitForJob(prisma, merge.jobId!);
    const files = await prisma.themeMergeFile.findMany({ where: { mergeId } });
    const by = (f: string) => files.find((x) => x.filename === f);
    expect((await prisma.themeMerge.findUniqueOrThrow({ where: { id: mergeId } })).mode).toBe("three-way");
    expect(by("layout/theme.liquid")).toMatchObject({ status: "target-changed", resolution: "keep" });
    expect(by("snippets/new-fonts.liquid")).toMatchObject({ status: "target-changed" });
    expect(by("config/settings_data.json")).toMatchObject({ status: "live-changed", resolution: "live" });

    const jobId = await svc.themeMerge.startApply(STAGING, mergeId);
    const result = await waitForJob(prisma, jobId);
    const liveMain = live.themes.find((t) => t.role === "MAIN")!;
    const copy = live.themes.find((t) => t.id === result?.themeId)!;
    expect(copy.role).toBe("UNPUBLISHED"); // never published automatically
    expect(live.readThemeFile(copy.id, "layout/theme.liquid")).toContain("new-fonts");
    expect(live.readThemeFile(copy.id, "snippets/new-fonts.liquid")).toBeDefined();
    expect(live.readThemeFile(copy.id, "config/settings_data.json")).toContain("Sale this weekend"); // client's edit kept
    expect(live.readThemeFile(liveMain.id, "layout/theme.liquid")).not.toContain("new-fonts"); // live untouched
  });
});

describe("single-store theme compare", () => {
  it("merges client edits on live into the working copy", async () => {
    const shop = new FakeStore("solo.myshopify.com", 900000);
    registerStores(live, staging, shop);
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
    const copy = (shop.op_StoreStageThemeDuplicate({ id: main.id, name: "Dawn — redesign" }) as { themeDuplicate: { newTheme: { id: string } } }).themeDuplicate.newTheme;
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
    const copy = (shop.op_StoreStageThemeDuplicate({ id: main.id, name: "Dawn — hand copy" }) as { themeDuplicate: { newTheme: { id: string } } }).themeDuplicate.newTheme;
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
