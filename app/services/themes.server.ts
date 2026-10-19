/**
 * Theme reads/writes and theme snapshots.
 */
import db from "../db.server";
import { classifyThemeFile } from "../lib/theme/files";
import type { ThemeFileMeta } from "../lib/theme/compare";
import {
  THEME,
  THEME_FILE_BODIES,
  THEME_FILE_META,
  THEMES,
  type PageInfo,
  type RawTheme,
  type RawThemeFile,
  type RawThemeFileMeta,
} from "../lib/shopify/queries";
import { THEME_DUPLICATE, THEME_FILES_DELETE, THEME_FILES_UPSERT } from "../lib/shopify/mutations";
import { assertNoUserErrors, gql, paginate, ShopifyUserError, type AdminClient } from "./admin.server";
import { themeWritesEnabled } from "./flags.server";

export type { RawTheme };

/**
 * Every theme in the store, published first and then most recently updated first — the themes
 * you are most likely to be comparing. Paginated: a store can hold more themes than one page,
 * and a truncated list silently hides the theme you wanted.
 */
export async function listThemes(admin: AdminClient): Promise<RawTheme[]> {
  const nodes = await paginate<RawTheme, { themes: { pageInfo: PageInfo; nodes: RawTheme[] } | null }>(
    admin,
    THEMES,
    { first: 250 },
    (data) => data.themes,
  );
  return nodes.sort(
    (a, b) =>
      Number(b.role === "MAIN") - Number(a.role === "MAIN") ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      a.name.localeCompare(b.name),
  );
}

export async function getTheme(admin: AdminClient, id: string): Promise<RawTheme | null> {
  const data = await gql<{ theme: RawTheme | null }>(admin, THEME, { id });
  return data.theme;
}

export function toMeta(f: RawThemeFileMeta): ThemeFileMeta {
  return {
    filename: f.filename,
    checksum: f.checksumMd5,
    size: Number(f.size),
    contentType: f.contentType,
    updatedAt: f.updatedAt,
  };
}

export async function fetchThemeFileMeta(admin: AdminClient, themeId: string): Promise<Map<string, ThemeFileMeta>> {
  const nodes = await paginate<RawThemeFileMeta, { theme: { files: { pageInfo: PageInfo; nodes: RawThemeFileMeta[] } | null } | null }>(
    admin,
    THEME_FILE_META,
    { id: themeId, first: 250 },
    (data) => data.theme?.files,
  );
  return new Map(nodes.map((n) => [n.filename, toMeta(n)]));
}

export interface ThemeFileBody {
  filename: string;
  encoding: "text" | "base64";
  body: string;
  meta: ThemeFileMeta;
}

async function resolveBody(file: RawThemeFile): Promise<ThemeFileBody> {
  const meta = toMeta(file);
  const kind = classifyThemeFile(file.filename, file.contentType);
  switch (file.body.__typename) {
    case "OnlineStoreThemeFileBodyText":
      return { filename: file.filename, encoding: "text", body: file.body.content, meta };
    case "OnlineStoreThemeFileBodyBase64":
      if (kind !== "binary") {
        return { filename: file.filename, encoding: "text", body: Buffer.from(file.body.contentBase64, "base64").toString("utf8"), meta };
      }
      return { filename: file.filename, encoding: "base64", body: file.body.contentBase64, meta };
    case "OnlineStoreThemeFileBodyUrl": {
      const response = await fetch(file.body.url);
      if (!response.ok) throw new Error(`Couldn't download ${file.filename} (${response.status})`);
      const buffer = Buffer.from(await response.arrayBuffer());
      return kind === "binary"
        ? { filename: file.filename, encoding: "base64", body: buffer.toString("base64"), meta }
        : { filename: file.filename, encoding: "text", body: buffer.toString("utf8"), meta };
    }
  }
}

