/**
 * In-memory fake of the Shopify Admin GraphQL API, scoped to the operations ThemeMerge uses.
 * Responses mirror the shapes of the real API.
 */
import type { RawTheme } from "../../app/lib/shopify/queries";

type Vars = Record<string, unknown>;

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
  /** Every mutation name called, for assertions. */
  log: string[] = [];
  /** Active app subscriptions — what the billing service reads to decide the plan. */
  subscriptions: { id: string; name: string; status: string; test: boolean; trialDays: number; currentPeriodEnd: string | null }[] = [];
  private readonly installationId: string;

  constructor(
    public readonly shop: string,
    seqStart: number,
  ) {
    this.seq = seqStart;
    this.installationId = this.gid("AppInstallation");
  }

  /** Puts the store on the paid plan. */
  subscribePro() {
    this.subscriptions = [{ id: this.gid("AppSubscription"), name: "ThemeMerge Pro", status: "ACTIVE", test: true, trialDays: 0, currentPeriodEnd: null }];
  }

  gid(type: string) {
    return `gid://shopify/${type}/${this.seq++}`;
  }

  now(advanceMs = 60_000) {
    this.clock += advanceMs;
    return new Date(this.clock).toISOString();
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

  op_ThemeMergeAppSubscriptions() {
    return { currentAppInstallation: { id: this.installationId, activeSubscriptions: this.subscriptions } };
  }

  op_ThemeMergeThemes() {
    return { themes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: this.themes } };
  }
  op_ThemeMergeTheme(v: Vars) {
    return { theme: this.themes.find((t) => t.id === v.id) ?? null };
  }
  op_ThemeMergeThemeFileMeta(v: Vars) {
    const files = [...(this.themeFiles.get(String(v.id))?.values() ?? [])].sort((a, b) => a.filename.localeCompare(b.filename));
    return { theme: { id: v.id, files: page(files.map((f) => this.themeFileMeta(f)), Number(v.first), v.after as string) } };
  }
  op_ThemeMergeThemeFileBodies(v: Vars) {
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
  op_ThemeMergeThemeDuplicate(v: Vars) {
    const source = this.themes.find((t) => t.id === v.id)!;
    const files = this.themeFiles.get(source.id)!;
    const copy = this.addTheme(String(v.name ?? `Copy of ${source.name}`), "UNPUBLISHED", {});
    const map = this.themeFiles.get(copy.id)!;
    for (const f of files.values()) map.set(f.filename, { ...f }); // duplicates keep file timestamps
    return { themeDuplicate: { newTheme: copy, ...noErrors } };
  }
  op_ThemeMergeThemeFilesUpsert(v: Vars) {
    for (const f of v.files as { filename: string; body: { type: string; value: string } }[]) this.writeThemeFile(String(v.themeId), f.filename, f.body.value);
    return { themeFilesUpsert: { job: null, upsertedThemeFiles: [], ...noErrors } };
  }
  op_ThemeMergeThemeFilesDelete(v: Vars) {
    const files = this.themeFiles.get(String(v.themeId))!;
    for (const name of v.files as string[]) files.delete(name);
    return { themeFilesDelete: { deletedThemeFiles: [], ...noErrors } };
  }
}
