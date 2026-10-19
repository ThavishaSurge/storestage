/**
 * Admin GraphQL read documents (API 2026-10) and the raw shapes they return.
 * Validated against the schema by `npm run validate:graphql`.
 *
 * Page sizes are chosen to stay under the 1,000-point single-query cost limit.
 */

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}
export interface RawMetafield {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Shop & themes
// ---------------------------------------------------------------------------

export const SHOP_INFO = `#graphql
  query StoreStageShopInfo {
    shop {
      name
      myshopifyDomain
      currencyCode
      ianaTimezone
      primaryDomain { host }
    }
  }
`;

export interface RawTheme {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  processing: boolean;
}

export const THEMES = `#graphql
  query StoreStageThemes($first: Int!, $after: String) {
    themes(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id name role createdAt updatedAt processing }
    }
  }
`;

export const THEME = `#graphql
  query StoreStageTheme($id: ID!) {
    theme(id: $id) { id name role createdAt updatedAt processing }
  }
`;

export interface RawThemeFileMeta {
  filename: string;
  checksumMd5: string | null;
  size: string | number;
  contentType: string;
  updatedAt: string;
}

export const THEME_FILE_META = `#graphql
  query StoreStageThemeFileMeta($id: ID!, $first: Int!, $after: String) {
    theme(id: $id) {
      id
      files(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { filename checksumMd5 size contentType updatedAt }
      }
    }
  }
`;

export type RawThemeFileBody =
  | { __typename: "OnlineStoreThemeFileBodyText"; content: string }
  | { __typename: "OnlineStoreThemeFileBodyBase64"; contentBase64: string }
  | { __typename: "OnlineStoreThemeFileBodyUrl"; url: string };

export interface RawThemeFile extends RawThemeFileMeta {
  body: RawThemeFileBody;
}

export const THEME_FILE_BODIES = `#graphql
  query StoreStageThemeFileBodies($id: ID!, $filenames: [String!]!, $first: Int!) {
    theme(id: $id) {
      id
      files(filenames: $filenames, first: $first) {
        nodes {
          filename
          checksumMd5
          size
          contentType
          updatedAt
          body {
            __typename
            ... on OnlineStoreThemeFileBodyText { content }
            ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
            ... on OnlineStoreThemeFileBodyUrl { url }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Store resources
// ---------------------------------------------------------------------------

export interface RawProduct {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: string;
  templateSuffix: string | null;
  isGiftCard: boolean;
  requiresSellingPlan: boolean;
  category: { id: string } | null;
  seo: { title: string | null; description: string | null };
  options: { name: string; position: number; values: string[] }[];
  variants: {
    nodes: {
      id: string;
      sku: string | null;
      price: string;
      compareAtPrice: string | null;
      taxable: boolean;
      inventoryPolicy: string;
      position: number;
      selectedOptions: { name: string; value: string }[];
      barcode: string | null;
    }[];
    pageInfo?: PageInfo;
  };
  media: { nodes: RawMedia[] };
  metafields: { nodes: RawMetafield[] };
}

export interface RawMedia {
  id: string;
  alt: string | null;
  mediaContentType: string;
  image?: { url: string } | null;
  originalSource?: { url: string | null } | null;
  originUrl?: string;
}

export const PRODUCTS = `#graphql
  query StoreStageProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        descriptionHtml
        vendor
        productType
        tags
        status
        templateSuffix
        isGiftCard
        requiresSellingPlan
        category { id }
        seo { title description }
        options { name position values }
        variants(first: 50) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            sku
            price
            compareAtPrice
            taxable
            inventoryPolicy
            position
            selectedOptions { name value }
            barcode
          }
        }
        media(first: 30) {
          nodes {
            id
            alt
            mediaContentType
            ... on MediaImage { image { url } }
            ... on Video { originalSource { url } }
            ... on Model3d { originalSource { url } }
            ... on ExternalVideo { originUrl }
          }
        }
        metafields(first: 40) { nodes { namespace key type value } }
      }
    }
  }
`;

export const PRODUCT_VARIANTS = `#graphql
  query StoreStageProductVariants($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      variants(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          sku
          price
          compareAtPrice
          taxable
          inventoryPolicy
          position
          selectedOptions { name value }
          barcode
        }
      }
    }
  }
