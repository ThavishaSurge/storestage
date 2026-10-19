import { describe, expect, it } from "vitest";
import type { RawMetaobject, RawProduct } from "../shopify/queries";
import { buildOperations } from "./build";
import { diffStores, resolvedData, sortChanges } from "./diff";
import { fileKeyFromUrl, normalizeMenu, normalizeMetaobject, normalizeProduct } from "./normalize";
import { buildIndexes, fromPortable, referencedRefs, toPortable } from "./refs";
import type { NormalizedResource } from "./types";

function product(idBase: number, overrides: Partial<RawProduct> = {}): RawProduct {
  return {
    id: `gid://shopify/Product/${idBase}`,
    handle: "red-shirt",
    title: "Red shirt",
    descriptionHtml: "<p>Soft</p>",
    vendor: "Acme",
    productType: "Shirts",
    tags: ["summer", "cotton"],
    status: "ACTIVE",
    templateSuffix: "",
    isGiftCard: false,
    requiresSellingPlan: false,
    category: { id: "gid://shopify/TaxonomyCategory/aa-1-13-8" },
    seo: { title: null, description: null },
    options: [{ name: "Size", position: 1, values: ["S", "M"] }],
    variants: {
      nodes: [
        { id: `gid://shopify/ProductVariant/${idBase}1`, sku: "RS-S", price: "20.00", compareAtPrice: null, taxable: true, inventoryPolicy: "DENY", position: 1, selectedOptions: [{ name: "Size", value: "S" }], barcode: null },
        { id: `gid://shopify/ProductVariant/${idBase}2`, sku: "RS-M", price: "20.00", compareAtPrice: null, taxable: true, inventoryPolicy: "DENY", position: 2, selectedOptions: [{ name: "Size", value: "M" }], barcode: "" },
      ],
    },
    media: {
      nodes: [
        {
          id: `gid://shopify/MediaImage/${idBase}9`,
          alt: "Front",
          mediaContentType: "IMAGE",
          image: { url: `https://cdn.shopify.com/s/files/1/000${idBase}/files/red-shirt_0b4ac2f1-1b2c-4d5e-8f90-123456789abc.jpg?v=1` },
        },
      ],
    },
    metafields: {
      nodes: [
        { namespace: "custom", key: "author", type: "metaobject_reference", value: `gid://shopify/Metaobject/${idBase}7` },
        { namespace: "app--123--x", key: "secret", type: "single_line_text_field", value: "skip me" },
      ],
    },
    ...overrides,
  };
}

function metaobject(id: number): RawMetaobject {
  return {
    id: `gid://shopify/Metaobject/${id}`,
    handle: "jane",
    type: "author",
    displayName: "Jane",
    fields: [{ key: "name", value: "Jane", type: "single_line_text_field" }],
    capabilities: { publishable: { status: "ACTIVE" }, onlineStore: null },
  };
}

/** Mimics the snapshot pipeline: normalize, index, convert GIDs to portable refs. */
function snapshot(products: RawProduct[], metaobjects: RawMetaobject[]): NormalizedResource[] {
  const outputs = [...metaobjects.map((m) => normalizeMetaobject(m)!), ...products.map(normalizeProduct)];
  const { gidIndex } = buildIndexes(outputs.map((o) => o.resource), outputs.flatMap((o) => o.aliases));
  return outputs.map((o) => ({ ...o.resource, data: toPortable(o.resource.data, gidIndex) }));
}

