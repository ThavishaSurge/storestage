/**
 * Feature flags (environment variables).
 *
 * THEME_WRITES_ENABLED=true   Enables theme duplication and theme file writes. Leave off until
 *                             Shopify grants the "Online Store protected scope" exemption;
 *                             without it every theme write fails with ACCESS_DENIED.
 */
export function themeWritesEnabled(): boolean {
  return process.env.THEME_WRITES_ENABLED === "true";
}