`;

export interface RawCollection {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  sortOrder: string;
  templateSuffix: string | null;
  seo: { title: string | null; description: string | null };
  image: { url: string; altText: string | null } | null;
  ruleSet: { appliedDisjunctively: boolean; rules: { column: string; relation: string; condition: string }[] } | null;
  products: { nodes: { id: string }[] };
  metafields: { nodes: RawMetafield[] };
}

export const COLLECTIONS = `#graphql
  query StoreStageCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        descriptionHtml
        sortOrder
        templateSuffix
        seo { title description }
        image { url altText }
        ruleSet { appliedDisjunctively rules { column relation condition } }
        products(first: 250) { nodes { id } }
        metafields(first: 40) { nodes { namespace key type value } }
      }
    }
  }
`;

export interface RawPage {
  id: string;
  handle: string;
  title: string;
  body: string;
  isPublished: boolean;
  templateSuffix: string | null;
  metafields: { nodes: RawMetafield[] };
}

export const PAGES = `#graphql
  query StoreStagePages($first: Int!, $after: String) {
    pages(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title body isPublished templateSuffix
        metafields(first: 20) { nodes { namespace key type value } }
      }
    }
  }
`;

export interface RawBlog {
  id: string;
  handle: string;
  title: string;
  commentPolicy: string;
  templateSuffix: string | null;
  metafields: { nodes: RawMetafield[] };
}

export const BLOGS = `#graphql
  query StoreStageBlogs($first: Int!, $after: String) {
    blogs(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title commentPolicy templateSuffix
        metafields(first: 20) { nodes { namespace key type value } }
      }
    }
  }
`;

export interface RawArticle {
  id: string;
  handle: string;
  title: string;
  body: string;
  summary: string | null;
  tags: string[];
  isPublished: boolean;
  templateSuffix: string | null;
  author: { name: string } | null;
  blog: { id: string; handle: string };
  image: { url: string; altText: string | null } | null;
  metafields: { nodes: RawMetafield[] };
}

export const ARTICLES = `#graphql
  query StoreStageArticles($first: Int!, $after: String) {
    articles(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title body summary tags isPublished templateSuffix
        author { name }
        blog { id handle }
        image { url altText }
        metafields(first: 20) { nodes { namespace key type value } }
      }
    }
  }
`;

export interface RawMenuItem {
  title: string;
  type: string;
  url: string | null;
  resourceId: string | null;
  tags: string[];
  items?: RawMenuItem[];
}

export interface RawMenu {
  id: string;
  handle: string;
  title: string;
  isDefault: boolean;
  items: RawMenuItem[];
}

export const MENUS = `#graphql
  query StoreStageMenus($first: Int!, $after: String) {
    menus(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title isDefault
        items {
          title type url resourceId tags
          items {
            title type url resourceId tags
            items { title type url resourceId tags }
          }
        }
      }
    }
  }
`;

export interface RawUrlRedirect {
  id: string;
  path: string;
  target: string;
}

export const URL_REDIRECTS = `#graphql
  query StoreStageUrlRedirects($first: Int!, $after: String) {
    urlRedirects(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id path target }
    }
  }
`;

export interface RawMetafieldDefinition {
  id: string;
  namespace: string;
  key: string;
  name: string;
  description: string | null;
  ownerType: string;
  pinnedPosition: number | null;
  type: { name: string };
  validations: { name: string; value: string | null }[];
}

/** Owner types we sync definitions for (the ones whose resources we also sync). */
export const SYNCED_OWNER_TYPES = ["PRODUCT", "PRODUCTVARIANT", "COLLECTION", "PAGE", "BLOG", "ARTICLE", "SHOP"] as const;

export const METAFIELD_DEFINITIONS = `#graphql
  query StoreStageMetafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!, $after: String) {
    metafieldDefinitions(ownerType: $ownerType, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id namespace key name description ownerType pinnedPosition
        type { name }
        validations { name value }
      }
    }
  }
`;

export interface RawMetaobjectDefinition {
  id: string;
  type: string;
  name: string;
  description: string | null;
  displayNameKey: string | null;
  capabilities: {
    publishable: { enabled: boolean };
    translatable: { enabled: boolean };
    renderable: { enabled: boolean } | null;
    onlineStore: { enabled: boolean; data: { urlHandle: string } | null } | null;
  };
  fieldDefinitions: {
    key: string;
    name: string;
    description: string | null;
    required: boolean;
    type: { name: string };
    validations: { name: string; value: string | null }[];
  }[];
}

export const METAOBJECT_DEFINITIONS = `#graphql
  query StoreStageMetaobjectDefinitions($first: Int!, $after: String) {
    metaobjectDefinitions(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id type name description displayNameKey
        capabilities {
          publishable { enabled }
          translatable { enabled }
          renderable { enabled }
          onlineStore { enabled data { urlHandle } }
        }
        fieldDefinitions {
          key name description required
          type { name }
          validations { name value }
        }
      }
    }
  }
