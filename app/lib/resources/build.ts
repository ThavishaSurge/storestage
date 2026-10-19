/**
 * Portable resource data -> Admin API operations for the target (live) store.
 *
 * Builders are pure: they receive the target store's ref index (natural key -> GID) and return
 * the operations to run. The executor runs them in order, records created GIDs back into the
 * index so later resources can reference them, and stops on the first userError.
 */
import { deepEqual, isPlainObject, type JsonObject, type JsonValue } from "../json";
import * as M from "../shopify/mutations";
import { fromPortable, type RefIndex } from "./refs";
import { refId, type ResourceType } from "./types";

export interface Operation {
  /** Human label for logs and the audit trail. */
  label: string;
  document: string;
  variables: Record<string, unknown>;
  /** Root payload field, e.g. "productSet". */
  root: string;
  /** Path inside the payload to the created/updated resource GID, if any. */
  idPath?: string[];
  /** If true, a userError aborts the whole resource; otherwise it's recorded as a warning. */
  critical?: boolean;
}

export interface BuildInput {
  type: ResourceType;
  key: string;
  action: "create" | "update" | "delete";
  /** Resolved portable data to write (null for deletes). */
  data: JsonObject | null;
  /** Current portable live data (null when the resource doesn't exist on live). */
  liveData: JsonObject | null;
  transfer: JsonObject | null;
  liveGid: string | null;
  refIndex: RefIndex;
}

export interface BuildResult {
  operations: Operation[];
  /** "type:key" references that don't exist on the target store yet. */
  missingRefs: string[];
}

export class BuildError extends Error {}

const str = (v: JsonValue | undefined): string | null => (typeof v === "string" ? v : null);
const obj = (v: JsonValue | undefined): JsonObject => (isPlainObject(v) ? v : {});
const arr = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);
const omitNull = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;

function metafieldInputs(metafields: JsonValue | undefined) {
  return Object.entries(obj(metafields)).map(([nsKey, raw]) => {
    const m = obj(raw);
    const dot = nsKey.indexOf(".");
    return { namespace: nsKey.slice(0, dot), key: nsKey.slice(dot + 1), type: str(m.type), value: str(m.value) ?? "" };
  });
}

/** Metafields present on live but removed in the promoted data -> metafieldsDelete. */
function removedMetafields(liveGid: string | null, liveData: JsonObject | null, data: JsonObject): Operation[] {
  if (!liveGid || !liveData) return [];
  const before = Object.keys(obj(liveData.metafields));
  const after = new Set(Object.keys(obj(data.metafields)));
  const removed = before.filter((k) => !after.has(k));
  if (!removed.length) return [];
  return [
    {
      label: `Remove ${removed.length} metafield(s)`,
      document: M.METAFIELDS_DELETE,
      root: "metafieldsDelete",
      variables: {
        metafields: removed.map((nsKey) => {
          const dot = nsKey.indexOf(".");
          return { ownerId: liveGid, namespace: nsKey.slice(0, dot), key: nsKey.slice(dot + 1) };
        }),
      },
    },
  ];
}

function validationInputs(validations: JsonValue | undefined) {
  return Object.entries(obj(validations))
    .filter(([, value]) => value !== null)
    .map(([name, value]) => ({ name, value: String(value) }));
}

function deleteOperation(type: ResourceType, gid: string): Operation {
  const map: Record<ResourceType, { document: string; root: string; variables: Record<string, unknown> }> = {
    product: { document: M.PRODUCT_DELETE, root: "productDelete", variables: { id: gid } },
    collection: { document: M.COLLECTION_DELETE, root: "collectionDelete", variables: { id: gid } },
    page: { document: M.PAGE_DELETE, root: "pageDelete", variables: { id: gid } },
    blog: { document: M.BLOG_DELETE, root: "blogDelete", variables: { id: gid } },
    article: { document: M.ARTICLE_DELETE, root: "articleDelete", variables: { id: gid } },
    menu: { document: M.MENU_DELETE, root: "menuDelete", variables: { id: gid } },
    urlRedirect: { document: M.URL_REDIRECT_DELETE, root: "urlRedirectDelete", variables: { id: gid } },
    metafieldDefinition: { document: M.METAFIELD_DEFINITION_DELETE, root: "metafieldDefinitionDelete", variables: { id: gid } },
    metaobjectDefinition: { document: M.METAOBJECT_DEFINITION_DELETE, root: "metaobjectDefinitionDelete", variables: { id: gid } },
    metaobject: { document: M.METAOBJECT_DELETE, root: "metaobjectDelete", variables: { id: gid } },
    file: { document: M.FILE_DELETE, root: "fileDelete", variables: { fileIds: [gid] } },
  };
  return { label: `Delete ${type}`, critical: true, ...map[type] };
}

