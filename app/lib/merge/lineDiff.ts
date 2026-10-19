/**
 * Unified line diff for display, with long unchanged stretches collapsed.
 */
import { diffLines } from "diff";

export type DiffRow =
  | { type: "same" | "add" | "del"; text: string; oldNo: number | null; newNo: number | null }
  | { type: "skip"; count: number };

export function lineDiff(oldText: string, newText: string, context = 3): DiffRow[] {
  const rows: Exclude<DiffRow, { type: "skip" }>[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const part of diffLines(oldText, newText)) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) {
      if (part.added) rows.push({ type: "add", text, oldNo: null, newNo: newNo++ });
      else if (part.removed) rows.push({ type: "del", text, oldNo: oldNo++, newNo: null });
      else rows.push({ type: "same", text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return collapse(rows, context);
}

function collapse(rows: Exclude<DiffRow, { type: "skip" }>[], context: number): DiffRow[] {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.type !== "same") {
      for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true;
    }
  });
  const out: DiffRow[] = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    if (keep[i]) {
      if (skipped) out.push({ type: "skip", count: skipped });
      skipped = 0;
      out.push(row);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ type: "skip", count: skipped });
  return out;
}

export function diffStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.type === "add") added++;
    if (r.type === "del") removed++;
  }
  return { added, removed };
}
