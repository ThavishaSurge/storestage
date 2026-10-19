/**
 * Raw Admin API nodes -> NormalizedResource (with raw GIDs still inside `data`).
 * The snapshot pipeline then converts GIDs to portable placeholders with refs.ts.
 *
 * Rule of thumb: `data` holds what a merchant edits and what we can write back.
 * Output-only fields (ids, timestamps, counts) are dropped.
 */
import type { JsonObject } from "../json";
import type {
  RawArticle,
  RawBlog,
  RawCollection,
  RawFile,
  RawMedia,
  RawMenu,
  RawMenuItem,
  RawMetafield,
  RawMetafieldDefinition,
  RawMetaobject,
  RawMetaobjectDefinition,
  RawPage,
  RawProduct,
  RawUrlRedirect,
} from "../shopify/queries";
import { refId, type GidAlias, type NormalizedResource } from "./types";

export interface NormalizeOutput {
  resource: NormalizedResource;
  aliases: GidAlias[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Namespaces owned by apps (including ours) can't be written by another app. */
export function isAppOwnedNamespace(namespace: string): boolean {
  return namespace.startsWith("app--") || namespace.startsWith("$app");
}

export function normalizeMetafields(nodes: RawMetafield[]): JsonObject {
  const out: JsonObject = {};
  for (const m of [...nodes].sort((a, b) => `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`))) {
    if (isAppOwnedNamespace(m.namespace)) continue;
    out[`${m.namespace}.${m.key}`] = { type: m.type, value: m.value };
  }
  return out;
}

const SHOPIFY_DEDUPE_SUFFIX = /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[^./]+$)/i;

/**
 * Stable key for a CDN file: its basename without query string and without the
 * UUID suffix Shopify appends when a filename already exists.
 */
export function fileKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const pathname = new URL(url).pathname;
    const base = decodeURIComponent(pathname.split("/").pop() || "");
    return base ? base.replace(SHOPIFY_DEDUPE_SUFFIX, "") : null;
  } catch {
    return null;
  }
}

export function variantSignature(selectedOptions: { name: string; value: string }[]): string {
  return selectedOptions.map((o) => o.value).join(" / ") || "Default Title";
}

function mediaUrl(m: RawMedia): string | null {
  return m.image?.url ?? m.originalSource?.url ?? m.originUrl ?? null;
}