export function buildOperations(input: BuildInput): BuildResult {
  const missing = new Set<string>();
  const { type, key, action, liveGid, refIndex } = input;

  if (action === "delete") {
    if (!liveGid) return { operations: [], missingRefs: [] };
    return { operations: [deleteOperation(type, liveGid)], missingRefs: [] };
  }
  if (!input.data) throw new BuildError(`No data to write for ${type} ${key}`);
  if (action === "update" && !liveGid) throw new BuildError(`${type} ${key} no longer exists on live`);

  const data = fromPortable(input.data, refIndex, missing);
  const liveData = input.liveData ? fromPortable(input.liveData, refIndex) : null;
  const transfer = input.transfer ?? {};
  const isCreate = action === "create";
  let operations: Operation[];

  switch (type) {
    case "product":
      operations = buildProduct(key, data, liveData, transfer, liveGid, refIndex);
      break;
    case "collection":
      operations = buildCollection(key, data, liveData, transfer, liveGid);
      break;
    case "page": {
      const page = {
        handle: key,
        title: str(data.title),
        body: str(data.body),
        isPublished: data.isPublished === true,
        templateSuffix: str(data.templateSuffix),
        metafields: metafieldInputs(data.metafields),
      };
      operations = isCreate
        ? [{ label: "Create page", document: M.PAGE_CREATE, root: "pageCreate", variables: { page }, idPath: ["page", "id"], critical: true }]
        : [
            { label: "Update page", document: M.PAGE_UPDATE, root: "pageUpdate", variables: { id: liveGid, page }, idPath: ["page", "id"], critical: true },
            ...removedMetafields(liveGid, liveData, data),
          ];
      break;
    }
    case "blog": {
      const blog = {
        handle: key,
        title: str(data.title),
        commentPolicy: str(data.commentPolicy),
        templateSuffix: str(data.templateSuffix),
        metafields: metafieldInputs(data.metafields),
      };
      operations = isCreate
        ? [{ label: "Create blog", document: M.BLOG_CREATE, root: "blogCreate", variables: { blog: omitNull(blog) }, idPath: ["blog", "id"], critical: true }]
        : [
            { label: "Update blog", document: M.BLOG_UPDATE, root: "blogUpdate", variables: { id: liveGid, blog: omitNull(blog) }, idPath: ["blog", "id"], critical: true },
            ...removedMetafields(liveGid, liveData, data),
          ];
      break;
    }
    case "article":
      operations = buildArticle(data, liveData, transfer, liveGid, isCreate);
      break;
    case "menu": {
      const items = menuItems(arr(data.items));
      operations = isCreate
        ? [{ label: "Create menu", document: M.MENU_CREATE, root: "menuCreate", variables: { handle: key, title: str(data.title), items }, idPath: ["menu", "id"], critical: true }]
        : [{ label: "Update menu", document: M.MENU_UPDATE, root: "menuUpdate", variables: { id: liveGid, handle: key, title: str(data.title), items }, idPath: ["menu", "id"], critical: true }];
      break;
    }
    case "urlRedirect": {
      const urlRedirect = { path: key, target: str(data.target) };
      operations = isCreate
        ? [{ label: "Create redirect", document: M.URL_REDIRECT_CREATE, root: "urlRedirectCreate", variables: { urlRedirect }, idPath: ["urlRedirect", "id"], critical: true }]
        : [{ label: "Update redirect", document: M.URL_REDIRECT_UPDATE, root: "urlRedirectUpdate", variables: { id: liveGid, urlRedirect }, idPath: ["urlRedirect", "id"], critical: true }];
      break;
    }
    case "metafieldDefinition":
      operations = buildMetafieldDefinition(data, liveData, isCreate);
      break;
    case "metaobjectDefinition":
      operations = buildMetaobjectDefinition(key, data, liveData, liveGid, isCreate);
      break;
    case "metaobject":
      operations = buildMetaobject(data);
      break;
    case "file":
      operations = isCreate
        ? [
            {
              label: "Upload file",
              document: M.FILE_CREATE,
              root: "fileCreate",
              variables: {
                files: [{ originalSource: str(transfer.url), alt: str(data.alt) ?? "", contentType: str(data.contentType) ?? "FILE", filename: key }],
              },
              idPath: ["files", "0", "id"],
              critical: true,
            },
          ]
        : [{ label: "Update file", document: M.FILE_UPDATE, root: "fileUpdate", variables: { files: [{ id: liveGid, alt: str(data.alt) ?? "" }] }, idPath: ["files", "0", "id"], critical: true }];
      break;
    default:
      throw new BuildError(`Unsupported resource type ${type satisfies never}`);
  }

  return { operations, missingRefs: [...missing] };
}

