/**
 * Admin GraphQL write documents (API 2026-10).
 * Every payload selects `userErrors { field message }` so the executor can report failures uniformly.
 */

// ---------------------------------------------------------------------------
// Themes (writes need Shopify's theme-write exemption)
// ---------------------------------------------------------------------------

export const THEME_DUPLICATE = `#graphql
  mutation ThemeMergeThemeDuplicate($id: ID!, $name: String) {
    themeDuplicate(id: $id, name: $name) {
      newTheme { id name role createdAt updatedAt processing }
      userErrors { field message }
    }
  }
`;

export const THEME_FILES_UPSERT = `#graphql
  mutation ThemeMergeThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      job { id done }
      upsertedThemeFiles { filename checksumMd5 }
      userErrors { field message filename code }
    }
  }
`;

export const THEME_FILES_DELETE = `#graphql
  mutation ThemeMergeThemeFilesDelete($themeId: ID!, $files: [String!]!) {
    themeFilesDelete(themeId: $themeId, files: $files) {
      deletedThemeFiles { filename }
      userErrors { field message filename code }
    }
  }
`;