`;

export interface RawMetaobject {
  id: string;
  handle: string;
  type: string;
  displayName: string;
  fields: { key: string; value: string | null; type: string }[];
  capabilities: {
    publishable: { status: string } | null;
    onlineStore: { templateSuffix: string | null } | null;
  };
}

export const METAOBJECTS = `#graphql
  query StoreStageMetaobjects($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle type displayName
        fields { key value type }
        capabilities {
          publishable { status }
          onlineStore { templateSuffix }
        }
      }
    }
  }
`;

export interface RawFile {
  __typename: string;
  id: string;
  alt: string | null;
  fileStatus: string;
  image?: { url: string } | null;
  url?: string | null;
  mimeType?: string | null;
  originalSource?: { url: string | null } | null;
}

export const FILES = `#graphql
  query StoreStageFiles($first: Int!, $after: String) {
    files(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        id
        alt
        fileStatus
        ... on MediaImage { image { url } mimeType }
        ... on GenericFile { url mimeType }
        ... on Video { originalSource { url } }
      }
    }
  }
`;

export const ONLINE_STORE_PUBLICATION = `#graphql
  query StoreStagePublications {
    publications(first: 50) {
      nodes { id catalog { title } }
    }
  }
`;

export const BULK_OPERATION_STATUS = `#graphql
  query StoreStageJob($id: ID!) {
    job(id: $id) { id done }
  }
`;

// ---------------------------------------------------------------------------
// Light "index" queries: id + natural key only. Used to resolve references to resource
// types that aren't being synced (e.g. a menu pointing at products).
// ---------------------------------------------------------------------------

export const PRODUCT_INDEX = `#graphql
  query StoreStageProductIndex($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id handle title }
    }
  }
`;

export const COLLECTION_INDEX = `#graphql
  query StoreStageCollectionIndex($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id handle title }
    }
  }
`;

export const PAGE_INDEX = `#graphql
  query StoreStagePageIndex($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id handle title }
    }
  }
`;

export const BLOG_INDEX = `#graphql
  query StoreStageBlogIndex($first: Int!, $after: String) {
    blogs(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id handle title }
    }
  }
`;

export const ARTICLE_INDEX = `#graphql
  query StoreStageArticleIndex($first: Int!, $after: String) {
    articles(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id handle title blog { handle } }
    }
  }
`;

export const METAOBJECT_INDEX = `#graphql
  query StoreStageMetaobjectIndex($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id handle type displayName }
    }
  }
`;

export const METAOBJECT_TYPES = `#graphql
  query StoreStageMetaobjectTypes($first: Int!, $after: String) {
    metaobjectDefinitions(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id type name }
    }
  }
`;

// ---------------------------------------------------------------------------
// Store settings (read-only comparison; most of these can't be written through the API)
// ---------------------------------------------------------------------------

export interface RawShopSettings {
  name: string;
  contactEmail: string;
  description: string | null;
  currencyCode: string;
  enabledPresentmentCurrencies: string[];
  currencyFormats: { moneyFormat: string; moneyWithCurrencyFormat: string };
  ianaTimezone: string;
  weightUnit: string;
  unitSystem: string;
  taxesIncluded: boolean;
  taxShipping: boolean;
  orderNumberFormatPrefix: string;
  orderNumberFormatSuffix: string;
  shipsToCountries: string[];
  marketingSmsConsentEnabledAtCheckout: boolean;
  shopPolicies: { type: string; title: string; body: string }[];
}

export const SHOP_SETTINGS = `#graphql
  query StoreStageShopSettings {
    shop {
      name
      contactEmail
      description
      currencyCode
      enabledPresentmentCurrencies
      currencyFormats { moneyFormat moneyWithCurrencyFormat }
      ianaTimezone
      weightUnit
      unitSystem
      taxesIncluded
      taxShipping
      orderNumberFormatPrefix
      orderNumberFormatSuffix
      shipsToCountries
      marketingSmsConsentEnabledAtCheckout
      shopPolicies { type title body }
    }
  }
`;
