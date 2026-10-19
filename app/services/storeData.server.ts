/**
 * Reads a whole store into portable NormalizedResources.
 *
 * Selected types are fetched in full. Referenceable types that aren't selected are fetched as a
 * light index (id + key) so references to them can still be made portable.
 */
import { buildIndexes, toPortable, type GidIndex, type RefIndex } from "../lib/resources/refs";
import {
  isSyncableMetaobjectType,
  normalizeArticle,
  normalizeBlog,
  normalizeCollection,
  normalizeFile,
  normalizeMenu,
  normalizeMetafieldDefinition,
  normalizeMetaobject,
  normalizeMetaobjectDefinition,
  normalizePage,
  normalizeProduct,
  normalizeUrlRedirect,
  type NormalizeOutput,
} from "../lib/resources/normalize";
import { RESOURCE_TYPES, type GidAlias, type NormalizedResource, type ResourceType } from "../lib/resources/types";
import * as Q from "../lib/shopify/queries";
import { gql, paginate, type AdminClient } from "./admin.server";

type Conn<T> = { pageInfo: Q.PageInfo; nodes: T[] };

export interface StoreData {
  /** Portable resources of the selected types. */
  resources: NormalizedResource[];
  gidIndex: GidIndex;
  refIndex: RefIndex;
  /** GIDs referenced by resources that we couldn't map (e.g. resource types we don't sync). */
  unknownGids: string[];
}

export type ProgressFn = (message: string, fraction: number) => void | Promise<void>;

function compact<T>(list: (T | null)[]): T[] {
  return list.filter((x): x is T => x !== null);
}

async function fetchProducts(admin: AdminClient, progress: (n: number) => Promise<void>): Promise<NormalizeOutput[]> {
  const raw = await paginate<Q.RawProduct, { products: Conn<Q.RawProduct> }>(admin, Q.PRODUCTS, { first: 3 }, (d) => d.products, progress);
  for (const p of raw) {
    // Products with more than 50 variants: fetch the rest.
    let info = p.variants.pageInfo;
    while (info?.hasNextPage) {
      const data = await gql<{ product: { variants: Conn<Q.RawProduct["variants"]["nodes"][number]> } | null }>(admin, Q.PRODUCT_VARIANTS, {
        id: p.id,
        first: 100,
        after: info.endCursor,
      });
      if (!data.product) break;
      p.variants.nodes.push(...data.product.variants.nodes);
      info = data.product.variants.pageInfo;
    }
  }
  return raw.map(normalizeProduct);
}

async function metaobjectTypes(admin: AdminClient): Promise<string[]> {
  const defs = await paginate<{ type: string }, { metaobjectDefinitions: Conn<{ type: string }> }>(
    admin,
    Q.METAOBJECT_TYPES,
    { first: 100 },
    (d) => d.metaobjectDefinitions,
  );
  return defs.map((d) => d.type).filter((t) => !t.startsWith("app--") && !t.startsWith("$app"));
}

async function fetchFull(admin: AdminClient, type: ResourceType, progress: (n: number) => Promise<void>): Promise<NormalizeOutput[]> {
  switch (type) {
    case "product":
      return fetchProducts(admin, progress);
    case "collection":
      return (await paginate<Q.RawCollection, { collections: Conn<Q.RawCollection> }>(admin, Q.COLLECTIONS, { first: 3 }, (d) => d.collections, progress)).map(normalizeCollection);
    case "page":
      return (await paginate<Q.RawPage, { pages: Conn<Q.RawPage> }>(admin, Q.PAGES, { first: 40 }, (d) => d.pages, progress)).map(normalizePage);
    case "blog":
      return (await paginate<Q.RawBlog, { blogs: Conn<Q.RawBlog> }>(admin, Q.BLOGS, { first: 40 }, (d) => d.blogs, progress)).map(normalizeBlog);
    case "article":
      return (await paginate<Q.RawArticle, { articles: Conn<Q.RawArticle> }>(admin, Q.ARTICLES, { first: 30 }, (d) => d.articles, progress)).map(normalizeArticle);
    case "menu":
      return (await paginate<Q.RawMenu, { menus: Conn<Q.RawMenu> }>(admin, Q.MENUS, { first: 25 }, (d) => d.menus, progress)).map(normalizeMenu);
    case "urlRedirect":
      return (await paginate<Q.RawUrlRedirect, { urlRedirects: Conn<Q.RawUrlRedirect> }>(admin, Q.URL_REDIRECTS, { first: 250 }, (d) => d.urlRedirects, progress)).map(normalizeUrlRedirect);
    case "file":
      return compact((await paginate<Q.RawFile, { files: Conn<Q.RawFile> }>(admin, Q.FILES, { first: 100 }, (d) => d.files, progress)).map(normalizeFile));
    case "metafieldDefinition": {
      const out: NormalizeOutput[] = [];
      for (const ownerType of Q.SYNCED_OWNER_TYPES) {
        const defs = await paginate<Q.RawMetafieldDefinition, { metafieldDefinitions: Conn<Q.RawMetafieldDefinition> }>(
          admin,
          Q.METAFIELD_DEFINITIONS,
          { ownerType, first: 100 },
          (d) => d.metafieldDefinitions,
        );
        out.push(...compact(defs.map(normalizeMetafieldDefinition)));
        await progress(out.length);
      }
      return out;
    }
    case "metaobjectDefinition":
      return compact(
        (await paginate<Q.RawMetaobjectDefinition, { metaobjectDefinitions: Conn<Q.RawMetaobjectDefinition> }>(
          admin,
          Q.METAOBJECT_DEFINITIONS,
          { first: 25 },
          (d) => d.metaobjectDefinitions,
          progress,
        )).map(normalizeMetaobjectDefinition),
      );
    case "metaobject": {
      const out: NormalizeOutput[] = [];
      for (const t of await metaobjectTypes(admin)) {
        const objects = await paginate<Q.RawMetaobject, { metaobjects: Conn<Q.RawMetaobject> }>(admin, Q.METAOBJECTS, { type: t, first: 100 }, (d) => d.metaobjects);
        out.push(...compact(objects.map(normalizeMetaobject)));
        await progress(out.length);
      }
      return out;
    }
  }
}

