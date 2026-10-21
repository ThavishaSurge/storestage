/**
 * ThemeMerge: analysis, decisions, export and apply.
 */
import { zipSync, strToU8 } from "fflate";
import db from "../db.server";
import {
  buildWritePlan,
  classifyFiles,
  compareMode,
  mergeThemeFile,
  renderFileMerge,
  summarize,
  unresolvedCount,
  type FileMergeData,
  type FilePlan,
  type Presence,
  type Resolution,
  type WritePlan,
} from "../lib/theme/compare";
import type { ConflictDecision } from "../lib/merge/json3";
import { renderWithMarkers, type HunkDecision } from "../lib/merge/text3";
import { adminForShop, type AdminClient } from "./admin.server";
import { enqueueJob, registerJobHandler, type JobContext } from "./jobs.server";
import {
  deleteThemeFiles,
  duplicateTheme,
  fetchThemeFileBodies,
  fetchThemeFileMeta,
  getTheme,
  loadSnapshotBodies,
  loadSnapshotMeta,
  snapshotTheme,
  upsertThemeFiles,
} from "./themes.server";

// ---------------------------------------------------------------------------
// Working copies
// ---------------------------------------------------------------------------

/** Duplicates `sourceThemeId` and records a baseline snapshot so later merges are three-way. */
async function createWorkingCopy(payload: Record<string, unknown>, ctx: JobContext) {
  const admin = await adminForShop(ctx.shop);
  const source = await getTheme(admin, String(payload.sourceThemeId));
  if (!source) throw new Error("Source theme not found");
  await ctx.progress(0.05, "Snapshotting the live theme");
  const snapshotId = await snapshotTheme({
    admin,
    shop: ctx.shop,
    theme: source,
    reason: "working-copy",
    label: `Baseline for working copy of ${source.name}`,
    onProgress: (f) => ctx.progress(0.05 + f * 0.6, "Snapshotting the live theme"),
  });
  await ctx.progress(0.7, "Duplicating theme");
  const copy = await duplicateTheme(admin, source.id, String(payload.name || `${source.name} (working copy)`));
  await db.themeLink.create({
    data: { shop: ctx.shop, workingThemeId: copy.id, sourceThemeId: source.id, baselineSnapshotId: snapshotId },
  });
  return { themeId: copy.id, themeName: copy.name, snapshotId };
}

/**
 * For a copy the team duplicated by hand: snapshot the source *now* and treat it as the baseline.
 * Only correct if nobody edited the source theme since the copy was made.
 */
async function recordBaseline(payload: Record<string, unknown>, ctx: JobContext) {
  const admin = await adminForShop(ctx.shop);
  const source = await getTheme(admin, String(payload.sourceThemeId));
  if (!source) throw new Error("Source theme not found");
  const snapshotId = await snapshotTheme({
    admin,
    shop: ctx.shop,
    theme: source,
    reason: "working-copy",
    label: `Baseline recorded for ${String(payload.workingThemeName ?? payload.workingThemeId)}`,
    onProgress: (f) => ctx.progress(f * 0.95, "Snapshotting the live theme"),
  });
  await db.themeLink.upsert({
    where: { shop_workingThemeId: { shop: ctx.shop, workingThemeId: String(payload.workingThemeId) } },
    create: { shop: ctx.shop, workingThemeId: String(payload.workingThemeId), sourceThemeId: source.id, baselineSnapshotId: snapshotId },
    update: { sourceThemeId: source.id, baselineSnapshotId: snapshotId },
  });
  return { snapshotId };
}

