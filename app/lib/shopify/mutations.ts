/**
 * Admin GraphQL write documents (API 2026-10).
 * Every payload selects `userErrors { field message }` so the executor can report failures uniformly.
 */

// ---------------------------------------------------------------------------
// Themes (writes need Shopify's theme-write exemption)
// ---------------------------------------------------------------------------

export const THEME_DUPLICATE = `#graphql
  mutation StoreStageThemeDuplicate($id: ID!, $name: String) {
    themeDuplicate(id: $id, name: $name) {
      newTheme { id name role createdAt updatedAt processing }
      userErrors { field message }
    }
  }
`;

export const THEME_FILES_UPSERT = `#graphql
  mutation StoreStageThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      job { id done }
      upsertedThemeFiles { filename checksumMd5 }
      userErrors { field message filename code }
    }
  }
`;

export const THEME_FILES_DELETE = `#graphql
  mutation StoreStageThemeFilesDelete($themeId: ID!, $files: [String!]!) {
    themeFilesDelete(themeId: $themeId, files: $files) {
      deletedThemeFiles { filename }
      userErrors { field message filename code }
    }
  }
`;

// ---------------------------------------------------------------------------
// Products & collections
// ---------------------------------------------------------------------------

export const PRODUCT_SET = `#graphql
  mutation StoreStageProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
    productSet(input: $input, identifier: $identifier, synchronous: true) {
      product { id handle }
      userErrors { field message code }
    }
  }
`;

export const PRODUCT_DELETE = `#graphql
  mutation StoreStageProductDelete($id: ID!) {
    productDelete(input: { id: $id }, synchronous: true) {
      deletedProductId
      userErrors { field message }
    }
  }
`;

export const COLLECTION_CREATE = `#graphql
  mutation StoreStageCollectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id handle }
      userErrors { field message }
    }
  }
`;

export const COLLECTION_UPDATE = `#graphql
  mutation StoreStageCollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id handle }
      userErrors { field message }
    }
  }
`;

export const COLLECTION_ADD_PRODUCTS = `#graphql
  mutation StoreStageCollectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection { id }
      userErrors { field message }
    }
  }
`;

export const COLLECTION_REMOVE_PRODUCTS = `#graphql
  mutation StoreStageCollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
    collectionRemoveProducts(id: $id, productIds: $productIds) {
      job { id done }
      userErrors { field message }
    }
  }
`;

export const COLLECTION_DELETE = `#graphql
  mutation StoreStageCollectionDelete($id: ID!) {
    collectionDelete(input: { id: $id }) {
      deletedCollectionId
      userErrors { field message }
    }
  }
`;

export const PUBLISHABLE_PUBLISH = `#graphql
  mutation StoreStagePublish($id: ID!, $publicationId: ID!) {
    publishablePublish(id: $id, input: [{ publicationId: $publicationId }]) {
      userErrors { field message }
    }
  }
`;

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const PAGE_CREATE = `#graphql
  mutation StoreStagePageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page { id handle }
      userErrors { field message }
    }
  }
`;

export const PAGE_UPDATE = `#graphql
  mutation StoreStagePageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page { id handle }
      userErrors { field message }
    }
  }
`;

export const PAGE_DELETE = `#graphql
  mutation StoreStagePageDelete($id: ID!) {
    pageDelete(id: $id) {
      deletedPageId
      userErrors { field message }
    }
  }
`;

export const BLOG_CREATE = `#graphql
  mutation StoreStageBlogCreate($blog: BlogCreateInput!) {
    blogCreate(blog: $blog) {
      blog { id handle }
      userErrors { field message }
    }
  }
`;

export const BLOG_UPDATE = `#graphql
  mutation StoreStageBlogUpdate($id: ID!, $blog: BlogUpdateInput!) {
    blogUpdate(id: $id, blog: $blog) {
      blog { id handle }
      userErrors { field message }
    }
  }
`;

