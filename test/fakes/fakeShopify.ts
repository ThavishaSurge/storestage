/**
 * In-memory fake of the Shopify Admin GraphQL API, scoped to the operations StoreStage uses.
 * Each FakeStore issues its own GIDs (different number ranges per store), so cross-store ID
 * mapping is exercised for real. Responses mirror the shapes of the real API.
 */
import type {
  RawArticle,
  RawBlog,
  RawCollection,
  RawFile,
  RawMenu,
  RawMenuItem,
  RawMetafield,
  RawMetafieldDefinition,
  RawMetaobject,
  RawMetaobjectDefinition,
  RawPage,
  RawProduct,
  RawShopSettings,
  RawTheme,
  RawUrlRedirect,
} from "../../app/lib/shopify/queries";

type Vars = Record<string, unknown>;
type Obj = Record<string, unknown>;

interface ThemeFile {
  filename: string;
  body: string;
  encoding: "text" | "base64";
  updatedAt: string;
  contentType: string;
}

function md5ish(s: string): string {
  // Deterministic checksum stand-in (FNV-1a, hex).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function page<T>(list: T[], first: number, after?: string | null) {
  const start = after ? Number(after) : 0;
  const nodes = list.slice(start, start + first);
  const end = start + nodes.length;
  return { pageInfo: { hasNextPage: end < list.length, endCursor: nodes.length ? String(end) : null }, nodes };
}

const noErrors = { userErrors: [] as unknown[] };

export class FakeStore {
  private seq: number;
  public clock = Date.parse("2026-10-01T09:00:00Z");
  themes: RawTheme[] = [];
  themeFiles = new Map<string, Map<string, ThemeFile>>();
  products: RawProduct[] = [];
  collections: RawCollection[] = [];
  pages: RawPage[] = [];
  blogs: RawBlog[] = [];
  articles: RawArticle[] = [];
  menus: RawMenu[] = [];
  redirects: RawUrlRedirect[] = [];
  metafieldDefinitions: RawMetafieldDefinition[] = [];
  metaobjectDefinitions: RawMetaobjectDefinition[] = [];
  metaobjects: RawMetaobject[] = [];
  files: RawFile[] = [];
  published = new Set<string>();
  settings: RawShopSettings;
  readonly publicationId: string;
  /** Every mutation name called, for assertions. */
  log: string[] = [];

  constructor(
    public readonly shop: string,
    seqStart: number,
  ) {
    this.seq = seqStart;
    this.publicationId = this.gid("Publication");
    this.settings = {
      name: shop,
      contactEmail: `hello@${shop}`,
      description: null,
      currencyCode: "EUR",
      enabledPresentmentCurrencies: ["EUR"],
      currencyFormats: { moneyFormat: "€{{amount}}", moneyWithCurrencyFormat: "€{{amount}} EUR" },
      ianaTimezone: "Europe/Helsinki",
      weightUnit: "KILOGRAMS",
      unitSystem: "METRIC_SYSTEM",
      taxesIncluded: true,
      taxShipping: false,
      orderNumberFormatPrefix: "#",
      orderNumberFormatSuffix: "",
      shipsToCountries: ["FI", "SE"],
      marketingSmsConsentEnabledAtCheckout: false,
      shopPolicies: [],
    };
  }

  gid(type: string) {
    return `gid://shopify/${type}/${this.seq++}`;
  }

  now(advanceMs = 60_000) {
    this.clock += advanceMs;
    return new Date(this.clock).toISOString();
  }

  cdn(filename: string) {
    return `https://cdn.shopify.com/s/files/1/${this.seq}/files/${filename}?v=1`;
  }

  // ---------------------------------------------------------------------------
  // Fixture helpers
  // ---------------------------------------------------------------------------

  addTheme(name: string, role: string, files: Record<string, string>, createdAt = this.now()): RawTheme {
    const theme: RawTheme = { id: this.gid("OnlineStoreTheme"), name, role, createdAt, updatedAt: createdAt, processing: false };
    this.themes.push(theme);
    const map = new Map<string, ThemeFile>();
    for (const [filename, body] of Object.entries(files)) {
      const binary = /\.(png|jpg|gif|woff2?)$/.test(filename);
      map.set(filename, { filename, body, encoding: binary ? "base64" : "text", updatedAt: createdAt, contentType: binary ? "image/png" : "text/plain" });
    }
    this.themeFiles.set(theme.id, map);
    return theme;
  }

