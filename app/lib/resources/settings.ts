/**
 * Read-only comparison of store-level settings between staging and live.
 * Most of these aren't writable through the Admin API, so differences are reported for a human to fix.
 */
import type { RawShopSettings } from "../shopify/queries";

export interface SettingDiff {
  key: string;
  label: string;
  staging: string;
  live: string;
}

const LABELS: [keyof RawShopSettings | string, string][] = [
  ["currencyCode", "Store currency"],
  ["enabledPresentmentCurrencies", "Enabled currencies"],
  ["currencyFormats.moneyFormat", "Money format"],
  ["currencyFormats.moneyWithCurrencyFormat", "Money format with currency"],
  ["ianaTimezone", "Time zone"],
  ["weightUnit", "Weight unit"],
  ["unitSystem", "Unit system"],
  ["taxesIncluded", "Prices include tax"],
  ["taxShipping", "Charge tax on shipping"],
  ["orderNumberFormatPrefix", "Order number prefix"],
  ["orderNumberFormatSuffix", "Order number suffix"],
  ["shipsToCountries", "Ships to countries"],
  ["marketingSmsConsentEnabledAtCheckout", "SMS marketing consent at checkout"],
  ["contactEmail", "Contact email"],
  ["description", "Store description (SEO)"],
];

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length > 12 ? `${value.slice(0, 12).join(", ")} (+${value.length - 12} more)` : value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function get(settings: RawShopSettings, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], settings);
}

function normalize(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? [...value].sort() : value ?? null);
}

export function diffSettings(staging: RawShopSettings, live: RawShopSettings): SettingDiff[] {
  const out: SettingDiff[] = [];
  for (const [path, label] of LABELS) {
    const s = get(staging, path);
    const l = get(live, path);
    if (normalize(s) !== normalize(l)) out.push({ key: path, label, staging: display(s), live: display(l) });
  }
  const types = new Set([...staging.shopPolicies, ...live.shopPolicies].map((p) => p.type));
  for (const type of [...types].sort()) {
    const s = staging.shopPolicies.find((p) => p.type === type);
    const l = live.shopPolicies.find((p) => p.type === type);
    if ((s?.body ?? "").trim() !== (l?.body ?? "").trim()) {
      const title = s?.title ?? l?.title ?? type;
      out.push({ key: `policy:${type}`, label: `Policy: ${title}`, staging: s ? `${s.body.length} chars` : "Not set", live: l ? `${l.body.length} chars` : "Not set" });
    }
  }
  return out;
}
