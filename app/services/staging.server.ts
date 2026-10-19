/**
 * Two-store staging workflow: clone (live -> staging), compare (three-way), promote
 * (staging -> live) and rollback.
 */
import db from "../db.server";
import { deepEqual, type JsonObject } from "../lib/json";
import type { ConflictDecision, JsonConflict } from "../lib/merge/json3";
import { diffStores, resolvedData, sortChanges, summarizeChanges, type ResourceChange } from "../lib/resources/diff";
import { diffSettings, type SettingDiff } from "../lib/resources/settings";
import { refId, RESOURCE_TYPES, type NormalizedResource, type ResourceType } from "../lib/resources/types";
import { SHOP_SETTINGS, type RawShopSettings } from "../lib/shopify/queries";
import { adminForShop, describeError, gql } from "./admin.server";
import { executeChanges, type ExecutableChange } from "./executor.server";
import { publishCreatedToOnlineStore, themeWritesEnabled } from "./flags.server";
import { enqueueJob, registerJobHandler, type JobContext } from "./jobs.server";
import { readStore } from "./storeData.server";
import { startThemeMerge } from "./themeMerge.server";
import {
  deleteThemeFiles,
  duplicateTheme,
  fetchThemeFileBodies,
  fetchThemeFileMeta,
  listThemes,
  snapshotTheme,
  upsertThemeFiles,
} from "./themes.server";

export const DEFAULT_TYPES: ResourceType[] = [...RESOURCE_TYPES];

async function getPair(pairId: string, shop: string) {
  const pair = await db.storePair.findFirst({ where: { id: pairId, OR: [{ stagingShop: shop }, { liveShop: shop }] } });
  if (!pair) throw new Error("Store pair not found");
  return pair;
}

async function saveSnapshot(args: {
  pairId: string;
  kind: "baseline" | "prepush";
  shop: string;
  types: ResourceType[];
  resources: NormalizedResource[];
  themeSnapshotId?: string | null;
}) {
  const snapshot = await db.storeSnapshot.create({
    data: {
      pairId: args.pairId,
      kind: args.kind,
      shop: args.shop,
      resourceTypes: JSON.stringify(args.types),
      themeSnapshotId: args.themeSnapshotId ?? null,
    },
  });
  const rows = args.resources.map((r) => ({
    snapshotId: snapshot.id,
    type: r.type,
    key: r.key,
    gid: r.gid,
    title: r.title,
    data: JSON.stringify(r.data),
    transfer: r.transfer ? JSON.stringify(r.transfer) : null,
  }));
  for (let i = 0; i < rows.length; i += 200) await db.storeSnapshotItem.createMany({ data: rows.slice(i, i + 200) });
  return snapshot.id;
}