  writeThemeFile(themeId: string, filename: string, body: string) {
    const files = this.themeFiles.get(themeId)!;
    const binary = /\.(png|jpg|gif|woff2?)$/.test(filename);
    files.set(filename, { filename, body, encoding: binary ? "base64" : "text", updatedAt: this.now(), contentType: binary ? "image/png" : "text/plain" });
  }

  readThemeFile(themeId: string, filename: string) {
    return this.themeFiles.get(themeId)?.get(filename)?.body;
  }

  addProduct(
    input: Omit<Partial<RawProduct>, "variants"> & { handle: string; title: string; variants?: { sku: string; options: Record<string, string>; price: string }[]; imageNames?: string[] },
  ): RawProduct {
    const id = this.gid("Product");
    const optionNames = input.variants?.length ? Object.keys(input.variants[0].options) : ["Title"];
    const variants = (input.variants ?? [{ sku: `${input.handle}-1`, options: { Title: "Default Title" }, price: "10.00" }]).map((v, i) => ({
      id: this.gid("ProductVariant"),
      sku: v.sku,
      price: v.price,
      compareAtPrice: null,
      taxable: true,
      inventoryPolicy: "DENY",
      position: i + 1,
      selectedOptions: Object.entries(v.options).map(([name, value]) => ({ name, value })),
      barcode: null,
    }));
    const media = (input.imageNames ?? []).map((name) => {
      const file = this.addFile(name, "IMAGE");
      return { id: file.id, alt: `${name} alt`, mediaContentType: "IMAGE", image: { url: file.image!.url } };
    });
    const product: RawProduct = {
      id,
      handle: input.handle,
      title: input.title,
      descriptionHtml: input.descriptionHtml ?? `<p>${input.title}</p>`,
      vendor: input.vendor ?? "Acme",
      productType: input.productType ?? "Shirts",
      tags: input.tags ?? [],
      status: input.status ?? "ACTIVE",
      templateSuffix: null,
      isGiftCard: false,
      requiresSellingPlan: false,
      category: null,
      seo: { title: null, description: null },
      options: optionNames.map((name, i) => ({ name, position: i + 1, values: [...new Set(variants.map((v) => v.selectedOptions.find((o) => o.name === name)!.value))] })),
      variants: { nodes: variants, pageInfo: { hasNextPage: false, endCursor: null } },
      media: { nodes: media },
      metafields: { nodes: input.metafields?.nodes ?? [] },
    };
    this.products.push(product);
    this.published.add(id);
    return product;
  }

  addFile(name: string, contentType: "IMAGE" | "FILE" = "FILE"): RawFile {
    const url = this.cdn(name);
    const file: RawFile =
      contentType === "IMAGE"
        ? { __typename: "MediaImage", id: this.gid("MediaImage"), alt: "", fileStatus: "READY", image: { url }, mimeType: "image/png" }
        : { __typename: "GenericFile", id: this.gid("GenericFile"), alt: "", fileStatus: "READY", url, mimeType: "application/pdf" };
    this.files.push(file);
    return file;
  }

  product(handle: string) {
    return this.products.find((p) => p.handle === handle);
  }

  // ---------------------------------------------------------------------------
  // GraphQL entry point (matches the AdminClient interface)
  // ---------------------------------------------------------------------------

