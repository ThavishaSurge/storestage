/**
 * Theme merge planner.
 *
 * Inputs: file metadata for the LIVE theme (has client edits we must not lose), the TARGET theme
 * (the working copy we want to publish) and, when available, a BASE snapshot (the live theme at
 * the moment the working copy was made).
 *
 * With a base we do a true three-way classification. Without one we fall back to a timestamp
 * heuristic: anything modified after the fork time (the working copy's createdAt) on a given side
 * is considered changed on that side.
 *
 * The output says, per file, what the TARGET theme should end up with.
 */
import { classifyThemeFile, parseThemeJson, serializeThemeJson, type ThemeFileKind } from "./files";
import {
  mergeText2,
  mergeText3,
  renderMergedText,
  type HunkDecision,
  type TextRegion,
} from "../merge/text3";
import { applyDecisions, merge3, type ConflictDecision, type JsonConflict } from "../merge/json3";

export interface ThemeFileMeta {
  filename: string;
  checksum: string | null;
  size: number;
  contentType: string;
  updatedAt: string; // ISO timestamp
}

export type CompareMode = "three-way" | "heuristic" | "two-way";

export type FileStatus =
  | "unchanged"
  | "live-changed"
  | "target-changed"
  | "both-same"
  | "auto-merged"
  | "conflict";

/** What the target theme should end up with. */
export type Resolution = "keep" | "live" | "merged" | "delete";

export interface Presence {
  base: boolean | null;
  live: boolean;
  target: boolean;
}

export interface FilePlan {
  filename: string;
  kind: ThemeFileKind;
  status: FileStatus;
  reason: string;
  presence: Presence;
  resolution: Resolution;
  /** True when the file must be content-merged (both sides changed it). */
  needsMerge: boolean;
  /** False until a human decides (delete/modify clashes, binary clashes, unresolved hunks). */
  resolved: boolean;
}

export interface ClassifyInput {
  base: Map<string, ThemeFileMeta> | null;
  live: Map<string, ThemeFileMeta>;
  target: Map<string, ThemeFileMeta>;
  /** Fork time for heuristic mode, usually the target theme's createdAt. */
  forkTime?: Date | null;
  /** Edits within this window after the fork are attributed to the duplication itself. */
  graceMs?: number;
}

export const DEFAULT_GRACE_MS = 10 * 60 * 1000;

export function compareMode(input: Pick<ClassifyInput, "base" | "forkTime">): CompareMode {
  if (input.base) return "three-way";
  if (input.forkTime) return "heuristic";
  return "two-way";
}

function signature(meta: ThemeFileMeta | undefined): string | null {
  if (!meta) return null;
  return meta.checksum ?? `size:${meta.size}:${meta.updatedAt}`;
}

export function classifyFiles(input: ClassifyInput): FilePlan[] {
  const { base, live, target } = input;
  const mode = compareMode(input);
  const names = new Set<string>([...live.keys(), ...target.keys(), ...(base ? base.keys() : [])]);
  const plans: FilePlan[] = [];

  for (const filename of [...names].sort()) {
    const l = live.get(filename);
    const t = target.get(filename);
    const b = base?.get(filename);
    if (!l && !t) continue; // deleted on both sides
    const kind = classifyThemeFile(filename, (l ?? t ?? b)?.contentType);
    const presence: Presence = { base: base ? Boolean(b) : null, live: Boolean(l), target: Boolean(t) };
    plans.push(
      mode === "three-way"
        ? classifyThreeWay(filename, kind, presence, b, l, t)
        : classifyHeuristic(filename, kind, presence, l, t, mode, input),
    );
  }
  return plans;
}

function plan(
  filename: string,
  kind: ThemeFileKind,
  presence: Presence,
  status: FileStatus,
  resolution: Resolution,
  reason: string,
  extra: Partial<Pick<FilePlan, "needsMerge" | "resolved">> = {},
): FilePlan {
  return {
    filename,
    kind,
    presence,
    status,
    resolution,
    reason,
    needsMerge: extra.needsMerge ?? false,
    resolved: extra.resolved ?? true,
  };
}

