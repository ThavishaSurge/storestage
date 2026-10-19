/**
 * Feature flags (environment variables).
 *
 * THEME_WRITES_ENABLED=true   Enables theme duplication and theme file writes. Leave off until
 *                             Shopify grants the "Online Store protected scope" exemption;
 *                             without it every theme write fails with ACCESS_DENIED.
 * PUBLISH_CREATED_TO_ONLINE_STORE=false
 *                             By default products/collections created on live by a promotion
 *                             are published to the Online Store channel. Set to false to leave
 *                             them unpublished for a manual check first.
 */
export function themeWritesEnabled(): boolean {
  return process.env.THEME_WRITES_ENABLED === "true";
}

export function publishCreatedToOnlineStore(): boolean {
  return process.env.PUBLISH_CREATED_TO_ONLINE_STORE !== "false";
}