// ---------------------------------------------------------------------------
// Per-type builders
// ---------------------------------------------------------------------------

function buildProduct(
  handle: string,
  data: JsonObject,
  liveData: JsonObject | null,
  transfer: JsonObject,
  liveGid: string | null,
  refIndex: RefIndex,
): Operation[] {
  const options = arr(data.options).map((o, i) => {
    const option = obj(o);
    return { name: str(option.name), position: i + 1, values: arr(option.values).map((v) => ({ name: String(v) })) };
  });

  const variants = Object.entries(obj(data.variants)).map(([sig, raw]) => {
    const v = obj(raw);
    const existing = liveGid ? refIndex.get(refId("productVariant", `${handle}/${sig}`)) : undefined;
    return omitNull({
      id: existing ?? null,
      optionValues: Object.entries(obj(v.options)).map(([optionName, name]) => ({ optionName, name: String(name) })),
      price: str(v.price),
      compareAtPrice: str(v.compareAtPrice),
      sku: str(v.sku),
      barcode: str(v.barcode),
      taxable: v.taxable === true,
      inventoryPolicy: str(v.inventoryPolicy),
    });
  });

  const input: Record<string, unknown> = omitNull({
    handle,
    title: str(data.title),
    descriptionHtml: str(data.descriptionHtml),
    vendor: str(data.vendor),
    productType: str(data.productType),
    tags: arr(data.tags).map(String),
    status: str(data.status),
    templateSuffix: str(data.templateSuffix),
    requiresSellingPlan: data.requiresSellingPlan === true,
    category: str(data.category),
    seo: omitNull({ title: str(obj(data.seo).title), description: str(obj(data.seo).description) }),
    productOptions: options,
    variants,
    metafields: metafieldInputs(data.metafields),
  });
  if (!liveGid) input.giftCard = data.giftCard === true;

  // Media: only send when it changed, otherwise productSet would re-attach everything.
  const mediaChanged = !liveData || !deepEqual(liveData.media, data.media);
  if (mediaChanged) {
    const urls = obj(transfer.mediaUrls);
    input.files = arr(data.media).map((m) => {
      const media = obj(m);
      const mediaKey = String(media.key);
      const existing = refIndex.get(refId("file", mediaKey));
      if (existing) return { id: existing, alt: str(media.alt) ?? "" };
      const contentType = media.type === "EXTERNAL_VIDEO" ? "EXTERNAL_VIDEO" : media.type === "VIDEO" ? "VIDEO" : media.type === "MODEL_3D" ? "MODEL_3D" : "IMAGE";
      return { originalSource: str(urls[mediaKey]) ?? mediaKey, alt: str(media.alt) ?? "", contentType };
    });
  }

  return [
    {
      label: liveGid ? "Update product" : "Create product",
      document: M.PRODUCT_SET,
      root: "productSet",
      variables: { input, identifier: liveGid ? { id: liveGid } : null },
      idPath: ["product", "id"],
      critical: true,
    },
    ...removedMetafields(liveGid, liveData, data),
  ];
}

