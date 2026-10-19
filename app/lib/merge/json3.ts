/**
 * Three-way structural merge for JSON documents.
 *
 * Used for Shopify theme JSON (templates/*.json, sections/*.json section groups,
 * config/settings_data.json, locales) and for normalized store resources.
 *
 * Naming: `left` is the side we must not lose (the live theme / live store),
 * `right` is the side being promoted (the working theme / staging store).
 * When both sides change the same leaf differently that is a conflict; the merged value
 * provisionally takes `right` and the conflict is reported so a human can decide.
 */
import {
  clone,
  deepEqual,
  isPlainObject,
  pathToString,
  setAtPath,
  type JsonPath,
} from "../json";

export interface JsonConflict {
  path: JsonPath;
  /** Display form of the path, also the key used for decisions. */
  id: string;
  base: unknown;
  left: unknown;
  right: unknown;
  /** Why this is a conflict, for the UI. */
  kind: "value" | "order" | "add-add" | "delete-modify";
}

export interface Merge3Result {
  value: unknown;
  conflicts: JsonConflict[];
}

export type ConflictDecision = "left" | "right" | { custom: unknown };

const ABSENT = undefined;

function isStringSet(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === "string") &&
    new Set(value).size === value.length
  );
}

export function merge3(base: unknown, left: unknown, right: unknown): Merge3Result {
  const conflicts: JsonConflict[] = [];
  const value = mergeAt([], base, left, right, conflicts);
  return { value, conflicts };
}

function conflict(
  conflicts: JsonConflict[],
  path: JsonPath,
  base: unknown,
  left: unknown,
  right: unknown,
  kind: JsonConflict["kind"],
): unknown {
  conflicts.push({ path, id: pathToString(path), base, left, right, kind });
  return clone(right);
}

function mergeAt(
  path: JsonPath,
  base: unknown,
  left: unknown,
  right: unknown,
  conflicts: JsonConflict[],
): unknown {
  if (deepEqual(left, right)) return clone(left);
  if (deepEqual(base, left)) return clone(right);
  if (deepEqual(base, right)) return clone(left);

  // Both sides changed, differently.
  if (left === ABSENT || right === ABSENT) {
    // One side deleted, the other modified.
    return conflict(conflicts, path, base, left, right, "delete-modify");
  }

  if (isPlainObject(left) && isPlainObject(right) && (base === ABSENT || isPlainObject(base))) {
    const b = (base ?? {}) as Record<string, unknown>;
    const keys: string[] = [];
    for (const k of Object.keys(right)) keys.push(k);
    for (const k of Object.keys(left)) if (!(k in right)) keys.push(k);
    for (const k of Object.keys(b)) if (!keys.includes(k)) keys.push(k);

    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const merged = mergeAt([...path, key], b[key], left[key], right[key], conflicts);
      if (merged !== ABSENT) out[key] = merged;
    }
    return out;
  }

  if (isStringSet(left) && isStringSet(right) && (base === ABSENT || isStringSet(base))) {
    return mergeStringSet(path, (base ?? []) as string[], left, right, conflicts);
  }

  return conflict(
    conflicts,
    path,
    base,
    left,
    right,
    base === ABSENT ? "add-add" : "value",
  );
}

/**
 * Merges ordered sets of strings such as a template's `order` or a section's `block_order`.
 * Additions and removals from both sides are combined; `right`'s ordering wins.
 * If both sides re-ordered the shared elements differently, that is reported as an order conflict.
 */
function mergeStringSet(
  path: JsonPath,
  base: string[],
  left: string[],
  right: string[],
  conflicts: JsonConflict[],
): string[] {
  const baseSet = new Set(base);
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const removed = new Set(base.filter((x) => !leftSet.has(x) || !rightSet.has(x)));

  const result = right.filter((x) => !removed.has(x));
  const leftAdded = left.filter((x) => !baseSet.has(x) && !rightSet.has(x));

  for (const item of leftAdded) {
    const idx = left.indexOf(item);
    let insertAt = 0;
    for (let i = idx - 1; i >= 0; i--) {
      const pos = result.indexOf(left[i]);
      if (pos !== -1) {
        insertAt = pos + 1;
        break;
      }
    }
    result.splice(insertAt, 0, item);
  }

  const common = base.filter((x) => leftSet.has(x) && rightSet.has(x));
  const orderOf = (arr: string[]) => arr.filter((x) => common.includes(x)).join("\u0000");
  const baseOrder = orderOf(base);
  const leftOrder = orderOf(left);
  const rightOrder = orderOf(right);
  if (leftOrder !== baseOrder && rightOrder !== baseOrder && leftOrder !== rightOrder) {
    conflicts.push({ path, id: pathToString(path), base, left, right, kind: "order" });
  }
  return result;
}

/** Applies human decisions to a merge result. Undecided conflicts keep the provisional (right) value. */
export function applyDecisions(
  merged: unknown,
  conflicts: JsonConflict[],
  decisions: Record<string, ConflictDecision | undefined>,
): unknown {
  let value = clone(merged);
  for (const c of conflicts) {
    const decision = decisions[c.id];
    if (!decision) continue;
    let chosen: unknown;
    if (decision === "left") chosen = c.left;
    else if (decision === "right") chosen = c.right;
    else chosen = decision.custom;
    value = setAtPath(value, c.path, clone(chosen));
  }
  return value;
}

export function unresolvedConflicts(
  conflicts: JsonConflict[],
  decisions: Record<string, ConflictDecision | undefined>,
): JsonConflict[] {
  return conflicts.filter((c) => !decisions[c.id]);
}