async function manualSnapshot(payload: Record<string, unknown>, ctx: JobContext) {
  const admin = await adminForShop(ctx.shop);
  const theme = await getTheme(admin, String(payload.themeId));
  if (!theme) throw new Error("Theme not found");
  const snapshotId = await snapshotTheme({
    admin,
    shop: ctx.shop,
    theme,
    reason: "manual",
    label: payload.label ? String(payload.label) : undefined,
    onProgress: (f) => ctx.progress(f * 0.95, "Snapshotting theme"),
  });
  return { snapshotId };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export async function startThemeMerge(args: {
  shop: string;
  admin: AdminClient;
  liveThemeId: string;
  targetThemeId: string;
  baselineSnapshotId?: string | null;
}) {
  const [live, target] = await Promise.all([getTheme(args.admin, args.liveThemeId), getTheme(args.admin, args.targetThemeId)]);
  if (!live || !target) throw new Error("Theme not found");
  if (live.id === target.id) throw new Error("Pick two different themes");

  let baselineSnapshotId = args.baselineSnapshotId || null;
  if (!baselineSnapshotId) {
    const link = await db.themeLink.findUnique({ where: { shop_workingThemeId: { shop: args.shop, workingThemeId: target.id } } });
    if (link && link.sourceThemeId === live.id) baselineSnapshotId = link.baselineSnapshotId;
  }
  const forkTime = new Date(target.createdAt);
  const mode = compareMode({ base: baselineSnapshotId ? new Map() : null, forkTime });

  const merge = await db.themeMerge.create({
    data: {
      shop: args.shop,
      liveThemeId: live.id,
      liveThemeName: live.name,
      targetThemeId: target.id,
      targetThemeName: target.name,
      baselineSnapshotId,
      mode,
      forkTime,
    },
  });
  const jobId = await enqueueJob(args.shop, "theme.analyze", { mergeId: merge.id });
  await db.themeMerge.update({ where: { id: merge.id }, data: { jobId } });
  return merge.id;
}

async function analyze(payload: Record<string, unknown>, ctx: JobContext) {
  const merge = await db.themeMerge.findFirstOrThrow({ where: { id: String(payload.mergeId), shop: ctx.shop } });
  const admin = await adminForShop(ctx.shop);
  try {
    await ctx.progress(0.02, "Listing files");
    const [live, target, base] = await Promise.all([
      fetchThemeFileMeta(admin, merge.liveThemeId),
      fetchThemeFileMeta(admin, merge.targetThemeId),
      merge.baselineSnapshotId ? loadSnapshotMeta(merge.baselineSnapshotId) : Promise.resolve(null),
    ]);
    const plans = classifyFiles({ base, live, target, forkTime: merge.forkTime });
    const relevant = plans.filter((p) => p.status !== "unchanged");

    // Bodies: live + target for every changed file (binary included, for applying "take live").
    const needLive = relevant.filter((p) => p.presence.live).map((p) => p.filename);
    const needTarget = relevant.filter((p) => p.presence.target && p.kind !== "binary").map((p) => p.filename);
    await ctx.progress(0.1, `Downloading ${needLive.length + needTarget.length} changed files`);
    const total = Math.max(needLive.length + needTarget.length, 1);
    const liveBodies = await fetchThemeFileBodies(admin, merge.liveThemeId, needLive, (n) => ctx.progress(0.1 + (n / total) * 0.7));
    const targetBodies = await fetchThemeFileBodies(admin, merge.targetThemeId, needTarget, (n) =>
      ctx.progress(0.1 + ((needLive.length + n) / total) * 0.7),
    );
    const baseBodies = merge.baselineSnapshotId
      ? await loadSnapshotBodies(merge.baselineSnapshotId, relevant.filter((p) => p.needsMerge).map((p) => p.filename))
      : new Map<string, string>();

    await ctx.progress(0.85, "Merging");
    const rows = relevant.map((plan) => buildRow(merge.id, plan, liveBodies.get(plan.filename), targetBodies.get(plan.filename), baseBodies.get(plan.filename) ?? null));
    await db.themeMergeFile.deleteMany({ where: { mergeId: merge.id } });
    for (let i = 0; i < rows.length; i += 100) await db.themeMergeFile.createMany({ data: rows.slice(i, i + 100) });

    const summary = summarize(rows.map((r) => ({ status: r.status as FilePlan["status"], resolved: r.resolved })));
    summary.counts.unchanged = plans.length - relevant.length;
    summary.total = plans.length;
    await db.themeMerge.update({ where: { id: merge.id }, data: { status: "ready", summary: JSON.stringify(summary) } });
    return { mergeId: merge.id, summary };
  } catch (error) {
    await db.themeMerge.update({ where: { id: merge.id }, data: { status: "failed" } });
    throw error;
  }
}

function buildRow(
  mergeId: string,
  plan: FilePlan,
  live: { body: string; encoding: "text" | "base64" } | undefined,
  target: { body: string; encoding: "text" | "base64" } | undefined,
  base: string | null,
) {
  let status = plan.status as string;
  let resolved = plan.resolved;
  let conflictCount = plan.resolved ? 0 : 1;
  let mergeData: string | null = null;
  let resultBody: string | null = null;

  if (plan.needsMerge && live && target && live.encoding === "text") {
    const outcome = mergeThemeFile({ kind: plan.kind, base, live: live.body, target: target.body });
    status = outcome.status;
    resolved = outcome.status === "auto-merged";
    conflictCount = outcome.conflictCount;
    mergeData = JSON.stringify(outcome.data);
    resultBody = outcome.resultBody;
  }

  return {
    mergeId,
    filename: plan.filename,
    kind: plan.kind,
    status,
    reason: plan.reason,
    presence: JSON.stringify(plan.presence),
    resolution: plan.resolution,
    resolved,
    conflictCount,
    baseBody: base,
    liveBody: live?.body ?? null,
    targetBody: target?.body ?? null,
    encoding: live?.encoding ?? target?.encoding ?? "text",
    mergeData,
    resultBody,
  };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export async function setFileResolution(shop: string, mergeId: string, filename: string, resolution: Resolution) {
  const file = await getMergeFile(shop, mergeId, filename);
  const data = file.mergeData ? (JSON.parse(file.mergeData) as FileMergeData) : null;
  if (resolution === "merged" && !data) throw new Error("This file has no merge result; pick live, target or delete.");
  const resolved = resolution === "merged" && data ? unresolvedCount(data) === 0 : true;
  await db.themeMergeFile.update({ where: { id: file.id }, data: { resolution, resolved } });
  await refreshSummary(mergeId);
}

/** Records a decision for one conflict (JSON path id or text hunk number) inside a merged file. */
export async function setConflictDecision(
  shop: string,
  mergeId: string,
  filename: string,
  conflictId: string,
  decision: "left" | "right" | "left-then-right" | "right-then-left" | "clear",
) {
  const file = await getMergeFile(shop, mergeId, filename);
  if (!file.mergeData) throw new Error("No conflicts to decide");
  const data = JSON.parse(file.mergeData) as FileMergeData;
  if (data.mode === "json") {
    if (decision === "clear") delete data.decisions[conflictId];
    else if (decision === "left" || decision === "right") data.decisions[conflictId] = decision as ConflictDecision;
    else throw new Error("Combining both sides only applies to text hunks");
  } else {
    const id = Number(conflictId);
    if (decision === "clear") delete data.decisions[id];
    else data.decisions[id] = decision as HunkDecision;
  }
  const resultBody = renderFileMerge(data);
  const remaining = unresolvedCount(data);
  await db.themeMergeFile.update({
    where: { id: file.id },
    data: { mergeData: JSON.stringify(data), resultBody, resolution: "merged", resolved: remaining === 0, conflictCount: remaining },
  });
  await refreshSummary(mergeId);
}

/** Resolves every conflict in a file at once (all live / all target). */
export async function decideAll(shop: string, mergeId: string, filename: string, decision: "left" | "right") {
  const file = await getMergeFile(shop, mergeId, filename);
  if (!file.mergeData) throw new Error("No conflicts to decide");
  const data = JSON.parse(file.mergeData) as FileMergeData;
  if (data.mode === "json") for (const c of data.conflicts) data.decisions[c.id] = decision;
  else for (const r of data.regions) if (r.type === "conflict") data.decisions[r.id] = decision;
  await db.themeMergeFile.update({
    where: { id: file.id },
    data: { mergeData: JSON.stringify(data), resultBody: renderFileMerge(data), resolution: "merged", resolved: true, conflictCount: 0 },
  });
  await refreshSummary(mergeId);
}

/** Saves hand-edited content for a file. */
export async function setCustomContent(shop: string, mergeId: string, filename: string, content: string) {
  const file = await getMergeFile(shop, mergeId, filename);
  if (file.kind === "binary") throw new Error("Binary files can't be edited");
  await db.themeMergeFile.update({ where: { id: file.id }, data: { resultBody: content, resolution: "merged", resolved: true, conflictCount: 0 } });
  await refreshSummary(mergeId);
}

async function getMergeFile(shop: string, mergeId: string, filename: string) {
  const merge = await db.themeMerge.findFirst({ where: { id: mergeId, shop } });
  if (!merge) throw new Error("Merge not found");
  if (merge.status === "applied") throw new Error("This merge was already applied");
  return db.themeMergeFile.findUniqueOrThrow({ where: { mergeId_filename: { mergeId, filename } } });
}

async function refreshSummary(mergeId: string) {
  const merge = await db.themeMerge.findUniqueOrThrow({ where: { id: mergeId } });
  const files = await db.themeMergeFile.findMany({ where: { mergeId }, select: { status: true, resolved: true } });
  const previous = merge.summary ? (JSON.parse(merge.summary) as ReturnType<typeof summarize>) : null;
  const summary = summarize(files.map((f) => ({ status: f.status as FilePlan["status"], resolved: f.resolved })));
  summary.counts.unchanged = previous?.counts.unchanged ?? 0;
  summary.total = files.length + summary.counts.unchanged;
  await db.themeMerge.update({ where: { id: mergeId }, data: { summary: JSON.stringify(summary) } });
}

// ---------------------------------------------------------------------------
// Export & apply
// ---------------------------------------------------------------------------

async function resolvedFiles(mergeId: string) {
  const files = await db.themeMergeFile.findMany({ where: { mergeId }, orderBy: { filename: "asc" } });
  return files.map((f) => ({
    row: f,
    resolved: {
      filename: f.filename,
      resolution: f.resolution as Resolution,
      targetBody: f.targetBody,
      liveBody: f.liveBody,
      resultBody: f.resultBody,
      encoding: f.encoding as "text" | "base64",
      presence: JSON.parse(f.presence) as Presence,
    },
  }));
}

/** Writes needed, relative to the working copy. */
function writePlanFor(files: Awaited<ReturnType<typeof resolvedFiles>>): WritePlan {
  return buildWritePlan(files.map((f) => f.resolved));
}

/**
 * Zip of every file that must change in the target theme (theme folder layout, ready for
 * `shopify theme push --only ...`), plus MERGE-REPORT.md. Unresolved text conflicts are written
 * with git-style conflict markers and listed in the report.
 */
export async function buildExportZip(shop: string, mergeId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const merge = await db.themeMerge.findFirstOrThrow({ where: { id: mergeId, shop } });
  const files = await resolvedFiles(mergeId);
  const plan = writePlanFor(files);
  const entries: Record<string, Uint8Array> = {};
  const unresolved: string[] = [];

  for (const u of plan.upserts) {
    const row = files.find((f) => f.row.filename === u.filename)?.row;
    let body = u.body;
    if (row && !row.resolved && row.mergeData) {
      const data = JSON.parse(row.mergeData) as FileMergeData;
      if (data.mode === "text") body = renderWithMarkers(data.regions, { left: `live (${merge.liveThemeName})`, right: `working copy (${merge.targetThemeName})` });
      unresolved.push(u.filename);
    }
    entries[`theme/${u.filename}`] = u.encoding === "base64" ? Uint8Array.from(Buffer.from(body, "base64")) : strToU8(body);
  }
  for (const f of files) if (!f.row.resolved && !unresolved.includes(f.row.filename)) unresolved.push(f.row.filename);

  const report = [
    `# Theme merge report`,
    ``,
    `- Live theme: **${merge.liveThemeName}** (${merge.liveThemeId})`,
    `- Working copy: **${merge.targetThemeName}** (${merge.targetThemeId})`,
    `- Mode: ${merge.mode}`,
    `- Generated: ${new Date().toISOString()}`,
    ``,
    `## Files to write into the working copy (${plan.upserts.length})`,
    ...plan.upserts.map((u) => `- ${u.filename}`),
    ``,
    `## Files to delete (${plan.deletes.length})`,
    ...plan.deletes.map((d) => `- ${d}`),
    ``,
    `## Unresolved (${unresolved.length})`,
    ...(unresolved.length ? unresolved.map((u) => `- ${u}`) : ["None"]),
    ``,
    `## Push with Shopify CLI`,
    "```",
    `cd theme`,
    `# Push into the working copy:`,
    `shopify theme push --store ${merge.shop} --theme ${merge.targetThemeId.split("/").pop()} --nodelete${plan.upserts.length ? ` --only ${plan.upserts.map((u) => u.filename).join(" --only ")}` : ""}`,
    "```",
    plan.deletes.length ? `Then delete these files in the code editor: ${plan.deletes.join(", ")}` : "",
  ].join("\n");
  entries["MERGE-REPORT.md"] = strToU8(report);
  entries["deletions.txt"] = strToU8(plan.deletes.join("\n"));

  return {
    filename: `theme-merge-${merge.targetThemeName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`,
    bytes: zipSync(entries, { level: 6 }),
  };
}

/**
 * Where a same-store merge is written:
 *   "in-place"  overwrite the working copy (snapshotted first, so it can be rolled back)
 *   "new-copy"  duplicate the working copy and write the merged result into the duplicate,
 *               leaving the working copy untouched.
 */
export type ApplyMode = "in-place" | "new-copy";

/**
 * Every file of the merged theme, in Shopify's zip layout: the base theme's files with merged
 * bodies substituted and planned deletions dropped. Upload it under Online Store -> Themes ->
 * Add theme -> Upload zip file and Shopify creates a new unpublished theme from it.
 *
 * Needs read_themes only, so this works before the theme-write exemption is granted. Unlike the
 * delta zip it reads every file of the theme (including binary assets, which are downloaded one
 * by one), so it is slow on a large theme and refuses to run while any file is undecided --
 * a theme containing conflict markers would not be importable.
 */
export async function buildFullThemeZip(shop: string, mergeId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const merge = await db.themeMerge.findFirstOrThrow({ where: { id: mergeId, shop } });
  const undecided = await db.themeMergeFile.count({ where: { mergeId, resolved: false } });
  if (undecided) throw new Error(`${undecided} file(s) still need a decision before a full theme can be built`);

  const plan = writePlanFor(await resolvedFiles(merge.id));
  const baseThemeId = merge.targetThemeId; // the plan is expressed against the working copy
  const admin = await adminForShop(merge.shop);

  const upserts = new Map(plan.upserts.map((u) => [u.filename, u]));
  const deletes = new Set(plan.deletes);
  const meta = await fetchThemeFileMeta(admin, baseThemeId);
  const carried = [...meta.keys()].filter((f) => !upserts.has(f) && !deletes.has(f));
  const bodies = await fetchThemeFileBodies(admin, baseThemeId, carried);

  // Theme files sit at the root of the zip; Shopify rejects anything it doesn't recognise, so
  // no MERGE-REPORT.md here -- the delta zip carries that.
  const entries: Record<string, Uint8Array> = {};
  for (const [filename, u] of upserts) {
    entries[filename] = u.encoding === "base64" ? Uint8Array.from(Buffer.from(u.body, "base64")) : strToU8(u.body);
  }
  const missing: string[] = [];
  for (const filename of carried) {
    const body = bodies.get(filename);
    if (!body) {
      missing.push(filename); // deleted between the metadata read and the body read
      continue;
    }
    entries[filename] = body.encoding === "base64" ? Uint8Array.from(Buffer.from(body.body, "base64")) : strToU8(body.body);
  }
  if (missing.length) throw new Error(`Couldn't read ${missing.length} file(s) from the theme (${missing.slice(0, 3).join(", ")}). Try again.`);

  return {
    filename: `theme-merged-${merge.targetThemeName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`,
    bytes: zipSync(entries, { level: 6 }),
  };
}

export async function startApply(shop: string, mergeId: string, mode: ApplyMode = "in-place") {
  const merge = await db.themeMerge.findFirstOrThrow({ where: { id: mergeId, shop } });
  if (merge.status !== "ready") throw new Error("This merge isn't ready to apply");
  const unresolved = await db.themeMergeFile.count({ where: { mergeId, resolved: false } });
  if (unresolved) throw new Error(`${unresolved} file(s) still need a decision`);
  return enqueueJob(shop, "theme.apply", { mergeId, mode });
}

async function apply(payload: Record<string, unknown>, ctx: JobContext) {
  const merge = await db.themeMerge.findFirstOrThrow({ where: { id: String(payload.mergeId), shop: ctx.shop } });
  const admin = await adminForShop(ctx.shop);
  const target = await getTheme(admin, merge.targetThemeId);
  if (!target) throw new Error("Working copy no longer exists");
  if (target.role === "MAIN") throw new Error("The working copy has been published; merges are only applied to unpublished themes");

  const plan = writePlanFor(await resolvedFiles(merge.id));
  if (payload.mode === "new-copy") {
    // The write plan is expressed relative to the working copy, and a duplicate starts out
    // identical to it, so the same upserts/deletes yield the merged theme.
    await ctx.progress(0.05, "Duplicating the working copy");
    const copy = await duplicateTheme(admin, target.id, stampedThemeName(target.name, "merged"));
    await waitForTheme(admin, copy.id);
    await ctx.progress(0.3, `Writing ${plan.upserts.length} files`);
    await upsertThemeFiles(admin, copy.id, plan.upserts, (n) => ctx.progress(0.3 + (n / Math.max(plan.upserts.length, 1)) * 0.6));
    if (plan.deletes.length) await deleteThemeFiles(admin, copy.id, plan.deletes);
    await db.themeMerge.update({ where: { id: merge.id }, data: { status: "applied", appliedAt: new Date() } });
    return { themeId: copy.id, themeName: copy.name, written: plan.upserts.length, deleted: plan.deletes.length };
  }

  await ctx.progress(0.05, "Snapshotting the working copy (for rollback)");
  const snapshotId = await snapshotTheme({ admin, shop: ctx.shop, theme: target, reason: "pre-apply", label: `Before merge ${merge.id}` });

  await ctx.progress(0.4, `Writing ${plan.upserts.length} files`);
  await upsertThemeFiles(admin, target.id, plan.upserts, (n) => ctx.progress(0.4 + (n / Math.max(plan.upserts.length, 1)) * 0.5));
  if (plan.deletes.length) await deleteThemeFiles(admin, target.id, plan.deletes);
  await db.themeMerge.update({ where: { id: merge.id }, data: { status: "applied", appliedAt: new Date() } });
  return { written: plan.upserts.length, deleted: plan.deletes.length, preApplySnapshotId: snapshotId };
}

/** Shopify caps theme names at 50 characters. */
function stampedThemeName(base: string, label: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `${base} ${label} ${stamp}`.slice(0, 50);
}

async function waitForTheme(admin: AdminClient, themeId: string) {
  for (let i = 0; i < 60; i++) {
    const theme = await getTheme(admin, themeId);
    if (theme && !theme.processing) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("The duplicated theme is still processing; try again in a minute");
}

registerJobHandler("theme.workingCopy", createWorkingCopy);
registerJobHandler("theme.recordBaseline", recordBaseline);
registerJobHandler("theme.snapshot", manualSnapshot);
registerJobHandler("theme.analyze", analyze);
registerJobHandler("theme.apply", apply);
