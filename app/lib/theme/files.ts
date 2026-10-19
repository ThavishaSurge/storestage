/**
 * Theme file classification and Shopify-flavoured JSON parsing.
 */
import type { JsonValue } from "../json";

export type ThemeFileKind = "json" | "text" | "binary";

const TEXT_EXTENSIONS = [
  ".liquid",
  ".css",
  ".scss",
  ".js",
  ".mjs",
  ".ts",
  ".svg",
  ".txt",
  ".md",
  ".html",
  ".xml",
  ".map",
];

/**
 * JSON files we merge structurally. Shopify writes theme editor changes into these:
 * templates/*.json, sections/*.json (section groups), config/settings_data.json, locales/*.json.
 */
export function classifyThemeFile(filename: string, contentType?: string): ThemeFileKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "text";
  if (contentType && /^(text\/|application\/(json|javascript|xml))/.test(contentType)) {
    return "text";
  }
  return "binary";
}

/** Theme editor-owned files are the ones clients usually change from the admin. */
export function isEditorManaged(filename: string): boolean {
  return (
    filename === "config/settings_data.json" ||
    /^templates\/.+\.json$/.test(filename) ||
    /^sections\/.+\.json$/.test(filename)
  );
}

export interface ParsedThemeJson {
  /** Leading block comment Shopify adds to generated JSON files, kept verbatim. */
  header: string;
  value: JsonValue;
}

const LEADING_COMMENT = /^\s*(\/\*[\s\S]*?\*\/\s*)+/;

export function parseThemeJson(source: string): ParsedThemeJson {
  const match = source.match(LEADING_COMMENT);
  const header = match ? match[0].trim() : "";
  const body = match ? source.slice(match[0].length) : source;
  const trimmed = body.trim();
  return { header, value: trimmed === "" ? {} : (JSON.parse(trimmed) as JsonValue) };
}

export function tryParseThemeJson(source: string): ParsedThemeJson | null {
  try {
    return parseThemeJson(source);
  } catch {
    return null;
  }
}

export function serializeThemeJson(parsed: ParsedThemeJson): string {
  const json = JSON.stringify(parsed.value, null, 2);
  return parsed.header ? `${parsed.header}\n${json}\n` : `${json}\n`;
}