const nullIfEmpty = (s: string | null | undefined) => (s === undefined || s === null || s === "" ? null : s);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export function normalizeProduct(p: RawProduct): NormalizeOutput {
  const aliases: GidAlias[] = [];
  const variants: JsonObject = {};
  for (const v of [...p.variants.nodes].sort((a, b) => a.position - b.position)) {
    const sig = variantSignature(v.selectedOptions);
    variants[sig] = {
      options: Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value])),
      position: v.position,
      sku: nullIfEmpty(v.sku),
      barcode: nullIfEmpty(v.barcode),
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      taxable: v.taxable,
      inventoryPolicy: v.inventoryPolicy,
    };
    aliases.push({ gid: v.id, ref: refId("productVariant", `${p.handle}/${sig}`) });
  }

  const media: JsonObject[] = [];
  const mediaUrls: JsonObject = {};
  for (const m of p.media.nodes) {
    const url = mediaUrl(m);
    const key = m.mediaContentType === "EXTERNAL_VIDEO" ? url : fileKeyFromUrl(url);
    if (!key || !url) continue;
    media.push({ key, alt: m.alt ?? "", type: m.mediaContentType });
    mediaUrls[key] = url;
    if (m.mediaContentType !== "EXTERNAL_VIDEO") aliases.push({ gid: m.id, ref: refId("file", key) });
  }

  return {
    aliases,
    resource: {
      type: "product",
      key: p.handle,
      gid: p.id,
      title: p.title,
      data: {
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        vendor: p.vendor,
        productType: p.productType,
        tags: [...p.tags].sort(),
        status: p.status,
        templateSuffix: nullIfEmpty(p.templateSuffix),
        giftCard: p.isGiftCard,
        requiresSellingPlan: p.requiresSellingPlan,
        // Taxonomy category GIDs are global (identical in every store), no mapping needed.
        category: p.category?.id ?? null,
        seo: { title: nullIfEmpty(p.seo.title), description: nullIfEmpty(p.seo.description) },
        options: [...p.options].sort((a, b) => a.position - b.position).map((o) => ({ name: o.name, values: o.values })),
        variants,
        media,
        metafields: normalizeMetafields(p.metafields.nodes),
      },
      transfer: { mediaUrls },
    },
  };
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export function normalizeCollection(c: RawCollection): NormalizeOutput {
  const imageKey = fileKeyFromUrl(c.image?.url);
  const smart = Boolean(c.ruleSet && c.ruleSet.rules.length);
  return {
    aliases: [],
    resource: {
      type: "collection",
      key: c.handle,
      gid: c.id,
      title: c.title,
      data: {
        title: c.title,
        descriptionHtml: c.descriptionHtml,
        sortOrder: c.sortOrder,
        templateSuffix: nullIfEmpty(c.templateSuffix),
        seo: { title: nullIfEmpty(c.seo.title), description: nullIfEmpty(c.seo.description) },
        image: imageKey ? { key: imageKey, alt: c.image?.altText ?? "" } : null,
        rules: smart && c.ruleSet
          ? {
              appliedDisjunctively: c.ruleSet.appliedDisjunctively,
              rules: c.ruleSet.rules.map((r) => ({ column: r.column, relation: r.relation, condition: r.condition })),
            }
          : null,
        // Manual collections only; smart collection membership follows the rules.
        products: smart ? [] : c.products.nodes.map((n) => n.id),
        metafields: normalizeMetafields(c.metafields.nodes),
      },
      transfer: c.image?.url ? { imageUrl: c.image.url } : {},
    },
  };
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export function normalizePage(p: RawPage): NormalizeOutput {
  return {
    aliases: [],
    resource: {
      type: "page",
      key: p.handle,
      gid: p.id,
      title: p.title,
      data: {
        title: p.title,
        body: p.body,
        isPublished: p.isPublished,
        templateSuffix: nullIfEmpty(p.templateSuffix),
        metafields: normalizeMetafields(p.metafields.nodes),
      },
    },
  };
}

export function normalizeBlog(b: RawBlog): NormalizeOutput {
  return {
    aliases: [],
    resource: {
      type: "blog",
      key: b.handle,
      gid: b.id,
      title: b.title,
      data: {
        title: b.title,
        commentPolicy: b.commentPolicy,
        templateSuffix: nullIfEmpty(b.templateSuffix),
        metafields: normalizeMetafields(b.metafields.nodes),
      },
    },
  };
}

export function normalizeArticle(a: RawArticle): NormalizeOutput {
  const imageKey = fileKeyFromUrl(a.image?.url);
  return {
    aliases: [],
    resource: {
      type: "article",
      key: `${a.blog.handle}/${a.handle}`,
      gid: a.id,
      title: a.title,
      data: {
        handle: a.handle,
        blog: a.blog.id,
        title: a.title,
        body: a.body,
        summary: nullIfEmpty(a.summary),
        tags: [...a.tags].sort(),
        author: a.author?.name ?? "",
        isPublished: a.isPublished,
        templateSuffix: nullIfEmpty(a.templateSuffix),
        image: imageKey ? { key: imageKey, alt: a.image?.altText ?? "" } : null,
        metafields: normalizeMetafields(a.metafields.nodes),
      },
      transfer: a.image?.url ? { imageUrl: a.image.url } : {},
    },
  };
}

function normalizeMenuItems(items: RawMenuItem[] | undefined): JsonObject[] {
  return (items ?? []).map((item) => ({
    title: item.title,
    type: item.type,
    // Resource-linked items get their URL from the resource; storing it would make
    // identical menus look different across stores.
    url: item.resourceId ? null : item.url,
    resourceId: item.resourceId,
    tags: [...item.tags].sort(),
    items: normalizeMenuItems(item.items),
  }));
}

export function normalizeMenu(m: RawMenu): NormalizeOutput {
  return {
    aliases: [],
    resource: {
      type: "menu",
      key: m.handle,
      gid: m.id,
      title: m.title,
      data: { title: m.title, items: normalizeMenuItems(m.items) },
    },
  };
}

export function normalizeUrlRedirect(r: RawUrlRedirect): NormalizeOutput {
  return {
    aliases: [],
    resource: { type: "urlRedirect", key: r.path, gid: r.id, title: r.path, data: { target: r.target } },
  };
}

// ---------------------------------------------------------------------------
// Custom data
// ---------------------------------------------------------------------------

function normalizeValidations(validations: { name: string; value: string | null }[]): JsonObject {
  const out: JsonObject = {};
  for (const v of [...validations].sort((a, b) => a.name.localeCompare(b.name))) out[v.name] = v.value;
  return out;
}

export function normalizeMetafieldDefinition(d: RawMetafieldDefinition): NormalizeOutput | null {
  if (isAppOwnedNamespace(d.namespace)) return null;
  return {
    aliases: [],
    resource: {
      type: "metafieldDefinition",
      key: `${d.ownerType}:${d.namespace}.${d.key}`,
      gid: d.id,
      title: `${d.name} (${d.ownerType.toLowerCase()})`,
      data: {
        ownerType: d.ownerType,
        namespace: d.namespace,
        key: d.key,
        name: d.name,
        description: nullIfEmpty(d.description),
        type: d.type.name,
        validations: normalizeValidations(d.validations),
        pinned: d.pinnedPosition !== null,
      },
    },
  };
}

/** App-owned and Shopify standard definitions can't be created through metaobjectDefinitionCreate. */
export function isSyncableMetaobjectType(type: string): boolean {
  return !type.startsWith("app--") && !type.startsWith("$app") && !type.startsWith("shopify--");
}

export function normalizeMetaobjectDefinition(d: RawMetaobjectDefinition): NormalizeOutput | null {
  if (!isSyncableMetaobjectType(d.type)) return null;
  const fields: JsonObject = {};
  for (const f of d.fieldDefinitions) {
    fields[f.key] = {
      name: f.name,
      description: nullIfEmpty(f.description),
      required: f.required,
      type: f.type.name,
      validations: normalizeValidations(f.validations),
    };
  }
  return {
    aliases: [],
    resource: {
      type: "metaobjectDefinition",
      key: d.type,
      gid: d.id,
      title: d.name,
      data: {
        name: d.name,
        description: nullIfEmpty(d.description),
        displayNameKey: d.displayNameKey,
        capabilities: {
          publishable: d.capabilities.publishable.enabled,
          translatable: d.capabilities.translatable.enabled,
          renderable: d.capabilities.renderable?.enabled ?? false,
          onlineStore: d.capabilities.onlineStore?.enabled
            ? { urlHandle: d.capabilities.onlineStore.data?.urlHandle ?? d.type }
            : null,
        },
        fieldOrder: d.fieldDefinitions.map((f) => f.key),
        fields,
      },
    },
  };
}

export function normalizeMetaobject(m: RawMetaobject): NormalizeOutput | null {
  if (m.type.startsWith("app--") || m.type.startsWith("$app")) return null;
  const fields: JsonObject = {};
  for (const f of [...m.fields].sort((a, b) => a.key.localeCompare(b.key))) fields[f.key] = f.value;
  return {
    aliases: [],
    resource: {
      type: "metaobject",
      key: `${m.type}/${m.handle}`,
      gid: m.id,
      title: `${m.displayName} (${m.type})`,
      data: {
        type: m.type,
        handle: m.handle,
        fields,
        status: m.capabilities.publishable?.status ?? null,
        templateSuffix: m.capabilities.onlineStore?.templateSuffix ?? null,
      },
    },
  };
}

export function normalizeFile(f: RawFile): NormalizeOutput | null {
  const url = f.image?.url ?? f.url ?? f.originalSource?.url ?? null;
  const key = fileKeyFromUrl(url);
  if (!key || !url || f.fileStatus === "FAILED") return null;
  const contentType = f.__typename === "MediaImage" ? "IMAGE" : f.__typename === "Video" ? "VIDEO" : "FILE";
  return {
    aliases: [],
    resource: {
      type: "file",
      key,
      gid: f.id,
      title: key,
      data: { alt: f.alt ?? "", contentType },
      transfer: { url },
    },
  };
}
