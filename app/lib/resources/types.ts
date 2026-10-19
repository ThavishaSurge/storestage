import type { JsonObject } from "../json";

/**
 * Resource types in dependency order: anything a type can reference comes earlier.
 * (Products reference files, metaobjects and definitions; menus reference everything.)
 */
export const RESOURCE_TYPES = [
  "metafieldDefinition",
  "metaobjectDefinition",
  "file",
  "metaobject",
  "product",
  "collection",
  "page",
  "blog",
  "article",
  "menu",
  "urlRedirect",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_LABELS: Record<ResourceType, { singular: string; plural: string }> = {
  metafieldDefinition: { singular: "Metafield definition", plural: "Metafield definitions" },
  metaobjectDefinition: { singular: "Metaobject definition", plural: "Metaobject definitions" },
  file: { singular: "File", plural: "Files" },
  metaobject: { singular: "Metaobject", plural: "Metaobjects" },
  product: { singular: "Product", plural: "Products" },
  collection: { singular: "Collection", plural: "Collections" },
  page: { singular: "Page", plural: "Pages" },
  blog: { singular: "Blog", plural: "Blogs" },
  article: { singular: "Blog post", plural: "Blog posts" },
  menu: { singular: "Menu", plural: "Navigation menus" },
  urlRedirect: { singular: "URL redirect", plural: "URL redirects" },
};

export function isResourceType(value: string): value is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}

export function dependencyRank(type: ResourceType): number {
  return RESOURCE_TYPES.indexOf(type);
}

/**
 * A store resource in portable form.
 * - `key` is a natural key that is identical across stores (handle, path, type/handle...).
 * - `data` contains only comparable, writable fields. Store-specific GIDs inside it are
 *   replaced by `@@ref:type:key@@` placeholders (see refs.ts).
 * - `transfer` carries values needed to write the resource but excluded from comparison
 *   (CDN URLs differ between stores even when the content is identical).
 */
export interface NormalizedResource {
  type: ResourceType;
  key: string;
  gid: string | null;
  title: string;
  data: JsonObject;
  transfer?: JsonObject;
}

/** Sub-objects that other resources may reference by GID (variants, product media). */
export interface GidAlias {
  gid: string;
  ref: string;
}

export function refId(type: string, key: string): string {
  return `${type}:${key}`;
}
