/**
 * Line-based text merging for Liquid, CSS, JS and other text theme files.
 *
 * mergeText3: true three-way merge (diff3) when the common ancestor is known.
 * mergeText2: two-way "pick per hunk" merge when no ancestor exists; every differing
 *             hunk becomes a decision point.
 */
import { diff3Merge, diffComm } from "node-diff3";

export type TextRegion =
  | { type: "ok"; lines: string[] }
  | {
      type: "conflict";
      id: number;
      /** null when merging without a common ancestor. */
      base: string[] | null;
      left: string[];
      right: string[];
    };

export interface TextMergeResult {
  regions: TextRegion[];
  conflictCount: number;
}

export type HunkDecision = "left" | "right" | "left-then-right" | "right-then-left" | { custom: string };

/** Splits text into lines that keep their line terminators, so joining restores the input exactly. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split(/(?<=\n)/);
}

export function mergeText3(base: string, left: string, right: string): TextMergeResult {
  const regions: TextRegion[] = [];
  let id = 0;
  const merged = diff3Merge<string>(splitLines(left), splitLines(base), splitLines(right), {
    excludeFalseConflicts: true,
  });
  for (const region of merged) {
    if (region.ok) {
      pushOk(regions, region.ok);
    } else if (region.conflict) {
      regions.push({
        type: "conflict",
        id: id++,
        base: region.conflict.o,
        left: region.conflict.a,
        right: region.conflict.b,
      });
    }
  }
  return { regions, conflictCount: id };
}

export function mergeText2(left: string, right: string): TextMergeResult {
  const regions: TextRegion[] = [];
  let id = 0;
  for (const part of diffComm<string>(splitLines(left), splitLines(right))) {
    if (part.common) {
      pushOk(regions, part.common);
    } else {
      regions.push({
        type: "conflict",
        id: id++,
        base: null,
        left: part.buffer1 ?? [],
        right: part.buffer2 ?? [],
      });
    }
  }
  return { regions, conflictCount: id };
}

function pushOk(regions: TextRegion[], lines: string[]) {
  if (lines.length === 0) return;
  const last = regions[regions.length - 1];
  if (last && last.type === "ok") last.lines.push(...lines);
  else regions.push({ type: "ok", lines: [...lines] });
}

/**
 * Builds the merged text. Undecided hunks fall back to `fallback` ("right" by default:
 * the side being promoted).
 */
export function renderMergedText(
  regions: TextRegion[],
  decisions: Record<number, HunkDecision | undefined>,
  fallback: "left" | "right" = "right",
): string {
  let out = "";
  for (const region of regions) {
    if (region.type === "ok") {
      out += region.lines.join("");
      continue;
    }
    const decision = decisions[region.id] ?? fallback;
    if (decision === "left") out += region.left.join("");
    else if (decision === "right") out += region.right.join("");
    else if (decision === "left-then-right") out += ensureTrailingNewline(region.left.join("")) + region.right.join("");
    else if (decision === "right-then-left") out += ensureTrailingNewline(region.right.join("")) + region.left.join("");
    else out += decision.custom;
  }
  return out;
}

function ensureTrailingNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : text + "\n";
}

/** Renders git-style conflict markers, used for the downloadable export of unresolved files. */
export function renderWithMarkers(
  regions: TextRegion[],
  labels: { left: string; right: string; base?: string },
): string {
  let out = "";
  for (const region of regions) {
    if (region.type === "ok") {
      out += region.lines.join("");
      continue;
    }
    out += `<<<<<<< ${labels.left}\n${ensureTrailingNewline(region.left.join(""))}`;
    if (region.base) out += `||||||| ${labels.base ?? "base"}\n${ensureTrailingNewline(region.base.join(""))}`;
    out += `=======\n${ensureTrailingNewline(region.right.join(""))}>>>>>>> ${labels.right}\n`;
  }
  return out;
}