describe("normalization & portable refs", () => {
  it("strips Shopify's duplicate-file suffix from CDN keys", () => {
    expect(fileKeyFromUrl("https://cdn.shopify.com/s/files/1/0001/files/a_0b4ac2f1-1b2c-4d5e-8f90-123456789abc.png?v=2")).toBe("a.png");
    expect(fileKeyFromUrl("https://cdn.shopify.com/s/files/1/0001/files/my%20pic.jpg")).toBe("my pic.jpg");
    expect(fileKeyFromUrl(null)).toBeNull();
  });

  it("makes the same product identical across stores despite different GIDs", () => {
    const staging = snapshot([product(1)], [metaobject(17)]);
    const live = snapshot([product(2)], [metaobject(27)]);
    const s = staging.find((r) => r.type === "product")!;
    const l = live.find((r) => r.type === "product")!;
    expect(s.data).toEqual(l.data);
    expect(s.data.metafields).toEqual({ "custom.author": { type: "metaobject_reference", value: "@@ref:metaobject:author/jane@@" } });
    expect(s.data.tags).toEqual(["cotton", "summer"]);
    expect(s.transfer).toEqual({ mediaUrls: { "red-shirt.jpg": expect.stringContaining("/0001/") } });
  });

  it("round-trips refs into the target store's GIDs, inside JSON strings too", () => {
    const value = { list: '["gid://shopify/Product/1","gid://shopify/Product/404"]' };
    const unknown = new Set<string>();
    const portable = toPortable(value, new Map([["gid://shopify/Product/1", "product:red-shirt"]]), unknown);
    expect(portable.list).toBe('["@@ref:product:red-shirt@@","gid://shopify/Product/404"]');
    expect([...unknown]).toEqual(["gid://shopify/Product/404"]);
    expect([...referencedRefs(portable)]).toEqual(["product:red-shirt"]);
    const missing = new Set<string>();
    expect(fromPortable(portable, new Map([["product:red-shirt", "gid://shopify/Product/999"]]), missing).list).toBe(
      '["gid://shopify/Product/999","gid://shopify/Product/404"]',
    );
    expect(missing.size).toBe(0);
  });

  it("drops URLs from resource-linked menu items", () => {
    const menu = normalizeMenu({
      id: "gid://shopify/Menu/1",
      handle: "main-menu",
      title: "Main",
      isDefault: true,
      items: [{ title: "Shirts", type: "COLLECTION", url: "/collections/shirts", resourceId: "gid://shopify/Collection/5", tags: [], items: [] }],
    });
    expect(menu.resource.data.items).toEqual([{ title: "Shirts", type: "COLLECTION", url: null, resourceId: "gid://shopify/Collection/5", tags: [], items: [] }]);
  });
});

describe("diffStores", () => {
  const base = snapshot([product(2)], [metaobject(27)]);

  it("classifies staging-only, live-only, both and conflicts", () => {
    const staging = snapshot(
      [
        product(1, { title: "Red shirt v2" }),
        product(1, { id: "gid://shopify/Product/50", handle: "new-hat", title: "New hat" }),
      ],
      [metaobject(17)],
    );
    const live = snapshot([product(2, { vendor: "Acme Co" })], []); // vendor drift + metaobject deleted on live
    const changes = diffStores({ base, staging, live });
    const byKey = Object.fromEntries(changes.map((c) => [`${c.type}:${c.key}`, c]));

    expect(byKey["product:red-shirt"]).toMatchObject({ status: "auto-merged", action: "update", recommended: true });
    expect(byKey["product:red-shirt"].merged).toMatchObject({ title: "Red shirt v2", vendor: "Acme Co" });
    expect(byKey["product:new-hat"]).toMatchObject({ status: "staging-changed", action: "create", recommended: true });
    expect(byKey["metaobject:author/jane"]).toMatchObject({ status: "live-changed", action: "none" });
  });

  it("reports field conflicts and resolves them with decisions", () => {
    const staging = snapshot([product(1, { title: "Staging title" })], [metaobject(17)]);
    const live = snapshot([product(2, { title: "Client title" })], [metaobject(27)]);
    const [change] = diffStores({ base, staging, live });
    expect(change).toMatchObject({ status: "conflict", action: "update", recommended: false });
    expect(change.conflicts.map((c) => c.id)).toEqual(["title"]);
    expect(resolvedData(change, {})?.title).toBe("Staging title");
    expect(resolvedData(change, { title: "left" })?.title).toBe("Client title");
  });

  it("treats staging deletes as opt-in", () => {
    const staging = snapshot([], [metaobject(17)]);
    const live = snapshot([product(2)], [metaobject(27)]);
    const [change] = diffStores({ base, staging, live });
    expect(change).toMatchObject({ action: "delete", recommended: false });
  });

  it("orders writes by dependency and deletes last in reverse", () => {
    const ordered = sortChanges([
      { type: "menu", key: "main", action: "update", merged: {}, staging: {} },
      { type: "product", key: "p", action: "create", merged: {}, staging: {} },
      { type: "file", key: "f", action: "delete", merged: null, staging: null },
      { type: "metaobject", key: "a/2", action: "create", merged: { fields: { parent: "@@ref:metaobject:a/3@@" } }, staging: {} },
      { type: "metaobject", key: "a/3", action: "create", merged: {}, staging: {} },
      { type: "page", key: "about", action: "delete", merged: null, staging: null },
    ] as never[]);
    expect(ordered.map((c: { type: string; key: string }) => `${c.type}:${c.key}`)).toEqual([
      "metaobject:a/3",
      "metaobject:a/2",
      "product:p",
      "menu:main",
      "page:about",
      "file:f",
    ]);
  });
});