function classifyThreeWay(
  filename: string,
  kind: ThemeFileKind,
  presence: Presence,
  b: ThemeFileMeta | undefined,
  l: ThemeFileMeta | undefined,
  t: ThemeFileMeta | undefined,
): FilePlan {
  const sb = signature(b);
  const sl = signature(l);
  const st = signature(t);
  const liveChanged = sl !== sb;
  const targetChanged = st !== sb;

  if (!liveChanged && !targetChanged) {
    return plan(filename, kind, presence, "unchanged", "keep", "Unchanged on both sides.");
  }
  if (liveChanged && !targetChanged) {
    return l
      ? plan(filename, kind, presence, "live-changed", "live", b ? "Changed on live after the working copy was made." : "Added on live after the working copy was made.")
      : plan(filename, kind, presence, "live-changed", "delete", "Deleted on live after the working copy was made.");
  }
  if (!liveChanged && targetChanged) {
    return plan(filename, kind, presence, "target-changed", "keep", t ? (b ? "Changed in the working copy." : "Added in the working copy.") : "Deleted in the working copy.");
  }
  if (sl === st) {
    return plan(filename, kind, presence, "both-same", "keep", "Both sides made the same change.");
  }
  if (!l || !t) {
    return plan(
      filename,
      kind,
      presence,
      "conflict",
      "keep",
      !l ? "Deleted on live but modified in the working copy." : "Modified on live but deleted in the working copy.",
      { resolved: false },
    );
  }
  if (kind === "binary") {
    return plan(filename, kind, presence, "conflict", "keep", "Binary file changed on both sides.", { resolved: false });
  }
  return plan(filename, kind, presence, "conflict", "merged", "Changed on both sides.", { needsMerge: true, resolved: false });
}

function classifyHeuristic(
  filename: string,
  kind: ThemeFileKind,
  presence: Presence,
  l: ThemeFileMeta | undefined,
  t: ThemeFileMeta | undefined,
  mode: CompareMode,
  input: ClassifyInput,
): FilePlan {
  if (l && t && signature(l) === signature(t)) {
    return plan(filename, kind, presence, "unchanged", "keep", "Identical in both themes.");
  }

  if (mode === "two-way") {
    if (!l) return plan(filename, kind, presence, "target-changed", "keep", "Only exists in the working copy.");
    if (!t) return plan(filename, kind, presence, "conflict", "keep", "Only exists in the live theme.", { resolved: false });
    if (kind === "binary") return plan(filename, kind, presence, "conflict", "keep", "Binary file differs.", { resolved: false });
    return plan(filename, kind, presence, "conflict", "merged", "Differs between themes (no baseline to tell who changed it).", { needsMerge: true, resolved: false });
  }

  const cutoff = (input.forkTime as Date).getTime() + (input.graceMs ?? DEFAULT_GRACE_MS);
  const touched = (m: ThemeFileMeta | undefined) => Boolean(m && Date.parse(m.updatedAt) > cutoff);
  const lt = touched(l);
  const tt = touched(t);

  if (l && !t) {
    return lt
      ? plan(filename, kind, presence, "live-changed", "live", "Added on live after the working copy was made.")
      : plan(filename, kind, presence, "target-changed", "keep", "Deleted in the working copy.");
  }
  if (!l && t) {
    return tt
      ? plan(filename, kind, presence, "target-changed", "keep", "Added in the working copy.")
      : plan(filename, kind, presence, "live-changed", "delete", "Probably deleted on live after the working copy was made.");
  }
  if (lt && !tt) {
    return plan(filename, kind, presence, "live-changed", "live", "Edited on live after the working copy was made.");
  }
  if (!lt && tt) {
    return plan(filename, kind, presence, "target-changed", "keep", "Edited in the working copy.");
  }
  if (kind === "binary") {
    return plan(filename, kind, presence, "conflict", "keep", "Binary file edited on both sides.", { resolved: false });
  }
  return plan(
    filename,
    kind,
    presence,
    "conflict",
    "merged",
    lt && tt ? "Edited on both sides after the working copy was made." : "Differs, but timestamps don't show which side changed it.",
    { needsMerge: true, resolved: false },
  );
}

