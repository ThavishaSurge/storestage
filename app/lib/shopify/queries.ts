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
export interface RawTheme {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  processing: boolean;
}

export const THEMES = `#graphql
  query ThemeMergeThemes($first: Int!, $after: String) {
    themes(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id name role createdAt updatedAt processing }
    }
  }
`;

export const THEME = `#graphql
  query ThemeMergeTheme($id: ID!) {
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
  query ThemeMergeThemeFileMeta($id: ID!, $first: Int!, $after: String) {
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
  query ThemeMergeThemeFileBodies($id: ID!, $filenames: [String!]!, $first: Int!) {
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

export interface RawAppSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
}

export const APP_SUBSCRIPTIONS = `#graphql
  query ThemeMergeAppSubscriptions {
    currentAppInstallation {
      id
      activeSubscriptions { id name status test trialDays currentPeriodEnd }
    }
  }
`;
