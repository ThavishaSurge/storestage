/**
 * Three-way store diff.
 *
 *   base    = live store at clone time (the common ancestor)
 *   staging = staging store now (where the team made changes)
 *   live    = live store now (may have drifted: client edits, new products...)
 *
 * Only staging-side changes are promotable. Live-side changes are reported as drift and never
 * overwritten silently: when both sides changed a resource we merge field-by-field and surface
 * clashing fields as conflicts.
 */
import { deepEqual, type JsonObject } from "../json";
import { applyDecisions, merge3, type ConflictDecision, type JsonConflict } from "../merge/json3";
import { referencedRefs } from "./refs";
import { dependencyRank, refId, type NormalizedResource, type ResourceType } from "./types";

export type ResourceStatus =
  | "staging-changed"
  | "live-changed"
  | "both-same"
  | "auto-merged"
  | "conflict";

export type ResourceAction = "create" | "update" | "delete" | "none";

export interface ResourceChange {
  type: ResourceType;
  key: string;
  title: string;
  status: ResourceStatus;
  action: ResourceAction;
  base: JsonObject | null;
  staging: JsonObject | null;
  live: JsonObject | null;
  /** What live should become if this change is promoted (before conflict decisions). */
  merged: JsonObject | null;
  conflicts: JsonConflict[];
  /** Staging-side transfer data (CDN URLs) needed to write the resource. */
  transfer: JsonObject | null;
  /** Default selection in the UI: safe, conflict-free creates and updates. */
  recommended: boolean;
}

type Indexed = Map<string, NormalizedResource>;

function index(resources: NormalizedResource[]): Indexed {
  return new Map(resources.map((r) => [refId(r.type, r.key), r]));
}

export function diffStores(input: {
  base: NormalizedResource[];
  staging: NormalizedResource[];
  live: NormalizedResource[];
}): ResourceChange[] {
  const base = index(input.base);
  const staging = index(input.staging);
  const live = index(input.live);
  const refs = new Set([...base.keys(), ...staging.keys(), ...live.keys()]);
  const changes: ResourceChange[] = [];

  for (const ref of refs) {
    const b = base.get(ref);
    const s = staging.get(ref);
    const l = live.get(ref);
    const any = (s ?? l ?? b) as NormalizedResource;
    const bd = b?.data ?? null;
    const sd = s?.data ?? null;
    const ld = l?.data ?? null;

    const stagingChanged = !deepEqual(sd, bd);
    const liveChanged = !deepEqual(ld, bd);
    if (!stagingChanged && !liveChanged) continue;

    const common = {
      type: any.type,
      key: any.key,
      title: s?.title ?? l?.title ?? b?.title ?? any.key,
      base: bd,
      staging: sd,
      live: ld,
      transfer: s?.transfer ?? null,
    };

    if (stagingChanged && !liveChanged) {
      const action: ResourceAction = !sd ? "delete" : !ld ? "create" : "update";
      changes.push({
        ...common,
        status: "staging-changed",
        action,
        merged: sd,
        conflicts: [],
        recommended: action !== "delete",
      });
      continue;
    }

    if (!stagingChanged && liveChanged) {
      changes.push({ ...common, status: "live-changed", action: "none", merged: ld, conflicts: [], recommended: false });
      continue;
    }

    if (deepEqual(sd, ld)) {
      changes.push({ ...common, status: "both-same", action: "none", merged: ld, conflicts: [], recommended: false });
      continue;
    }

    if (!sd || !ld) {
      // Deleted on one side, modified on the other.
      changes.push({
        ...common,
        status: "conflict",
        action: !sd ? "delete" : "create",
        merged: sd,
        conflicts: [
          {
            path: [],
            id: "(root)",
            base: bd,
            left: ld,
            right: sd,
            kind: "delete-modify",
          },
        ],
        recommended: false,
      });
      continue;
    }

    const { value, conflicts } = merge3(bd ?? undefined, ld, sd);
    changes.push({
      ...common,
      status: conflicts.length ? "conflict" : "auto-merged",
      action: "update",
      merged: value as JsonObject,
      conflicts,
      recommended: conflicts.length === 0,
    });
  }

  return sortChanges(changes);
}

/** Final data to write for a change, after conflict decisions ("left" = keep live, "right" = take staging). */
export function resolvedData(
  change: Pick<ResourceChange, "merged" | "conflicts" | "live" | "staging">,
  decisions: Record<string, ConflictDecision | undefined>,
): JsonObject | null {
  const root = change.conflicts.find((c) => c.id === "(root)");
  if (root) {
    const d = decisions[root.id];
    if (d === "left") return change.live;
    if (d && d !== "right") return d.custom as JsonObject;
    return change.staging;
  }
  return applyDecisions(change.merged, change.conflicts, decisions) as JsonObject;
}

export function promotable(change: Pick<ResourceChange, "action">): boolean {
  return change.action !== "none";
}

/**
 * Orders changes so every reference is written before the thing referencing it:
 * creates/updates in dependency order (and topologically within a type, e.g. metaobjects that
 * reference other metaobjects), then deletes in reverse dependency order.
 */
export function sortChanges<T extends Pick<ResourceChange, "type" | "key" | "action" | "merged" | "staging">>(changes: T[]): T[] {
  const writes = changes.filter((c) => c.action !== "delete");
  const deletes = changes.filter((c) => c.action === "delete");

  const byType = new Map<ResourceType, T[]>();
  for (const c of writes) {
    const list = byType.get(c.type) ?? [];
    list.push(c);
    byType.set(c.type, list);
  }

  const orderedWrites: T[] = [];
  for (const type of [...byType.keys()].sort((a, b) => dependencyRank(a) - dependencyRank(b))) {
    orderedWrites.push(...topoWithinType(byType.get(type) ?? []));
  }
  const orderedDeletes = [...deletes].sort((a, b) => dependencyRank(b.type) - dependencyRank(a.type) || a.key.localeCompare(b.key));
  return [...orderedWrites, ...orderedDeletes];
}

function topoWithinType<T extends Pick<ResourceChange, "type" | "key" | "merged" | "staging">>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.key.localeCompare(b.key));
  const byRef = new Map(sorted.map((c) => [refId(c.type, c.key), c]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const out: T[] = [];

  const visit = (c: T) => {
    const ref = refId(c.type, c.key);
    if (visited.has(ref)) return;
    if (visiting.has(ref)) return; // cycle: break it, the second pass in the executor fixes refs
    visiting.add(ref);
    for (const dep of referencedRefs(c.merged ?? c.staging)) {
      const target = byRef.get(dep);
      if (target && target !== c) visit(target);
    }
    visiting.delete(ref);
    visited.add(ref);
    out.push(c);
  };
  sorted.forEach(visit);
  return out;
}

export function summarizeChanges(changes: Pick<ResourceChange, "status" | "action" | "type">[]) {
  const byStatus: Record<ResourceStatus, number> = {
    "staging-changed": 0,
    "live-changed": 0,
    "both-same": 0,
    "auto-merged": 0,
    conflict: 0,
  };
  const byType: Partial<Record<ResourceType, number>> = {};
  for (const c of changes) {
    byStatus[c.status]++;
    if (c.action !== "none") byType[c.type] = (byType[c.type] ?? 0) + 1;
  }
  return { byStatus, byType, total: changes.length, promotable: changes.filter((c) => c.action !== "none").length };
}