// ---------------------------------------------------------------------------
// Content merge
// ---------------------------------------------------------------------------

export type FileMergeData =
  | {
      mode: "json";
      header: string;
      merged: unknown;
      conflicts: JsonConflict[];
      decisions: Record<string, ConflictDecision>;
    }
  | {
      mode: "text";
      regions: TextRegion[];
      decisions: Record<number, HunkDecision>;
    };

export interface FileMergeOutcome {
  status: "auto-merged" | "conflict";
  conflictCount: number;
  data: FileMergeData;
  resultBody: string;
}

export function mergeThemeFile(args: {
  kind: ThemeFileKind;
  base: string | null;
  live: string;
  target: string;
}): FileMergeOutcome {
  const { kind, base, live, target } = args;

  if (kind === "json") {
    try {
      const pl = parseThemeJson(live);
      const pt = parseThemeJson(target);
      const pb = base !== null ? parseThemeJson(base) : null;
      const { value, conflicts } = merge3(pb ? pb.value : undefined, pl.value, pt.value);
      const data: FileMergeData = {
        mode: "json",
        header: pt.header || pl.header,
        merged: value,
        conflicts,
        decisions: {},
      };
      return {
        status: conflicts.length ? "conflict" : "auto-merged",
        conflictCount: conflicts.length,
        data,
        resultBody: renderFileMerge(data),
      };
    } catch {
      // Malformed JSON: fall through to a line merge.
    }
  }

  const result = base !== null ? mergeText3(base, live, target) : mergeText2(live, target);
  const data: FileMergeData = { mode: "text", regions: result.regions, decisions: {} };
  return {
    status: result.conflictCount ? "conflict" : "auto-merged",
    conflictCount: result.conflictCount,
    data,
    resultBody: renderFileMerge(data),
  };
}

export function renderFileMerge(data: FileMergeData): string {
  if (data.mode === "json") {
    const value = applyDecisions(data.merged, data.conflicts, data.decisions);
    return serializeThemeJson({ header: data.header, value: value as never });
  }
  return renderMergedText(data.regions, data.decisions);
}

export function unresolvedCount(data: FileMergeData): number {
  if (data.mode === "json") return data.conflicts.filter((c) => !data.decisions[c.id]).length;
  return data.regions.filter((r) => r.type === "conflict" && !data.decisions[r.id]).length;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface ResolvedFile {
  filename: string;
  resolution: Resolution;
  targetBody: string | null;
  liveBody: string | null;
  resultBody: string | null;
  /** How liveBody/targetBody are encoded. Merged results are always text. */
  encoding?: "text" | "base64";
}

export interface WritePlan {
  upserts: { filename: string; body: string; encoding: "text" | "base64" }[];
  deletes: string[];
}

/** Turns per-file resolutions into the writes needed on the target theme. */
export function buildWritePlan(files: ResolvedFile[]): WritePlan {
  const upserts: WritePlan["upserts"] = [];
  const deletes: string[] = [];
  for (const f of files) {
    if (f.resolution === "live" && f.liveBody !== null && f.liveBody !== f.targetBody) {
      upserts.push({ filename: f.filename, body: f.liveBody, encoding: f.encoding ?? "text" });
    } else if (f.resolution === "merged" && f.resultBody !== null && f.resultBody !== f.targetBody) {
      upserts.push({ filename: f.filename, body: f.resultBody, encoding: "text" });
    } else if (f.resolution === "delete" && f.targetBody !== null) {
      deletes.push(f.filename);
    }
  }
  return { upserts, deletes };
}

export function summarize(plans: Pick<FilePlan, "status" | "resolved">[]) {
  const counts: Record<FileStatus, number> = {
    unchanged: 0,
    "live-changed": 0,
    "target-changed": 0,
    "both-same": 0,
    "auto-merged": 0,
    conflict: 0,
  };
  let unresolved = 0;
  for (const p of plans) {
    counts[p.status]++;
    if (!p.resolved) unresolved++;
  }
  return { counts, unresolved, total: plans.length };
}