function buildCollection(
  handle: string,
  data: JsonObject,
  liveData: JsonObject | null,
  transfer: JsonObject,
  liveGid: string | null,
): Operation[] {
  const rules = data.rules ? obj(data.rules) : null;
  const image = data.image ? obj(data.image) : null;
  const imageChanged = !liveData || !deepEqual(liveData.image, data.image);
  const base = omitNull({
    handle,
    title: str(data.title),
    descriptionHtml: str(data.descriptionHtml),
    sortOrder: str(data.sortOrder),
    templateSuffix: str(data.templateSuffix),
    seo: omitNull({ title: str(obj(data.seo).title), description: str(obj(data.seo).description) }),
    metafields: metafieldInputs(data.metafields),
    ruleSet: rules
      ? {
          appliedDisjunctively: rules.appliedDisjunctively === true,
          rules: arr(rules.rules).map((r) => {
            const rule = obj(r);
            return { column: str(rule.column), relation: str(rule.relation), condition: str(rule.condition) };
          }),
        }
      : null,
    image: image && imageChanged ? { src: str(transfer.imageUrl), altText: str(image.alt) ?? "" } : null,
  });
  const products = arr(data.products).map(String).filter((id) => id.startsWith("gid://"));

  if (!liveGid) {
    return [
      {
        label: "Create collection",
        document: M.COLLECTION_CREATE,
        root: "collectionCreate",
        variables: { input: { ...base, ...(rules ? {} : { products }) } },
        idPath: ["collection", "id"],
        critical: true,
      },
    ];
  }

  const ops: Operation[] = [
    {
      label: "Update collection",
      document: M.COLLECTION_UPDATE,
      root: "collectionUpdate",
      variables: { input: { id: liveGid, ...base } },
      idPath: ["collection", "id"],
      critical: true,
    },
  ];
  if (!rules) {
    const before = new Set(arr(liveData?.products).map(String));
    const after = new Set(products);
    const toAdd = products.filter((id) => !before.has(id));
    const toRemove = [...before].filter((id) => !after.has(id) && id.startsWith("gid://"));
    for (let i = 0; i < toAdd.length; i += 250) {
      ops.push({ label: "Add products to collection", document: M.COLLECTION_ADD_PRODUCTS, root: "collectionAddProducts", variables: { id: liveGid, productIds: toAdd.slice(i, i + 250) } });
    }
    for (let i = 0; i < toRemove.length; i += 250) {
      ops.push({ label: "Remove products from collection", document: M.COLLECTION_REMOVE_PRODUCTS, root: "collectionRemoveProducts", variables: { id: liveGid, productIds: toRemove.slice(i, i + 250) } });
    }
  }
  ops.push(...removedMetafields(liveGid, liveData, data));
  return ops;
}

function buildArticle(
  data: JsonObject,
  liveData: JsonObject | null,
  transfer: JsonObject,
  liveGid: string | null,
  isCreate: boolean,
): Operation[] {
  const image = data.image ? obj(data.image) : null;
  const imageChanged = !liveData || !deepEqual(liveData.image, data.image);
  const article = omitNull({
    blogId: str(data.blog),
    handle: str(data.handle),
    title: str(data.title),
    body: str(data.body),
    summary: str(data.summary),
    tags: arr(data.tags).map(String),
    author: { name: str(data.author) || "Staff" },
    isPublished: data.isPublished === true,
    templateSuffix: str(data.templateSuffix),
    image: image && imageChanged ? { url: str(transfer.imageUrl), altText: str(image.alt) ?? "" } : null,
    metafields: metafieldInputs(data.metafields),
  });
  if (isCreate) {
    return [{ label: "Create blog post", document: M.ARTICLE_CREATE, root: "articleCreate", variables: { article }, idPath: ["article", "id"], critical: true }];
  }
  return [
    { label: "Update blog post", document: M.ARTICLE_UPDATE, root: "articleUpdate", variables: { id: liveGid, article }, idPath: ["article", "id"], critical: true },
    ...removedMetafields(liveGid, liveData, data),
  ];
}

interface MenuItemInput {
  title: string | null;
  type: string | null;
  url?: string;
  resourceId?: string;
  tags: string[];
  items: MenuItemInput[];
}

function menuItems(items: JsonValue[]): MenuItemInput[] {
  return items.map((raw) => {
    const item = obj(raw);
    const out: MenuItemInput = {
      title: str(item.title),
      type: str(item.type),
      tags: arr(item.tags).map(String),
      items: menuItems(arr(item.items)),
    };
    const resourceId = str(item.resourceId);
    if (resourceId && resourceId.startsWith("gid://")) out.resourceId = resourceId;
    const url = str(item.url);
    if (url) out.url = url;
    return out;
  });
}

function buildMetafieldDefinition(data: JsonObject, liveData: JsonObject | null, isCreate: boolean): Operation[] {
  if (!isCreate && liveData && liveData.type !== data.type) {
    throw new BuildError(`Metafield definition type can't change (${String(liveData.type)} -> ${String(data.type)}). Delete and recreate it in Shopify.`);
  }
  const common = {
    namespace: str(data.namespace),
    key: str(data.key) as string,
    ownerType: str(data.ownerType),
    name: str(data.name),
    description: str(data.description),
    validations: validationInputs(data.validations),
    pin: data.pinned === true,
  };
  return isCreate
    ? [{ label: "Create metafield definition", document: M.METAFIELD_DEFINITION_CREATE, root: "metafieldDefinitionCreate", variables: { definition: { ...common, type: str(data.type) } }, idPath: ["createdDefinition", "id"], critical: true }]
    : [{ label: "Update metafield definition", document: M.METAFIELD_DEFINITION_UPDATE, root: "metafieldDefinitionUpdate", variables: { definition: common }, idPath: ["updatedDefinition", "id"], critical: true }];
}

