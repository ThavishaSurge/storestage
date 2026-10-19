/**
 * Portable references.
 *
 * Every Shopify GID is store-specific. Before comparing resources across stores we replace each
 * GID we know about with a placeholder built from the referenced resource's natural key:
 *
 *   gid://shopify/Product/123            ->  @@ref:product:red-shirt@@
 *   '["gid://shopify/Metaobject/9"]'     ->  '["@@ref:metaobject:author/jane@@"]'
 *
 * Writing to the other store reverses this with that store's own GIDs. Placeholders also work
 * inside strings (metafield list values are JSON-encoded strings).
 */
import { isPlainObject } from "../json";
import { refId, type GidAlias, type NormalizedResource } from "./types";

export const GID_PATTERN = /gid:\/\/shopify\/[A-Za-z0-9]+\/\d+/g;
const REF_PATTERN = /@@ref:([A-Za-z]+):(.*?)@@/g;

export function refPlaceholder(ref: string): string {
  return `@@ref:${ref}@@`;
}

/** GID -> "type:key" for a store. */
export type GidIndex = Map<string, string>;
/** "type:key" -> GID for a store. */
export type RefIndex = Map<string, string>;

export function buildIndexes(
  resources: Pick<NormalizedResource, "type" | "key" | "gid">[],
  aliases: GidAlias[] = [],
): { gidIndex: GidIndex; refIndex: RefIndex } {
  const gidIndex: GidIndex = new Map();
  const refIndex: RefIndex = new Map();
  for (const r of resources) {
    if (!r.gid) continue;
    const ref = refId(r.type, r.key);
    gidIndex.set(r.gid, ref);
    refIndex.set(ref, r.gid);
  }
  for (const a of aliases) {
    gidIndex.set(a.gid, a.ref);
    if (!refIndex.has(a.ref)) refIndex.set(a.ref, a.gid);
  }
  return { gidIndex, refIndex };
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn);
    return out;
  }
  return value;
}

/** Replaces known GIDs with placeholders. Unknown GIDs are left alone and reported. */
export function toPortable<T>(value: T, gidIndex: GidIndex, unknown?: Set<string>): T {
  return mapStrings(value, (s) =>
    s.replace(GID_PATTERN, (gid) => {
      const ref = gidIndex.get(gid);
      if (ref) return refPlaceholder(ref);
      unknown?.add(gid);
      return gid;
    }),
  ) as T;
}

/** Replaces placeholders with the target store's GIDs. Missing references are reported. */
export function fromPortable<T>(value: T, refIndex: RefIndex, missing?: Set<string>): T {
  return mapStrings(value, (s) =>
    s.replace(REF_PATTERN, (match, type: string, key: string) => {
      const gid = refIndex.get(refId(type, key));
      if (gid) return gid;
      missing?.add(refId(type, key));
      return match;
    }),
  ) as T;
}

/** Every "type:key" a value references. */
export function referencedRefs(value: unknown): Set<string> {
  const refs = new Set<string>();
  mapStrings(value, (s) => {
    for (const m of s.matchAll(REF_PATTERN)) refs.add(refId(m[1], m[2]));
    return s;
  });
  return refs;
}

export function hasPlaceholders(value: unknown): boolean {
  return referencedRefs(value).size > 0;
}