/** Fetches file bodies in batches. Filenames that don't exist are simply absent from the result. */
export async function fetchThemeFileBodies(
  admin: AdminClient,
  themeId: string,
  filenames: string[],
  onProgress?: (done: number) => void | Promise<void>,
): Promise<Map<string, ThemeFileBody>> {
  const out = new Map<string, ThemeFileBody>();
  const BATCH = 20;
  for (let i = 0; i < filenames.length; i += BATCH) {
    const batch = filenames.slice(i, i + BATCH);
    const data = await gql<{ theme: { files: { nodes: RawThemeFile[] } | null } | null }>(admin, THEME_FILE_BODIES, {
      id: themeId,
      filenames: batch,
      first: batch.length,
    });
    for (const file of data.theme?.files?.nodes ?? []) out.set(file.filename, await resolveBody(file));
    if (onProgress) await onProgress(Math.min(i + BATCH, filenames.length));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * Captures a theme: metadata for every file plus bodies of text files (binary assets are
 * compared by checksum, so only their metadata is stored).
 */
export async function snapshotTheme(args: {
  admin: AdminClient;
  shop: string;
  theme: Pick<RawTheme, "id" | "name">;
  reason: "manual" | "working-copy" | "pre-apply" | "store-baseline";
  label?: string;
  onProgress?: (fraction: number) => void | Promise<void>;
}): Promise<string> {
  const { admin, shop, theme, reason, label, onProgress } = args;
  const meta = await fetchThemeFileMeta(admin, theme.id);
  const textFiles = [...meta.values()].filter((m) => classifyThemeFile(m.filename, m.contentType) !== "binary").map((m) => m.filename);
  const bodies = await fetchThemeFileBodies(admin, theme.id, textFiles, (done) => onProgress?.(done / Math.max(textFiles.length, 1)));

  const snapshot = await db.themeSnapshot.create({
    data: { shop, themeId: theme.id, themeName: theme.name, reason, label: label ?? null },
  });
  const rows = [...meta.values()].map((m) => {
    const b = bodies.get(m.filename);
    return {
      snapshotId: snapshot.id,
      filename: m.filename,
      checksum: m.checksum,
      size: m.size,
      contentType: m.contentType,
      updatedAt: new Date(m.updatedAt),
      encoding: b ? b.encoding : "none",
      body: b ? b.body : null,
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    await db.themeSnapshotFile.createMany({ data: rows.slice(i, i + 200) });
  }
  return snapshot.id;
}

export async function loadSnapshotMeta(snapshotId: string): Promise<Map<string, ThemeFileMeta>> {
  const files = await db.themeSnapshotFile.findMany({
    where: { snapshotId },
    select: { filename: true, checksum: true, size: true, contentType: true, updatedAt: true },
  });
  return new Map(
    files.map((f) => [f.filename, { filename: f.filename, checksum: f.checksum, size: f.size, contentType: f.contentType, updatedAt: f.updatedAt.toISOString() }]),
  );
}

export async function loadSnapshotBodies(snapshotId: string, filenames: string[]): Promise<Map<string, string>> {
  const files = await db.themeSnapshotFile.findMany({
    where: { snapshotId, filename: { in: filenames }, encoding: "text" },
    select: { filename: true, body: true },
  });
  return new Map(files.filter((f) => f.body !== null).map((f) => [f.filename, f.body as string]));
}

// ---------------------------------------------------------------------------
// Writes (gated: need the theme-write exemption)
// ---------------------------------------------------------------------------

export class ThemeWritesDisabledError extends Error {
  constructor() {
    super(
      "Theme writes are turned off. Set THEME_WRITES_ENABLED=true once Shopify has granted the theme-write exemption, or download the merged files and push them with Shopify CLI.",
    );
    this.name = "ThemeWritesDisabledError";
  }
}

function requireWrites() {
  if (!themeWritesEnabled()) throw new ThemeWritesDisabledError();
}

/** A Shopify theme library holds 20 themes; development themes don't count towards it. */
export const THEME_LIBRARY_LIMIT = 20;

export class ThemeLimitError extends Error {
  constructor(count: number) {
    super(
      `This store's theme library is full (${count} of ${THEME_LIBRARY_LIMIT} themes). Delete an old theme in Online Store \u2192 Themes, then run this again \u2014 nothing has been written yet.`,
    );
    this.name = "ThemeLimitError";
  }
}

export async function duplicateTheme(admin: AdminClient, themeId: string, name: string): Promise<RawTheme> {
  requireWrites();
  // Checked up front so a full library fails before anything is written, and the merge can simply
  // be re-run once a theme is deleted.
  const inLibrary = (await listThemes(admin)).filter((t) => t.role !== "DEVELOPMENT").length;
  if (inLibrary >= THEME_LIBRARY_LIMIT) throw new ThemeLimitError(inLibrary);

  const data = await gql<{ themeDuplicate: { newTheme: RawTheme | null; userErrors: { field: string[] | null; message: string }[] } }>(
    admin,
    THEME_DUPLICATE,
    { id: themeId, name },
  );
  try {
    assertNoUserErrors(data.themeDuplicate, "Duplicating theme");
  } catch (error) {
    // Backstop: the limit isn't a typed error code, and it differs on some plans.
    if (error instanceof ShopifyUserError && /\b(limit|maximum|too many)\b/i.test(error.message)) throw new ThemeLimitError(inLibrary);
    throw error;
  }
  if (!data.themeDuplicate.newTheme) throw new Error("Shopify didn't return the duplicated theme");
  return data.themeDuplicate.newTheme;
}

export async function upsertThemeFiles(
  admin: AdminClient,
  themeId: string,
  files: { filename: string; body: string; encoding: "text" | "base64" }[],
  onProgress?: (done: number) => void | Promise<void>,
): Promise<void> {
  requireWrites();
  const BATCH = 50; // API maximum per request
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const data = await gql<{ themeFilesUpsert: { userErrors: { field: string[] | null; message: string; filename?: string }[] } }>(
      admin,
      THEME_FILES_UPSERT,
      {
        themeId,
        files: batch.map((f) => ({ filename: f.filename, body: { type: f.encoding === "base64" ? "BASE64" : "TEXT", value: f.body } })),
      },
    );
    assertNoUserErrors(data.themeFilesUpsert, "Writing theme files");
    if (onProgress) await onProgress(Math.min(i + BATCH, files.length));
  }
}

export async function deleteThemeFiles(admin: AdminClient, themeId: string, filenames: string[]): Promise<void> {
  requireWrites();
  for (let i = 0; i < filenames.length; i += 50) {
    const data = await gql<{ themeFilesDelete: { userErrors: { field: string[] | null; message: string }[] } }>(admin, THEME_FILES_DELETE, {
      themeId,
      files: filenames.slice(i, i + 50),
    });
    assertNoUserErrors(data.themeFilesDelete, "Deleting theme files");
  }
}