describe("buildOperations", () => {
  const live = snapshot([product(2)], [metaobject(27)]);
  const liveProduct = live.find((r) => r.type === "product")!;
  const liveOutputs = [normalizeMetaobject(metaobject(27))!, normalizeProduct(product(2))];
  const { refIndex } = buildIndexes(liveOutputs.map((o) => o.resource), liveOutputs.flatMap((o) => o.aliases));

  it("updates a product in place, reusing live variant and media IDs", () => {
    const data = { ...liveProduct.data, title: "New title", media: [...(liveProduct.data.media as never[]), { key: "back.jpg", alt: "Back", type: "IMAGE" }] };
    const { operations, missingRefs } = buildOperations({
      type: "product",
      key: "red-shirt",
      action: "update",
      data,
      liveData: liveProduct.data,
      transfer: { mediaUrls: { "back.jpg": "https://cdn.shopify.com/s/files/1/0001/files/back.jpg" } },
      liveGid: "gid://shopify/Product/2",
      refIndex,
    });
    expect(missingRefs).toEqual([]);
    const input = operations[0].variables.input as Record<string, unknown>;
    expect(operations[0].variables.identifier).toEqual({ id: "gid://shopify/Product/2" });
    expect(input.title).toBe("New title");
    expect((input.variants as { id?: string }[]).map((v) => v.id)).toEqual(["gid://shopify/ProductVariant/21", "gid://shopify/ProductVariant/22"]);
    expect(input.files).toEqual([
      { id: "gid://shopify/MediaImage/29", alt: "Front" },
      { originalSource: "https://cdn.shopify.com/s/files/1/0001/files/back.jpg", alt: "Back", contentType: "IMAGE" },
    ]);
    expect(input.metafields).toEqual([{ namespace: "custom", key: "author", type: "metaobject_reference", value: "gid://shopify/Metaobject/27" }]);
  });

  it("omits media when unchanged and deletes removed metafields", () => {
    const data = { ...liveProduct.data, metafields: {} };
    const { operations } = buildOperations({ type: "product", key: "red-shirt", action: "update", data, liveData: liveProduct.data, transfer: {}, liveGid: "gid://shopify/Product/2", refIndex });
    expect((operations[0].variables.input as Record<string, unknown>).files).toBeUndefined();
    expect(operations[1]).toMatchObject({ root: "metafieldsDelete", variables: { metafields: [{ ownerId: "gid://shopify/Product/2", namespace: "custom", key: "author" }] } });
  });

  it("reports references that don't exist on the target yet", () => {
    const data = { ...liveProduct.data, metafields: { "custom.author": { type: "metaobject_reference", value: "@@ref:metaobject:author/bob@@" } } };
    const { missingRefs } = buildOperations({ type: "product", key: "red-shirt", action: "create", data, liveData: null, transfer: {}, liveGid: null, refIndex });
    expect(missingRefs).toEqual(["metaobject:author/bob"]);
  });

  it("builds deletes from the live GID", () => {
    const { operations } = buildOperations({ type: "page", key: "about", action: "delete", data: null, liveData: null, transfer: null, liveGid: "gid://shopify/Page/3", refIndex });
    expect(operations).toEqual([expect.objectContaining({ root: "pageDelete", variables: { id: "gid://shopify/Page/3" } })]);
  });
});
