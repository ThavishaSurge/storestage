import { describe, expect, it } from "vitest";
import type { RawShopSettings } from "../shopify/queries";
import { diffSettings } from "./settings";

const base: RawShopSettings = {
  name: "Shop",
  contactEmail: "hi@shop.test",
  description: null,
  currencyCode: "USD",
  enabledPresentmentCurrencies: ["USD", "EUR"],
  currencyFormats: { moneyFormat: "${{amount}}", moneyWithCurrencyFormat: "${{amount}} USD" },
  ianaTimezone: "America/New_York",
  weightUnit: "POUNDS",
  unitSystem: "IMPERIAL_SYSTEM",
  taxesIncluded: false,
  taxShipping: false,
  orderNumberFormatPrefix: "#",
  orderNumberFormatSuffix: "",
  shipsToCountries: ["US", "CA"],
  marketingSmsConsentEnabledAtCheckout: false,
  shopPolicies: [{ type: "REFUND_POLICY", title: "Refund policy", body: "<p>30 days</p>" }],
};

describe("diffSettings", () => {
  it("reports only real differences, ignoring list order and the store name", () => {
    const live = { ...base, name: "Live shop", enabledPresentmentCurrencies: ["EUR", "USD"], taxesIncluded: true, ianaTimezone: "Europe/Helsinki" };
    expect(diffSettings(base, live)).toEqual([
      { key: "ianaTimezone", label: "Time zone", staging: "America/New_York", live: "Europe/Helsinki" },
      { key: "taxesIncluded", label: "Prices include tax", staging: "No", live: "Yes" },
    ]);
  });

  it("compares policies by type", () => {
    const live = { ...base, shopPolicies: [{ type: "REFUND_POLICY", title: "Refund policy", body: "<p>14 days</p>" }, { type: "PRIVACY_POLICY", title: "Privacy policy", body: "x" }] };
    expect(diffSettings(base, live).map((d) => d.label)).toEqual(["Policy: Privacy policy", "Policy: Refund policy"]);
  });
});
