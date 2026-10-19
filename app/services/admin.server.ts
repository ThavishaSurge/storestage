/**
 * Thin, typed wrapper around the Admin GraphQL client.
 *
 * - Works with both `admin` from authenticate.admin(request) and unauthenticated.admin(shop)
 *   (used by background jobs and for the paired store).
 * - Retries throttled requests with backoff and proactively waits when the bucket runs low.
 * - Turns userErrors and ACCESS_DENIED into typed exceptions the UI can explain.
 */
import { unauthenticated } from "../shopify.server";

export interface AdminClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export class ShopifyAccessError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ShopifyAccessError";
  }
}

export class ShopifyUserError extends Error {
  constructor(
    message: string,
    public readonly userErrors: { field?: string[] | null; message: string }[],
  ) {
    super(message);
    this.name = "ShopifyUserError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface GraphQLErrorShape {
  message: string;
  extensions?: { code?: string };
}

interface CostExtension {
  cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number } };
}

function isThrottle(errors: GraphQLErrorShape[] | undefined) {
  return Boolean(errors?.some((e) => e.extensions?.code === "THROTTLED"));
}

function extractErrors(error: unknown): GraphQLErrorShape[] | undefined {
  // @shopify/shopify-api throws GraphqlQueryError with `body.errors` / `response`.
  const e = error as { body?: { errors?: unknown }; errors?: unknown };
  const raw = e?.body?.errors ?? e?.errors;
  if (Array.isArray(raw)) return raw as GraphQLErrorShape[];
  const graphQLErrors = (raw as { graphQLErrors?: unknown })?.graphQLErrors;
  return Array.isArray(graphQLErrors) ? (graphQLErrors as GraphQLErrorShape[]) : undefined;
}

export async function gql<T>(
  admin: AdminClient,
  query: string,
  variables: Record<string, unknown> = {},
  attempt = 0,
): Promise<T> {
  let json: { data?: T; errors?: GraphQLErrorShape[]; extensions?: CostExtension };
  try {
    const response = await admin.graphql(query, { variables });
    json = await response.json();
  } catch (error) {
    const errors = extractErrors(error);
    const throttled = isThrottle(errors) || /throttl/i.test(String((error as Error)?.message ?? ""));
    if (throttled && attempt < 6) {
      await sleep(1000 * 2 ** attempt);
      return gql<T>(admin, query, variables, attempt + 1);
    }
    throwForErrors(errors, error);
    throw error;
  }

  if (json.errors?.length) {
    if (isThrottle(json.errors) && attempt < 6) {
      await sleep(1000 * 2 ** attempt);
      return gql<T>(admin, query, variables, attempt + 1);
    }
    throwForErrors(json.errors);
  }

  // Be a good citizen: if the leaky bucket is nearly empty, wait for it to refill a bit.
  const status = json.extensions?.cost?.throttleStatus;
  if (status && status.currentlyAvailable < 200) {
    await sleep(Math.ceil(((200 - status.currentlyAvailable) / Math.max(status.restoreRate, 1)) * 1000));
  }

  return json.data as T;
}

function throwForErrors(errors: GraphQLErrorShape[] | undefined, original?: unknown): void {
  if (!errors?.length) {
    if (original) throw original;
    return;
  }
  const denied = errors.find(
    (e) => e.extensions?.code === "ACCESS_DENIED" || /access denied|exemption|required access/i.test(e.message),
  );
  if (denied) throw new ShopifyAccessError(denied.message);
  throw new Error(errors.map((e) => e.message).join("; "));
}

/** Throws if a mutation payload returned userErrors. */
export function assertNoUserErrors(
  payload: { userErrors?: { field?: string[] | null; message: string }[] } | null | undefined,
  context: string,
) {
  const errors = payload?.userErrors ?? [];
  if (errors.length) {
    throw new ShopifyUserError(
      `${context}: ${errors.map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message)).join("; ")}`,
      errors,
    );
  }
}

/** Generic cursor pagination over a connection returned at `select(data)`. */
export async function paginate<TNode, TData>(
  admin: AdminClient,
  query: string,
  variables: Record<string, unknown>,
  select: (data: TData) => { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: TNode[] } | null | undefined,
  onPage?: (count: number) => void | Promise<void>,
): Promise<TNode[]> {
  const out: TNode[] = [];
  let after: string | null = null;
  for (;;) {
    const data: TData = await gql<TData>(admin, query, { ...variables, after });
    const connection = select(data);
    if (!connection) break;
    out.push(...connection.nodes);
    if (onPage) await onPage(out.length);
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  return out;
}

/** Admin client for a shop using its stored offline session (background jobs, paired store). */
export async function adminForShop(shop: string): Promise<AdminClient> {
  const { admin } = await unauthenticated.admin(shop);
  return admin as unknown as AdminClient;
}

export function describeError(error: unknown): string {
  if (error instanceof ShopifyAccessError) {
    return `${error.message} — theme writes require Shopify's Online Store protected-scope exemption (see README).`;
  }
  return error instanceof Error ? error.message : String(error);
}