export const BLOG_DELETE = `#graphql
  mutation StoreStageBlogDelete($id: ID!) {
    blogDelete(id: $id) {
      deletedBlogId
      userErrors { field message }
    }
  }
`;

export const ARTICLE_CREATE = `#graphql
  mutation StoreStageArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article { id handle }
      userErrors { field message }
    }
  }
`;

export const ARTICLE_UPDATE = `#graphql
  mutation StoreStageArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id handle }
      userErrors { field message }
    }
  }
`;

export const ARTICLE_DELETE = `#graphql
  mutation StoreStageArticleDelete($id: ID!) {
    articleDelete(id: $id) {
      deletedArticleId
      userErrors { field message }
    }
  }
`;

export const MENU_CREATE = `#graphql
  mutation StoreStageMenuCreate($handle: String!, $title: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(handle: $handle, title: $title, items: $items) {
      menu { id handle }
      userErrors { field message }
    }
  }
`;

export const MENU_UPDATE = `#graphql
  mutation StoreStageMenuUpdate($id: ID!, $handle: String, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, handle: $handle, title: $title, items: $items) {
      menu { id handle }
      userErrors { field message }
    }
  }
`;

export const MENU_DELETE = `#graphql
  mutation StoreStageMenuDelete($id: ID!) {
    menuDelete(id: $id) {
      deletedMenuId
      userErrors { field message }
    }
  }
`;

export const URL_REDIRECT_CREATE = `#graphql
  mutation StoreStageUrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect { id path }
      userErrors { field message }
    }
  }
`;

export const URL_REDIRECT_UPDATE = `#graphql
  mutation StoreStageUrlRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) {
    urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
      urlRedirect { id path }
      userErrors { field message }
    }
  }
`;

export const URL_REDIRECT_DELETE = `#graphql
  mutation StoreStageUrlRedirectDelete($id: ID!) {
    urlRedirectDelete(id: $id) {
      deletedUrlRedirectId
      userErrors { field message }
    }
  }
`;

// ---------------------------------------------------------------------------
// Custom data & files
// ---------------------------------------------------------------------------

export const METAFIELD_DEFINITION_CREATE = `#graphql
  mutation StoreStageMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

export const METAFIELD_DEFINITION_UPDATE = `#graphql
  mutation StoreStageMetafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition { id }
      userErrors { field message code }
    }
  }
`;

export const METAFIELD_DEFINITION_DELETE = `#graphql
  mutation StoreStageMetafieldDefinitionDelete($id: ID!) {
    metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: false) {
      deletedDefinitionId
      userErrors { field message code }
    }
  }
`;

export const METAOBJECT_DEFINITION_CREATE = `#graphql
  mutation StoreStageMetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message code }
    }
  }
`;

export const METAOBJECT_DEFINITION_UPDATE = `#graphql
  mutation StoreStageMetaobjectDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message code }
    }
  }
`;

export const METAOBJECT_DEFINITION_DELETE = `#graphql
  mutation StoreStageMetaobjectDefinitionDelete($id: ID!) {
    metaobjectDefinitionDelete(id: $id) {
      deletedId
      userErrors { field message code }
    }
  }
`;

export const METAOBJECT_UPSERT = `#graphql
  mutation StoreStageMetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }
`;

export const METAOBJECT_DELETE = `#graphql
  mutation StoreStageMetaobjectDelete($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors { field message code }
    }
  }
`;

export const METAFIELDS_DELETE = `#graphql
  mutation StoreStageMetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key namespace ownerId }
      userErrors { field message }
    }
  }
`;

export const FILE_CREATE = `#graphql
  mutation StoreStageFileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus }
      userErrors { field message code }
    }
  }
`;

export const FILE_UPDATE = `#graphql
  mutation StoreStageFileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { id }
      userErrors { field message code }
    }
  }
`;

export const FILE_DELETE = `#graphql
  mutation StoreStageFileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors { field message code }
    }
  }
`;