function fieldDefinitionInput(key: string, raw: JsonValue | undefined, includeType: boolean) {
  const f = obj(raw);
  return omitNull({
    key,
    name: str(f.name),
    description: str(f.description),
    required: f.required === true,
    type: includeType ? str(f.type) : null,
    validations: validationInputs(f.validations),
  });
}

function metaobjectCapabilities(data: JsonObject) {
  const caps = obj(data.capabilities);
  const onlineStore = caps.onlineStore ? obj(caps.onlineStore) : null;
  return {
    publishable: { enabled: caps.publishable === true },
    translatable: { enabled: caps.translatable === true },
    renderable: { enabled: caps.renderable === true },
    onlineStore: onlineStore ? { enabled: true, data: { urlHandle: str(onlineStore.urlHandle) } } : { enabled: false },
  };
}

function buildMetaobjectDefinition(
  type: string,
  data: JsonObject,
  liveData: JsonObject | null,
  liveGid: string | null,
  isCreate: boolean,
): Operation[] {
  const fields = obj(data.fields);
  const order = arr(data.fieldOrder).map(String).filter((k) => k in fields);
  for (const k of Object.keys(fields)) if (!order.includes(k)) order.push(k);

  if (isCreate) {
    return [
      {
        label: "Create metaobject definition",
        document: M.METAOBJECT_DEFINITION_CREATE,
        root: "metaobjectDefinitionCreate",
        variables: {
          definition: omitNull({
            type,
            name: str(data.name),
            description: str(data.description),
            displayNameKey: str(data.displayNameKey),
            capabilities: metaobjectCapabilities(data),
            fieldDefinitions: order.map((k) => fieldDefinitionInput(k, fields[k], true)),
          }),
        },
        idPath: ["metaobjectDefinition", "id"],
        critical: true,
      },
    ];
  }

  const liveFields = obj(liveData?.fields);
  const operations: Record<string, unknown>[] = [];
  for (const k of order) {
    if (!(k in liveFields)) {
      operations.push({ create: fieldDefinitionInput(k, fields[k], true) });
    } else {
      if (obj(liveFields[k]).type !== obj(fields[k]).type) {
        throw new BuildError(`Field "${k}" of metaobject definition ${type} can't change type.`);
      }
      operations.push({ update: fieldDefinitionInput(k, fields[k], false) });
    }
  }
  for (const k of Object.keys(liveFields)) if (!(k in fields)) operations.push({ delete: { key: k } });

  return [
    {
      label: "Update metaobject definition",
      document: M.METAOBJECT_DEFINITION_UPDATE,
      root: "metaobjectDefinitionUpdate",
      variables: {
        id: liveGid,
        definition: omitNull({
          name: str(data.name),
          description: str(data.description),
          displayNameKey: str(data.displayNameKey),
          capabilities: metaobjectCapabilities(data),
          fieldDefinitions: operations,
          resetFieldOrder: true,
        }),
      },
      idPath: ["metaobjectDefinition", "id"],
      critical: true,
    },
  ];
}

function buildMetaobject(data: JsonObject): Operation[] {
  const fields = Object.entries(obj(data.fields))
    .filter(([, v]) => v !== null)
    .map(([key, value]) => ({ key, value: String(value) }));
  const capabilities: Record<string, unknown> = {};
  if (str(data.status)) capabilities.publishable = { status: str(data.status) };
  if (data.templateSuffix !== null && data.templateSuffix !== undefined) {
    capabilities.onlineStore = { templateSuffix: str(data.templateSuffix) };
  }
  return [
    {
      label: "Upsert metaobject",
      document: M.METAOBJECT_UPSERT,
      root: "metaobjectUpsert",
      variables: {
        handle: { type: str(data.type), handle: str(data.handle) },
        metaobject: omitNull({ fields, capabilities: Object.keys(capabilities).length ? capabilities : null }),
      },
      idPath: ["metaobject", "id"],
      critical: true,
    },
  ];
}