  graphql = async (query: string, options?: { variables?: Vars }): Promise<Response> => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
    if (!name) throw new Error("Unnamed operation");
    const handler = (this as unknown as Record<string, (v: Vars) => unknown>)[`op_${name}`];
    if (!handler) throw new Error(`FakeStore: unsupported operation ${name}`);
    if (/^\s*mutation/.test(query)) this.log.push(name);
    const data = handler.call(this, options?.variables ?? {});
    return new Response(JSON.stringify({ data }));
  };

  // ---------------------------------------------------------------------------
  // Themes
  // ---------------------------------------------------------------------------

  private themeFileMeta(f: ThemeFile) {
    return { filename: f.filename, checksumMd5: md5ish(f.body), size: f.body.length, contentType: f.contentType, updatedAt: f.updatedAt };
  }

  op_StoreStageThemes() {
    return { themes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: this.themes } };
  }
  op_StoreStageTheme(v: Vars) {
    return { theme: this.themes.find((t) => t.id === v.id) ?? null };
  }
  op_StoreStageThemeFileMeta(v: Vars) {
    const files = [...(this.themeFiles.get(String(v.id))?.values() ?? [])].sort((a, b) => a.filename.localeCompare(b.filename));
    return { theme: { id: v.id, files: page(files.map((f) => this.themeFileMeta(f)), Number(v.first), v.after as string) } };
  }
  op_StoreStageThemeFileBodies(v: Vars) {
    const files = this.themeFiles.get(String(v.id));
    const nodes = (v.filenames as string[])
      .map((n) => files?.get(n))
      .filter((f): f is ThemeFile => Boolean(f))
      .map((f) => ({
        ...this.themeFileMeta(f),
        body: f.encoding === "base64" ? { __typename: "OnlineStoreThemeFileBodyBase64", contentBase64: f.body } : { __typename: "OnlineStoreThemeFileBodyText", content: f.body },
      }));
    return { theme: { id: v.id, files: { nodes } } };
  }
  op_StoreStageThemeDuplicate(v: Vars) {
    const source = this.themes.find((t) => t.id === v.id)!;
    const files = this.themeFiles.get(source.id)!;
    const copy = this.addTheme(String(v.name ?? `Copy of ${source.name}`), "UNPUBLISHED", {});
    const map = this.themeFiles.get(copy.id)!;
    for (const f of files.values()) map.set(f.filename, { ...f }); // duplicates keep file timestamps
    return { themeDuplicate: { newTheme: copy, ...noErrors } };
  }
  op_StoreStageThemeFilesUpsert(v: Vars) {
    for (const f of v.files as { filename: string; body: { type: string; value: string } }[]) this.writeThemeFile(String(v.themeId), f.filename, f.body.value);
    return { themeFilesUpsert: { job: null, upsertedThemeFiles: [], ...noErrors } };
  }
  op_StoreStageThemeFilesDelete(v: Vars) {
    const files = this.themeFiles.get(String(v.themeId))!;
    for (const name of v.files as string[]) files.delete(name);
    return { themeFilesDelete: { deletedThemeFiles: [], ...noErrors } };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  op_StoreStageProducts(v: Vars) {
    return { products: page(this.products, Number(v.first), v.after as string) };
  }
  op_StoreStageProductVariants(v: Vars) {
    const p = this.products.find((x) => x.id === v.id);
    return { product: p ? { variants: page(p.variants.nodes, Number(v.first), v.after as string) } : null };
  }
  op_StoreStageCollections(v: Vars) {
    return { collections: page(this.collections, Number(v.first), v.after as string) };
  }
  op_StoreStagePages(v: Vars) {
    return { pages: page(this.pages, Number(v.first), v.after as string) };
  }
  op_StoreStageBlogs(v: Vars) {
    return { blogs: page(this.blogs, Number(v.first), v.after as string) };
  }
  op_StoreStageArticles(v: Vars) {
    return { articles: page(this.articles, Number(v.first), v.after as string) };
  }
  op_StoreStageMenus(v: Vars) {
    return { menus: page(this.menus, Number(v.first), v.after as string) };
  }
  op_StoreStageUrlRedirects(v: Vars) {
    return { urlRedirects: page(this.redirects, Number(v.first), v.after as string) };
  }
  op_StoreStageMetafieldDefinitions(v: Vars) {
    return { metafieldDefinitions: page(this.metafieldDefinitions.filter((d) => d.ownerType === v.ownerType), Number(v.first), v.after as string) };
  }
  op_StoreStageMetaobjectDefinitions(v: Vars) {
    return { metaobjectDefinitions: page(this.metaobjectDefinitions, Number(v.first), v.after as string) };
  }
  op_StoreStageMetaobjects(v: Vars) {
    return { metaobjects: page(this.metaobjects.filter((m) => m.type === v.type), Number(v.first), v.after as string) };
  }
  op_StoreStageFiles(v: Vars) {
    return { files: page(this.files, Number(v.first), v.after as string) };
  }
  op_StoreStageShopSettings() {
    return { shop: this.settings };
  }
  op_StoreStagePublications() {
    return { publications: { nodes: [{ id: this.publicationId, catalog: { title: "Online Store" } }] } };
  }
  op_StoreStageProductIndex(v: Vars) {
    return { products: page(this.products.map((p) => ({ id: p.id, handle: p.handle, title: p.title })), Number(v.first), v.after as string) };
  }
  op_StoreStageCollectionIndex(v: Vars) {
    return { collections: page(this.collections.map((p) => ({ id: p.id, handle: p.handle, title: p.title })), Number(v.first), v.after as string) };
  }
  op_StoreStagePageIndex(v: Vars) {
    return { pages: page(this.pages.map((p) => ({ id: p.id, handle: p.handle, title: p.title })), Number(v.first), v.after as string) };
  }
  op_StoreStageBlogIndex(v: Vars) {
    return { blogs: page(this.blogs.map((p) => ({ id: p.id, handle: p.handle, title: p.title })), Number(v.first), v.after as string) };
  }
  op_StoreStageArticleIndex(v: Vars) {
    return { articles: page(this.articles.map((a) => ({ id: a.id, handle: a.handle, title: a.title, blog: { handle: a.blog.handle } })), Number(v.first), v.after as string) };
  }
  op_StoreStageMetaobjectIndex(v: Vars) {
    return { metaobjects: page(this.metaobjects.filter((m) => m.type === v.type).map((m) => ({ id: m.id, handle: m.handle, type: m.type, displayName: m.displayName })), Number(v.first), v.after as string) };
  }
  op_StoreStageMetaobjectTypes(v: Vars) {
    return { metaobjectDefinitions: page(this.metaobjectDefinitions.map((d) => ({ id: d.id, type: d.type, name: d.name })), Number(v.first), v.after as string) };
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  private metafieldsFromInput(input: unknown): RawMetafield[] {
    return ((input as Obj[] | undefined) ?? []).map((m) => ({ namespace: String(m.namespace), key: String(m.key), type: String(m.type), value: String(m.value) }));
  }

  private mergeMetafields(existing: RawMetafield[], input: unknown): RawMetafield[] {
    const out = [...existing];
    for (const m of this.metafieldsFromInput(input)) {
      const i = out.findIndex((x) => x.namespace === m.namespace && x.key === m.key);
      if (i >= 0) out[i] = m;
      else out.push(m);
    }
    return out;
  }

  private findByGid(gid: string): RawFile | undefined {
    return this.files.find((f) => f.id === gid);
  }

  op_StoreStageProductSet(v: Vars) {
    const input = v.input as Obj;
    const identifier = v.identifier as { id?: string } | null;
    let product = identifier?.id ? this.products.find((p) => p.id === identifier.id) : undefined;
    if (identifier?.id && !product) return { productSet: { product: null, userErrors: [{ field: ["identifier"], message: "Product not found" }] } };
    if (!product) {
      if (this.products.some((p) => p.handle === input.handle)) {
        return { productSet: { product: null, userErrors: [{ field: ["handle"], message: "Handle already taken" }] } };
      }
      product = this.addProduct({ handle: String(input.handle), title: String(input.title) });
      product.variants.nodes = [];
      this.published.delete(product.id);
    }
    const p = product;
    for (const key of ["title", "descriptionHtml", "vendor", "productType", "status", "templateSuffix"] as const) {
      if (input[key] !== undefined) (p as unknown as Obj)[key] = input[key];
    }
    if (input.tags) p.tags = input.tags as string[];
    if (input.seo) p.seo = { title: null, description: null, ...(input.seo as Obj) } as RawProduct["seo"];
    if (input.productOptions) {
      p.options = (input.productOptions as { name: string; values: { name: string }[] }[]).map((o, i) => ({ name: o.name, position: i + 1, values: o.values.map((x) => x.name) }));
    }
    if (input.variants) {
      p.variants.nodes = (input.variants as Obj[]).map((vi, i) => {
        const existing = vi.id ? p.variants.nodes.find((x) => x.id === vi.id) : undefined;
        if (vi.id && !existing) throw new Error(`Variant ${String(vi.id)} doesn't belong to product`);
        return {
          id: existing?.id ?? this.gid("ProductVariant"),
          sku: (vi.sku as string) ?? null,
          price: String(vi.price ?? "0.00"),
          compareAtPrice: (vi.compareAtPrice as string) ?? null,
          taxable: vi.taxable !== false,
          inventoryPolicy: String(vi.inventoryPolicy ?? "DENY"),
          position: i + 1,
          selectedOptions: (vi.optionValues as { optionName: string; name: string }[]).map((o) => ({ name: o.optionName, value: o.name })),
          barcode: (vi.barcode as string) ?? null,
        };
      });
    }
    if (input.files) {
      p.media.nodes = (input.files as Obj[]).map((f) => {
        if (f.id) {
          const file = this.findByGid(String(f.id));
          if (!file) throw new Error(`File ${String(f.id)} not found`);
          return { id: file.id, alt: (f.alt as string) ?? "", mediaContentType: "IMAGE", image: { url: file.image!.url } };
        }
        const name = new URL(String(f.originalSource)).pathname.split("/").pop()!;
        const file = this.addFile(name, "IMAGE");
        return { id: file.id, alt: (f.alt as string) ?? "", mediaContentType: "IMAGE", image: { url: file.image!.url } };
      });
    }
    if (input.metafields) p.metafields.nodes = this.mergeMetafields(p.metafields.nodes, input.metafields);
    return { productSet: { product: { id: p.id, handle: p.handle }, ...noErrors } };
  }

  op_StoreStageProductDelete(v: Vars) {
    this.products = this.products.filter((p) => p.id !== v.id);
    return { productDelete: { deletedProductId: v.id, ...noErrors } };
  }

  op_StoreStagePublish(v: Vars) {
    this.published.add(String(v.id));
    return { publishablePublish: noErrors };
  }

  op_StoreStageMetafieldsDelete(v: Vars) {
    for (const m of v.metafields as { ownerId: string; namespace: string; key: string }[]) {
      const owner = [...this.products, ...this.collections, ...this.pages, ...this.blogs, ...this.articles].find((o) => o.id === m.ownerId);
      if (owner) owner.metafields.nodes = owner.metafields.nodes.filter((x) => !(x.namespace === m.namespace && x.key === m.key));
    }
    return { metafieldsDelete: { deletedMetafields: [], ...noErrors } };
  }

  private applyCollection(c: RawCollection, input: Obj) {
    for (const key of ["title", "descriptionHtml", "sortOrder", "templateSuffix", "handle"] as const) if (input[key] !== undefined) (c as unknown as Obj)[key] = input[key];
    if (input.seo) c.seo = { title: null, description: null, ...(input.seo as Obj) } as RawCollection["seo"];
    if (input.ruleSet) c.ruleSet = input.ruleSet as RawCollection["ruleSet"];
    if (input.image) {
      const img = input.image as { src: string; altText: string };
      c.image = { url: this.cdn(new URL(img.src).pathname.split("/").pop()!), altText: img.altText };
    }
    if (input.metafields) c.metafields.nodes = this.mergeMetafields(c.metafields.nodes, input.metafields);
  }

  op_StoreStageCollectionCreate(v: Vars) {
    const input = v.input as Obj;
    const c: RawCollection = {
      id: this.gid("Collection"),
      handle: String(input.handle),
      title: String(input.title),
      descriptionHtml: "",
      sortOrder: "MANUAL",
      templateSuffix: null,
      seo: { title: null, description: null },
      image: null,
      ruleSet: null,
      products: { nodes: ((input.products as string[]) ?? []).map((id) => ({ id })) },
      metafields: { nodes: [] },
    };
    this.applyCollection(c, input);
    this.collections.push(c);
    return { collectionCreate: { collection: { id: c.id, handle: c.handle }, ...noErrors } };
  }
  op_StoreStageCollectionUpdate(v: Vars) {
    const input = v.input as Obj;
    const c = this.collections.find((x) => x.id === input.id)!;
    this.applyCollection(c, input);
    return { collectionUpdate: { collection: { id: c.id, handle: c.handle }, ...noErrors } };
  }
  op_StoreStageCollectionAddProducts(v: Vars) {
    const c = this.collections.find((x) => x.id === v.id)!;
    c.products.nodes.push(...(v.productIds as string[]).map((id) => ({ id })));
    return { collectionAddProducts: { collection: { id: c.id }, ...noErrors } };
  }
  op_StoreStageCollectionRemoveProducts(v: Vars) {
    const c = this.collections.find((x) => x.id === v.id)!;
    c.products.nodes = c.products.nodes.filter((n) => !(v.productIds as string[]).includes(n.id));
    return { collectionRemoveProducts: { job: null, ...noErrors } };
  }
  op_StoreStageCollectionDelete(v: Vars) {
    this.collections = this.collections.filter((c) => c.id !== v.id);
    return { collectionDelete: { deletedCollectionId: v.id, ...noErrors } };
  }

  op_StoreStagePageCreate(v: Vars) {
    const input = v.page as Obj;
    const p: RawPage = { id: this.gid("Page"), handle: String(input.handle), title: String(input.title), body: String(input.body ?? ""), isPublished: input.isPublished === true, templateSuffix: (input.templateSuffix as string) ?? null, metafields: { nodes: this.metafieldsFromInput(input.metafields) } };
    this.pages.push(p);
    return { pageCreate: { page: { id: p.id, handle: p.handle }, ...noErrors } };
  }
  op_StoreStagePageUpdate(v: Vars) {
    const input = v.page as Obj;
    const p = this.pages.find((x) => x.id === v.id)!;
    for (const key of ["title", "body", "isPublished", "templateSuffix", "handle"] as const) if (input[key] !== undefined) (p as unknown as Obj)[key] = input[key];
    if (input.metafields) p.metafields.nodes = this.mergeMetafields(p.metafields.nodes, input.metafields);
    return { pageUpdate: { page: { id: p.id, handle: p.handle }, ...noErrors } };
  }
  op_StoreStagePageDelete(v: Vars) {
    this.pages = this.pages.filter((p) => p.id !== v.id);
    return { pageDelete: { deletedPageId: v.id, ...noErrors } };
  }

  op_StoreStageBlogCreate(v: Vars) {
    const input = v.blog as Obj;
    const b: RawBlog = { id: this.gid("Blog"), handle: String(input.handle), title: String(input.title), commentPolicy: String(input.commentPolicy ?? "CLOSED"), templateSuffix: (input.templateSuffix as string) ?? null, metafields: { nodes: this.metafieldsFromInput(input.metafields) } };
    this.blogs.push(b);
    return { blogCreate: { blog: { id: b.id, handle: b.handle }, ...noErrors } };
  }
  op_StoreStageBlogUpdate(v: Vars) {
    const input = v.blog as Obj;
    const b = this.blogs.find((x) => x.id === v.id)!;
    for (const key of ["title", "commentPolicy", "templateSuffix"] as const) if (input[key] !== undefined) (b as unknown as Obj)[key] = input[key];
    return { blogUpdate: { blog: { id: b.id, handle: b.handle }, ...noErrors } };
  }
  op_StoreStageBlogDelete(v: Vars) {
    this.blogs = this.blogs.filter((b) => b.id !== v.id);
    return { blogDelete: { deletedBlogId: v.id, ...noErrors } };
  }

  op_StoreStageArticleCreate(v: Vars) {
    const input = v.article as Obj;
    const blog = this.blogs.find((b) => b.id === input.blogId);
    if (!blog) return { articleCreate: { article: null, userErrors: [{ field: ["blogId"], message: "Blog not found" }] } };
    const a: RawArticle = {
      id: this.gid("Article"),
      handle: String(input.handle),
      title: String(input.title),
      body: String(input.body ?? ""),
      summary: (input.summary as string) ?? null,
      tags: (input.tags as string[]) ?? [],
      isPublished: input.isPublished === true,
      templateSuffix: null,
      author: { name: String((input.author as Obj).name) },
      blog: { id: blog.id, handle: blog.handle },
      image: null,
      metafields: { nodes: this.metafieldsFromInput(input.metafields) },
    };
    this.articles.push(a);
    return { articleCreate: { article: { id: a.id, handle: a.handle }, ...noErrors } };
  }
  op_StoreStageArticleUpdate(v: Vars) {
    const input = v.article as Obj;
    const a = this.articles.find((x) => x.id === v.id)!;
    for (const key of ["title", "body", "summary", "tags", "isPublished"] as const) if (input[key] !== undefined) (a as unknown as Obj)[key] = input[key];
    return { articleUpdate: { article: { id: a.id, handle: a.handle }, ...noErrors } };
  }
  op_StoreStageArticleDelete(v: Vars) {
    this.articles = this.articles.filter((a) => a.id !== v.id);
    return { articleDelete: { deletedArticleId: v.id, ...noErrors } };
  }

  private menuItems(items: Obj[]): RawMenuItem[] {
    return items.map((i) => ({
      title: String(i.title),
      type: String(i.type),
      url: (i.url as string) ?? (i.resourceId ? `/resource/${String(i.resourceId).split("/").pop()}` : null),
      resourceId: (i.resourceId as string) ?? null,
      tags: (i.tags as string[]) ?? [],
      items: this.menuItems((i.items as Obj[]) ?? []),
    }));
  }
  op_StoreStageMenuCreate(v: Vars) {
    const m: RawMenu = { id: this.gid("Menu"), handle: String(v.handle), title: String(v.title), isDefault: false, items: this.menuItems(v.items as Obj[]) };
    this.menus.push(m);
    return { menuCreate: { menu: { id: m.id, handle: m.handle }, ...noErrors } };
  }
  op_StoreStageMenuUpdate(v: Vars) {
    const m = this.menus.find((x) => x.id === v.id)!;
    m.title = String(v.title);
    m.items = this.menuItems(v.items as Obj[]);
    return { menuUpdate: { menu: { id: m.id, handle: m.handle }, ...noErrors } };
  }
  op_StoreStageMenuDelete(v: Vars) {
    this.menus = this.menus.filter((m) => m.id !== v.id);
    return { menuDelete: { deletedMenuId: v.id, ...noErrors } };
  }

  op_StoreStageUrlRedirectCreate(v: Vars) {
    const input = v.urlRedirect as { path: string; target: string };
    const r = { id: this.gid("UrlRedirect"), path: input.path, target: input.target };
    this.redirects.push(r);
    return { urlRedirectCreate: { urlRedirect: { id: r.id, path: r.path }, ...noErrors } };
  }
  op_StoreStageUrlRedirectUpdate(v: Vars) {
    const r = this.redirects.find((x) => x.id === v.id)!;
    Object.assign(r, v.urlRedirect);
    return { urlRedirectUpdate: { urlRedirect: { id: r.id, path: r.path }, ...noErrors } };
  }
  op_StoreStageUrlRedirectDelete(v: Vars) {
    this.redirects = this.redirects.filter((r) => r.id !== v.id);
    return { urlRedirectDelete: { deletedUrlRedirectId: v.id, ...noErrors } };
  }

  op_StoreStageMetafieldDefinitionCreate(v: Vars) {
    const d = v.definition as Obj;
    const def: RawMetafieldDefinition = {
      id: this.gid("MetafieldDefinition"),
      namespace: String(d.namespace),
      key: String(d.key),
      name: String(d.name),
      description: (d.description as string) ?? null,
      ownerType: String(d.ownerType),
      pinnedPosition: d.pin ? 1 : null,
      type: { name: String(d.type) },
      validations: ((d.validations as { name: string; value: string }[]) ?? []).map((x) => ({ name: x.name, value: x.value })),
    };
    this.metafieldDefinitions.push(def);
    return { metafieldDefinitionCreate: { createdDefinition: { id: def.id }, ...noErrors } };
  }
  op_StoreStageMetafieldDefinitionUpdate(v: Vars) {
    const d = v.definition as Obj;
    const def = this.metafieldDefinitions.find((x) => x.namespace === d.namespace && x.key === d.key && x.ownerType === d.ownerType)!;
    def.name = String(d.name);
    def.description = (d.description as string) ?? null;
    def.validations = (d.validations as { name: string; value: string }[]) ?? [];
    def.pinnedPosition = d.pin ? 1 : null;
    return { metafieldDefinitionUpdate: { updatedDefinition: { id: def.id }, ...noErrors } };
  }
  op_StoreStageMetafieldDefinitionDelete(v: Vars) {
    this.metafieldDefinitions = this.metafieldDefinitions.filter((d) => d.id !== v.id);
    return { metafieldDefinitionDelete: { deletedDefinitionId: v.id, ...noErrors } };
  }

  private capabilitiesFromInput(caps: Obj | undefined): RawMetaobjectDefinition["capabilities"] {
    const c = caps ?? {};
    const os = c.onlineStore as { enabled: boolean; data?: { urlHandle: string } } | undefined;
    return {
      publishable: { enabled: Boolean((c.publishable as Obj | undefined)?.enabled) },
      translatable: { enabled: Boolean((c.translatable as Obj | undefined)?.enabled) },
      renderable: { enabled: Boolean((c.renderable as Obj | undefined)?.enabled) },
      onlineStore: os?.enabled ? { enabled: true, data: { urlHandle: os.data?.urlHandle ?? "" } } : { enabled: false, data: null },
    };
  }
  op_StoreStageMetaobjectDefinitionCreate(v: Vars) {
    const d = v.definition as Obj;
    const def: RawMetaobjectDefinition = {
      id: this.gid("MetaobjectDefinition"),
      type: String(d.type),
      name: String(d.name),
      description: (d.description as string) ?? null,
      displayNameKey: (d.displayNameKey as string) ?? null,
      capabilities: this.capabilitiesFromInput(d.capabilities as Obj),
      fieldDefinitions: ((d.fieldDefinitions as Obj[]) ?? []).map((f) => ({
        key: String(f.key),
        name: String(f.name),
        description: (f.description as string) ?? null,
        required: f.required === true,
        type: { name: String(f.type) },
        validations: (f.validations as { name: string; value: string }[]) ?? [],
      })),
    };
    this.metaobjectDefinitions.push(def);
    return { metaobjectDefinitionCreate: { metaobjectDefinition: { id: def.id, type: def.type }, ...noErrors } };
  }
  op_StoreStageMetaobjectDefinitionUpdate(v: Vars) {
    const d = v.definition as Obj;
    const def = this.metaobjectDefinitions.find((x) => x.id === v.id)!;
    def.name = String(d.name);
    def.capabilities = this.capabilitiesFromInput(d.capabilities as Obj);
    for (const op of (d.fieldDefinitions as Obj[]) ?? []) {
      if (op.create) {
        const f = op.create as Obj;
        def.fieldDefinitions.push({ key: String(f.key), name: String(f.name), description: null, required: f.required === true, type: { name: String(f.type) }, validations: [] });
      } else if (op.update) {
        const f = op.update as Obj;
        const existing = def.fieldDefinitions.find((x) => x.key === f.key)!;
        existing.name = String(f.name);
      } else if (op.delete) {
        def.fieldDefinitions = def.fieldDefinitions.filter((x) => x.key !== (op.delete as Obj).key);
      }
    }
    return { metaobjectDefinitionUpdate: { metaobjectDefinition: { id: def.id, type: def.type }, ...noErrors } };
  }
  op_StoreStageMetaobjectDefinitionDelete(v: Vars) {
    this.metaobjectDefinitions = this.metaobjectDefinitions.filter((d) => d.id !== v.id);
    return { metaobjectDefinitionDelete: { deletedId: v.id, ...noErrors } };
  }

  op_StoreStageMetaobjectUpsert(v: Vars) {
    const handle = v.handle as { type: string; handle: string };
    const input = v.metaobject as Obj;
    if (!this.metaobjectDefinitions.some((d) => d.type === handle.type)) {
      return { metaobjectUpsert: { metaobject: null, userErrors: [{ field: ["handle", "type"], message: "No definition" }] } };
    }
    let m = this.metaobjects.find((x) => x.type === handle.type && x.handle === handle.handle);
    if (!m) {
      m = { id: this.gid("Metaobject"), handle: handle.handle, type: handle.type, displayName: handle.handle, fields: [], capabilities: { publishable: null, onlineStore: null } };
      this.metaobjects.push(m);
    }
    for (const f of (input.fields as { key: string; value: string }[]) ?? []) {
      const existing = m.fields.find((x) => x.key === f.key);
      if (existing) existing.value = f.value;
      else m.fields.push({ key: f.key, value: f.value, type: "single_line_text_field" });
    }
    const caps = input.capabilities as Obj | undefined;
    if (caps?.publishable) m.capabilities.publishable = caps.publishable as { status: string };
    return { metaobjectUpsert: { metaobject: { id: m.id, handle: m.handle }, ...noErrors } };
  }
  op_StoreStageMetaobjectDelete(v: Vars) {
    this.metaobjects = this.metaobjects.filter((m) => m.id !== v.id);
    return { metaobjectDelete: { deletedId: v.id, ...noErrors } };
  }

  op_StoreStageFileCreate(v: Vars) {
    const created = (v.files as Obj[]).map((f) => {
      const file = this.addFile(String(f.filename ?? new URL(String(f.originalSource)).pathname.split("/").pop()), f.contentType === "IMAGE" ? "IMAGE" : "FILE");
      file.alt = (f.alt as string) ?? "";
      return { id: file.id, fileStatus: "UPLOADED" };
    });
    return { fileCreate: { files: created, ...noErrors } };
  }
  op_StoreStageFileUpdate(v: Vars) {
    for (const f of v.files as { id: string; alt: string }[]) {
      const file = this.findByGid(f.id);
      if (file) file.alt = f.alt;
    }
    return { fileUpdate: { files: (v.files as { id: string }[]).map((f) => ({ id: f.id })), ...noErrors } };
  }
  op_StoreStageFileDelete(v: Vars) {
    this.files = this.files.filter((f) => !(v.fileIds as string[]).includes(f.id));
    return { fileDelete: { deletedFileIds: v.fileIds, ...noErrors } };
  }
}