/** Index-only fetch: returns (type, key, gid) triples without data. */
async function fetchIndex(admin: AdminClient, type: ResourceType): Promise<Pick<NormalizedResource, "type" | "key" | "gid">[]> {
  type Node = { id: string; handle: string };
  switch (type) {
    case "product":
      return (await paginate<Node, { products: Conn<Node> }>(admin, Q.PRODUCT_INDEX, { first: 250 }, (d) => d.products)).map((n) => ({ type, key: n.handle, gid: n.id }));
    case "collection":
      return (await paginate<Node, { collections: Conn<Node> }>(admin, Q.COLLECTION_INDEX, { first: 250 }, (d) => d.collections)).map((n) => ({ type, key: n.handle, gid: n.id }));
    case "page":
      return (await paginate<Node, { pages: Conn<Node> }>(admin, Q.PAGE_INDEX, { first: 250 }, (d) => d.pages)).map((n) => ({ type, key: n.handle, gid: n.id }));
    case "blog":
      return (await paginate<Node, { blogs: Conn<Node> }>(admin, Q.BLOG_INDEX, { first: 250 }, (d) => d.blogs)).map((n) => ({ type, key: n.handle, gid: n.id }));
    case "article":
      return (
        await paginate<Node & { blog: { handle: string } }, { articles: Conn<Node & { blog: { handle: string } }> }>(admin, Q.ARTICLE_INDEX, { first: 250 }, (d) => d.articles)
      ).map((n) => ({ type, key: `${n.blog.handle}/${n.handle}`, gid: n.id }));
    case "metaobject": {
      const out: Pick<NormalizedResource, "type" | "key" | "gid">[] = [];
      for (const t of await metaobjectTypes(admin)) {
        const nodes = await paginate<Node & { type: string }, { metaobjects: Conn<Node & { type: string }> }>(admin, Q.METAOBJECT_INDEX, { type: t, first: 250 }, (d) => d.metaobjects);
        out.push(...nodes.map((n) => ({ type, key: `${n.type}/${n.handle}`, gid: n.id })));
      }
      return out;
    }
    case "metaobjectDefinition": {
      const defs = await paginate<{ id: string; type: string }, { metaobjectDefinitions: Conn<{ id: string; type: string }> }>(
        admin,
        Q.METAOBJECT_TYPES,
        { first: 100 },
        (d) => d.metaobjectDefinitions,
      );
      return defs.filter((d) => isSyncableMetaobjectType(d.type)).map((d) => ({ type, key: d.type, gid: d.id }));
    }
    case "file":
      return (await fetchFull(admin, "file", async () => {})).map((o) => ({ type, key: o.resource.key, gid: o.resource.gid }));
    default:
      return [];
  }
}

/** Types whose GIDs other resources commonly reference. */
const REFERENCEABLE: ResourceType[] = ["metaobjectDefinition", "file", "metaobject", "product", "collection", "page", "blog", "article"];

export async function readStore(admin: AdminClient, types: ResourceType[], onProgress?: ProgressFn): Promise<StoreData> {
  const selected = RESOURCE_TYPES.filter((t) => types.includes(t));
  const outputs: NormalizeOutput[] = [];
  const indexOnly: Pick<NormalizedResource, "type" | "key" | "gid">[] = [];
  const steps = selected.length + REFERENCEABLE.filter((t) => !selected.includes(t)).length;
  let step = 0;

  for (const type of selected) {
    const label = type;
    await onProgress?.(`Reading ${label}`, step / steps);
    outputs.push(...(await fetchFull(admin, type, async (n) => onProgress?.(`Reading ${label} (${n})`, step / steps))));
    step++;
  }
  for (const type of REFERENCEABLE.filter((t) => !selected.includes(t))) {
    await onProgress?.(`Indexing ${type}`, step / steps);
    indexOnly.push(...(await fetchIndex(admin, type)));
    step++;
  }

  const aliases: GidAlias[] = outputs.flatMap((o) => o.aliases);
  const { gidIndex, refIndex } = buildIndexes([...indexOnly, ...outputs.map((o) => o.resource)], aliases);
  const unknown = new Set<string>();
  const resources = outputs.map((o) => ({ ...o.resource, data: toPortable(o.resource.data, gidIndex, unknown) }));
  await onProgress?.("Done", 1);
  return { resources, gidIndex, refIndex, unknownGids: [...unknown] };
}