async function loadSnapshot(snapshotId: string): Promise<{ types: ResourceType[]; themeSnapshotId: string | null; resources: NormalizedResource[] }> {
  const snapshot = await db.storeSnapshot.findUniqueOrThrow({ where: { id: snapshotId }, include: { items: true } });
  return {
    types: JSON.parse(snapshot.resourceTypes) as ResourceType[],
    themeSnapshotId: snapshot.themeSnapshotId,
    resources: snapshot.items.map((i) => ({
      type: i.type as ResourceType,
      key: i.key,
      gid: i.gid,
      title: i.title,
      data: JSON.parse(i.data) as JsonObject,
      transfer: i.transfer ? (JSON.parse(i.transfer) as JsonObject) : undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

export async function startClone(shop: string, pairId: string, options: { types: ResourceType[]; copyTheme: boolean; baselineOnly: boolean }) {
  const pair = await getPair(pairId, shop);
  return enqueueJob(shop, "store.clone", { pairId: pair.id, ...options });
}

async function clone(payload: Record<string, unknown>, ctx: JobContext) {
  const pair = await getPair(String(payload.pairId), ctx.shop);
  const types = (payload.types as ResourceType[]).filter((t) => RESOURCE_TYPES.includes(t));
  const baselineOnly = payload.baselineOnly === true;
  const liveAdmin = await adminForShop(pair.liveShop);
  const stagingAdmin = await adminForShop(pair.stagingShop);

  await ctx.progress(0.01, "Reading live store");
  const live = await readStore(liveAdmin, types, (m, f) => ctx.progress(0.01 + f * 0.25, `Live: ${m}`));
  const failedRefs = new Set<string>();
  let summary: Record<string, unknown> = { baselineOnly };

  if (!baselineOnly) {
    await ctx.progress(0.27, "Reading staging store");
    const staging = await readStore(stagingAdmin, types, (m, f) => ctx.progress(0.27 + f * 0.13, `Staging: ${m}`));
    const stagingByRef = new Map(staging.resources.map((r) => [refId(r.type, r.key), r]));

    const changes: ExecutableChange[] = [];
    for (const r of live.resources) {
      const existing = stagingByRef.get(refId(r.type, r.key));
      if (existing && deepEqual(existing.data, r.data)) continue;
      changes.push({
        type: r.type,
        key: r.key,
        title: r.title,
        action: existing ? "update" : "create",
        data: r.data,
        liveData: existing?.data ?? null,
        transfer: r.transfer ?? null,
        liveGid: existing?.gid ?? null,
      });
    }
    const ordered = sortChanges(changes.map((c) => ({ ...c, merged: c.data as JsonObject, staging: c.data as JsonObject })));
    await ctx.progress(0.4, `Copying ${ordered.length} resources to staging`);
    const results = await executeChanges({
      admin: stagingAdmin,
      changes: ordered,
      refIndex: staging.refIndex,
      publishCreated: true,
      onResult: (_, i, total) => ctx.progress(0.4 + (i / Math.max(total, 1)) * 0.45, `Copied ${i}/${total}`),
    });
    const failed = results.filter((r) => r.status === "failed");
    for (const f of failed) failedRefs.add(refId(f.change.type, f.change.key));
    summary = {
      ...summary,
      copied: results.filter((r) => r.status === "done").length,
      failed: failed.length,
      failures: failed.slice(0, 50).map((f) => ({ type: f.change.type, key: f.change.key, error: f.error })),
      unchanged: live.resources.length - ordered.length,
    };
  }

  // Theme baseline (and optional copy of the live theme into staging).
  await ctx.progress(0.86, "Snapshotting the live theme");
  const liveMain = (await listThemes(liveAdmin)).find((t) => t.role === "MAIN");
  let themeSnapshotId: string | null = null;
  if (liveMain) {
    themeSnapshotId = await snapshotTheme({ admin: liveAdmin, shop: pair.liveShop, theme: liveMain, reason: "store-baseline" });
    if (payload.copyTheme === true && !baselineOnly) {
      if (!themeWritesEnabled()) {
        summary.theme = "Theme not copied: theme writes are disabled (THEME_WRITES_ENABLED). Copy it with Shopify CLI (theme pull/push).";
      } else {
        try {
          summary.theme = await copyThemeAcrossStores(liveAdmin, stagingAdmin, liveMain, ctx);
        } catch (error) {
          summary.theme = `Theme copy failed: ${describeError(error)}`;
        }
      }
    }
  }

  // Baseline = live as it is now, minus anything that failed to copy (so it shows as drift, not a staging delete).
  const baselineResources = live.resources.filter((r) => !failedRefs.has(refId(r.type, r.key)));
  const snapshotId = await saveSnapshot({ pairId: pair.id, kind: "baseline", shop: pair.liveShop, types, resources: baselineResources, themeSnapshotId });
  await db.storePair.update({ where: { id: pair.id }, data: { baselineSnapshotId: snapshotId, clonedAt: new Date() } });
  return { ...summary, baselineSnapshotId: snapshotId, resources: baselineResources.length };
}

async function copyThemeAcrossStores(
  liveAdmin: Awaited<ReturnType<typeof adminForShop>>,
  stagingAdmin: Awaited<ReturnType<typeof adminForShop>>,
  liveMain: { id: string; name: string },
  ctx: JobContext,
): Promise<string> {
  const stagingMain = (await listThemes(stagingAdmin)).find((t) => t.role === "MAIN");
  if (!stagingMain) return "Theme not copied: staging has no published theme to duplicate.";
  const liveMeta = await fetchThemeFileMeta(liveAdmin, liveMain.id);
  const bodies = await fetchThemeFileBodies(liveAdmin, liveMain.id, [...liveMeta.keys()], (n) =>
    ctx.progress(0.87 + (n / Math.max(liveMeta.size, 1)) * 0.05, "Downloading live theme"),
  );
  const copy = await duplicateTheme(stagingAdmin, stagingMain.id, `${liveMain.name} (from live)`.slice(0, 50));
  const copyMeta = await fetchThemeFileMeta(stagingAdmin, copy.id);
  await upsertThemeFiles(
    stagingAdmin,
    copy.id,
    [...bodies.values()].map((b) => ({ filename: b.filename, body: b.body, encoding: b.encoding })),
    (n) => ctx.progress(0.92 + (n / Math.max(bodies.size, 1)) * 0.05, "Writing theme to staging"),
  );
  const extra = [...copyMeta.keys()].filter((f) => !liveMeta.has(f));
  if (extra.length) await deleteThemeFiles(stagingAdmin, copy.id, extra);
  return `Live theme copied to staging as unpublished theme "${copy.name}". Publish it on staging before you start editing.`;
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export async function startCompare(shop: string, pairId: string, options: { includeTheme: boolean }) {
  const pair = await getPair(pairId, shop);
  if (!pair.baselineSnapshotId) throw new Error("Clone or record a baseline first.");
  const compare = await db.storeCompare.create({ data: { pairId: pair.id, baselineId: pair.baselineSnapshotId } });
  const jobId = await enqueueJob(shop, "store.compare", { compareId: compare.id, includeTheme: options.includeTheme });
  await db.storeCompare.update({ where: { id: compare.id }, data: { jobId } });
  return compare.id;
}

async function compare(payload: Record<string, unknown>, ctx: JobContext) {
  const record = await db.storeCompare.findUniqueOrThrow({ where: { id: String(payload.compareId) } });
  const pair = await getPair(record.pairId, ctx.shop);
  try {
    const baseline = await loadSnapshot(record.baselineId);
    const liveAdmin = await adminForShop(pair.liveShop);
    const stagingAdmin = await adminForShop(pair.stagingShop);

    await ctx.progress(0.02, "Reading staging store");
    const staging = await readStore(stagingAdmin, baseline.types, (m, f) => ctx.progress(0.02 + f * 0.4, `Staging: ${m}`));
    await ctx.progress(0.42, "Reading live store");
    const live = await readStore(liveAdmin, baseline.types, (m, f) => ctx.progress(0.42 + f * 0.4, `Live: ${m}`));

    await ctx.progress(0.85, "Comparing");
    const changes = diffStores({ base: baseline.resources, staging: staging.resources, live: live.resources });
    const rows = changes.map((c) => ({
      compareId: record.id,
      type: c.type,
      key: c.key,
      title: c.title,
      status: c.status,
      action: c.action,
      selected: c.recommended,
      conflicts: c.conflicts.length ? JSON.stringify(c.conflicts) : null,
      decisions: null,
      baseData: c.base ? JSON.stringify(c.base) : null,
      stagingData: c.staging ? JSON.stringify(c.staging) : null,
      liveData: c.live ? JSON.stringify(c.live) : null,
      mergedData: c.merged ? JSON.stringify(c.merged) : null,
      transfer: c.transfer ? JSON.stringify(c.transfer) : null,
    }));
    for (let i = 0; i < rows.length; i += 100) await db.storeCompareItem.createMany({ data: rows.slice(i, i + 100) });

    let themeMergeId: string | null = null;
    let themeNote: string | null = null;
    if (payload.includeTheme === true) {
      const [liveMain, stagingMain] = await Promise.all([
        listThemes(liveAdmin).then((t) => t.find((x) => x.role === "MAIN")),
        listThemes(stagingAdmin).then((t) => t.find((x) => x.role === "MAIN")),
      ]);
      if (liveMain && stagingMain) {
        themeMergeId = await startThemeMerge({
          shop: ctx.shop,
          admin: liveAdmin,
          liveThemeId: liveMain.id,
          targetThemeId: stagingMain.id,
          baselineSnapshotId: baseline.themeSnapshotId,
          crossStore: { liveShop: pair.liveShop, targetShop: pair.stagingShop, liveAdmin, targetAdmin: stagingAdmin, pairId: pair.id },
        });
        if (!baseline.themeSnapshotId) themeNote = "No theme baseline: theme compare is two-way.";
      } else {
        themeNote = "Both stores need a published theme to compare themes.";
      }
    }

    let settingsDiff: SettingDiff[] | null = null;
    try {
      const [s, l] = await Promise.all([
        gql<{ shop: RawShopSettings }>(stagingAdmin, SHOP_SETTINGS),
        gql<{ shop: RawShopSettings }>(liveAdmin, SHOP_SETTINGS),
      ]);
      settingsDiff = diffSettings(s.shop, l.shop);
    } catch (error) {
      console.warn("[compare] settings diff failed", error);
    }

    const summary = {
      ...summarizeChanges(changes),
      themeMergeId,
      themeNote,
      settingsDiff,
      unknownGids: live.unknownGids.length + staging.unknownGids.length,
    };
    await db.storeCompare.update({ where: { id: record.id }, data: { status: "ready", summary: JSON.stringify(summary) } });
    return summary;
  } catch (error) {
    await db.storeCompare.update({ where: { id: record.id }, data: { status: "failed" } });
    throw error;
  }
}

export async function setItemSelected(shop: string, compareId: string, itemIds: string[], selected: boolean) {
  const record = await db.storeCompare.findUniqueOrThrow({ where: { id: compareId } });
  await getPair(record.pairId, shop);
  await db.storeCompareItem.updateMany({ where: { compareId, id: { in: itemIds }, action: { not: "none" } }, data: { selected } });
}

export async function setItemDecision(shop: string, itemId: string, conflictId: string, decision: "left" | "right" | "clear") {
  const item = await db.storeCompareItem.findUniqueOrThrow({ where: { id: itemId }, include: { compare: true } });
  await getPair(item.compare.pairId, shop);
  const decisions = item.decisions ? (JSON.parse(item.decisions) as Record<string, ConflictDecision>) : {};
  if (decision === "clear") delete decisions[conflictId];
  else decisions[conflictId] = decision;
  await db.storeCompareItem.update({ where: { id: itemId }, data: { decisions: JSON.stringify(decisions) } });
}

export function itemToChange(item: {
  type: string;
  key: string;
  title: string;
  status: string;
  action: string;
  conflicts: string | null;
  baseData: string | null;
  stagingData: string | null;
  liveData: string | null;
  mergedData: string | null;
  transfer: string | null;
}): ResourceChange {
  const parse = (s: string | null) => (s ? (JSON.parse(s) as JsonObject) : null);
  return {
    type: item.type as ResourceType,
    key: item.key,
    title: item.title,
    status: item.status as ResourceChange["status"],
    action: item.action as ResourceChange["action"],
    base: parse(item.baseData),
    staging: parse(item.stagingData),
    live: parse(item.liveData),
    merged: parse(item.mergedData),
    conflicts: item.conflicts ? (JSON.parse(item.conflicts) as JsonConflict[]) : [],
    transfer: parse(item.transfer),
    recommended: false,
  };
}

// ---------------------------------------------------------------------------
// Promote
// ---------------------------------------------------------------------------

export async function startPromotion(shop: string, compareId: string) {
  const record = await db.storeCompare.findUniqueOrThrow({ where: { id: compareId }, include: { items: { where: { selected: true } } } });
  const pair = await getPair(record.pairId, shop);
  if (record.status !== "ready") throw new Error("This comparison isn't ready");
  if (!record.items.length) throw new Error("Select at least one change to promote");
  const undecided = record.items.filter((i) => {
    if (!i.conflicts) return false;
    const conflicts = JSON.parse(i.conflicts) as JsonConflict[];
    const decisions = i.decisions ? (JSON.parse(i.decisions) as Record<string, unknown>) : {};
    return conflicts.some((c) => !decisions[c.id]);
  });
  if (undecided.length) throw new Error(`${undecided.length} selected change(s) still have undecided conflicts`);

  const promotion = await db.promotion.create({
    data: {
      pairId: pair.id,
      compareId,
      items: {
        create: record.items.map((i) => ({ type: i.type, key: i.key, title: i.title, action: i.action })),
      },
    },
  });
  const jobId = await enqueueJob(shop, "store.promote", { promotionId: promotion.id });
  await db.promotion.update({ where: { id: promotion.id }, data: { jobId } });
  return promotion.id;
}

async function promote(payload: Record<string, unknown>, ctx: JobContext) {
  const promotion = await db.promotion.findUniqueOrThrow({ where: { id: String(payload.promotionId) }, include: { items: true } });
  const pair = await getPair(promotion.pairId, ctx.shop);
  const compareItems = await db.storeCompareItem.findMany({ where: { compareId: promotion.compareId, selected: true } });
  await db.promotion.update({ where: { id: promotion.id }, data: { status: "running" } });

  const types = [...new Set(compareItems.map((i) => i.type as ResourceType))];
  const liveAdmin = await adminForShop(pair.liveShop);
  await ctx.progress(0.02, "Re-reading live store");
  const live = await readStore(liveAdmin, types, (m, f) => ctx.progress(0.02 + f * 0.3, `Live: ${m}`));
  const liveByRef = new Map(live.resources.map((r) => [refId(r.type, r.key), r]));

  // Pre-push snapshot of everything we're about to touch (for rollback).
  const affected = compareItems.map((i) => liveByRef.get(refId(i.type, i.key))).filter((r): r is NormalizedResource => Boolean(r));
  const prepushId = await saveSnapshot({ pairId: pair.id, kind: "prepush", shop: pair.liveShop, types, resources: affected });
  await db.promotion.update({ where: { id: promotion.id }, data: { prepushSnapshotId: prepushId } });

  const runnable: ExecutableChange[] = [];
  const itemByRef = new Map(promotion.items.map((i) => [refId(i.type, i.key), i]));
  for (const item of compareItems) {
    const ref = refId(item.type, item.key);
    const change = itemToChange(item);
    const current = liveByRef.get(ref) ?? null;
    const promotionItem = itemByRef.get(ref);
    if (!deepEqual(current?.data ?? null, change.live)) {
      if (promotionItem) {
        await db.promotionItem.update({
          where: { id: promotionItem.id },
          data: { status: "failed", error: "Live changed since this comparison. Run a new comparison and try again." },
        });
      }
      continue;
    }
    const decisions = item.decisions ? (JSON.parse(item.decisions) as Record<string, ConflictDecision>) : {};
    runnable.push({
      id: promotionItem?.id,
      type: change.type,
      key: change.key,
      title: change.title,
      action: change.action as ExecutableChange["action"],
      data: change.action === "delete" ? null : resolvedData(change, decisions),
      liveData: current?.data ?? null,
      transfer: change.transfer,
      liveGid: current?.gid ?? null,
    });
  }

  const ordered = sortChanges(runnable.map((c) => ({ ...c, merged: c.data as JsonObject | null, staging: c.data as JsonObject | null })));
  const results = await executeChanges({
    admin: liveAdmin,
    changes: ordered,
    refIndex: live.refIndex,
    publishCreated: publishCreatedToOnlineStore(),
    onResult: async (result, i, total) => {
      if (result.change.id) {
        await db.promotionItem.update({
          where: { id: result.change.id },
          data: {
            status: result.status,
            error: result.error ?? (result.warnings.length ? result.warnings.join("; ") : null),
            liveGid: result.change.liveGid,
            createdGid: result.change.action === "create" ? (result.gid ?? null) : null,
          },
        });
      }
      await ctx.progress(0.35 + (i / Math.max(total, 1)) * 0.6, `Promoted ${i}/${total}`);
    },
  });

  // Advance the baseline for promoted resources so they don't show up as pending again.
  const done = results.filter((r) => r.status === "done");
  if (pair.baselineSnapshotId && done.length) {
    for (const r of done) {
      const item = compareItems.find((i) => i.type === r.change.type && i.key === r.change.key);
      const where = { snapshotId_type_key: { snapshotId: pair.baselineSnapshotId, type: r.change.type, key: r.change.key } };
      if (r.change.action === "delete") {
        await db.storeSnapshotItem.deleteMany({ where: { snapshotId: pair.baselineSnapshotId, type: r.change.type, key: r.change.key } });
      } else if (item?.stagingData) {
        await db.storeSnapshotItem.upsert({
          where,
          create: { snapshotId: pair.baselineSnapshotId, type: r.change.type, key: r.change.key, gid: r.gid ?? null, title: r.change.title, data: item.stagingData, transfer: item.transfer },
          update: { data: item.stagingData, gid: r.gid ?? null },
        });
      }
    }
  }

  const failed = await db.promotionItem.count({ where: { promotionId: promotion.id, status: "failed" } });
  const status = failed === 0 ? "done" : done.length ? "partial" : "failed";
  const summary = { done: done.length, failed };
  await db.promotion.update({ where: { id: promotion.id }, data: { status, summary: JSON.stringify(summary), finishedAt: new Date() } });
  return summary;
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export async function startRollback(shop: string, promotionId: string) {
  const promotion = await db.promotion.findUniqueOrThrow({ where: { id: promotionId } });
  await getPair(promotion.pairId, shop);
  if (!["done", "partial"].includes(promotion.status)) throw new Error("Only finished promotions can be rolled back");
  if (!promotion.prepushSnapshotId) throw new Error("This promotion has no pre-push snapshot");
  return enqueueJob(shop, "store.rollback", { promotionId });
}

async function rollback(payload: Record<string, unknown>, ctx: JobContext) {
  const promotion = await db.promotion.findUniqueOrThrow({ where: { id: String(payload.promotionId) }, include: { items: { where: { status: "done" } } } });
  const pair = await getPair(promotion.pairId, ctx.shop);
  const prepush = await loadSnapshot(promotion.prepushSnapshotId as string);
  const before = new Map(prepush.resources.map((r) => [refId(r.type, r.key), r]));
  const types = [...new Set(promotion.items.map((i) => i.type as ResourceType))];
  const liveAdmin = await adminForShop(pair.liveShop);
  const live = await readStore(liveAdmin, types, (m, f) => ctx.progress(f * 0.3, `Live: ${m}`));
  const current = new Map(live.resources.map((r) => [refId(r.type, r.key), r]));

  const changes: ExecutableChange[] = [];
  for (const item of promotion.items) {
    const ref = refId(item.type, item.key);
    const prior = before.get(ref);
    const now = current.get(ref);
    if (item.action === "create") {
      if (now) changes.push({ id: item.id, type: item.type as ResourceType, key: item.key, title: item.title, action: "delete", data: null, liveData: now.data, transfer: null, liveGid: now.gid });
    } else if (prior) {
      changes.push({
        id: item.id,
        type: item.type as ResourceType,
        key: item.key,
        title: item.title,
        action: now ? "update" : "create",
        data: prior.data,
        liveData: now?.data ?? null,
        transfer: prior.transfer ?? null,
        liveGid: now?.gid ?? null,
      });
    }
  }
  const ordered = sortChanges(changes.map((c) => ({ ...c, merged: c.data as JsonObject | null, staging: c.data as JsonObject | null })));
  const results = await executeChanges({
    admin: liveAdmin,
    changes: ordered,
    refIndex: live.refIndex,
    publishCreated: false,
    onResult: async (result, i, total) => {
      if (result.change.id) {
        await db.promotionItem.update({
          where: { id: result.change.id },
          data: { status: result.status === "done" ? "rolled-back" : "rollback-failed", error: result.error ?? null },
        });
      }
      await ctx.progress(0.3 + (i / Math.max(total, 1)) * 0.65, `Rolled back ${i}/${total}`);
    },
  });

  // Point the baseline back at the restored live state so the staging change shows as pending again.
  if (pair.baselineSnapshotId) {
    for (const r of results.filter((x) => x.status === "done")) {
      const prior = before.get(refId(r.change.type, r.change.key));
      if (prior) {
        await db.storeSnapshotItem.upsert({
          where: { snapshotId_type_key: { snapshotId: pair.baselineSnapshotId, type: prior.type, key: prior.key } },
          create: { snapshotId: pair.baselineSnapshotId, type: prior.type, key: prior.key, gid: prior.gid, title: prior.title, data: JSON.stringify(prior.data), transfer: prior.transfer ? JSON.stringify(prior.transfer) : null },
          update: { data: JSON.stringify(prior.data) },
        });
      } else {
        await db.storeSnapshotItem.deleteMany({ where: { snapshotId: pair.baselineSnapshotId, type: r.change.type, key: r.change.key } });
      }
    }
  }
  const failed = results.filter((r) => r.status === "failed").length;
  await db.promotion.update({ where: { id: promotion.id }, data: { status: failed ? "partial" : "rolled-back" } });
  return { rolledBack: results.length - failed, failed };
}

registerJobHandler("store.clone", clone);
registerJobHandler("store.compare", compare);
registerJobHandler("store.promote", promote);
registerJobHandler("store.rollback", rollback);
