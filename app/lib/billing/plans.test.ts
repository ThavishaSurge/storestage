import { describe, expect, it } from "vitest";
import { mergeQuota, monthEnd, monthStart, planFromSubscriptionNames, PLANS, snapshotsToPrune } from "./plans";

describe("plan from Shopify subscription names", () => {
  it("recognises the Pro plan however the Partner Dashboard names it", () => {
    expect(planFromSubscriptionNames(["Pro"])).toBe("pro");
    expect(planFromSubscriptionNames(["ThemeMerge Pro"])).toBe("pro");
    expect(planFromSubscriptionNames(["Pro (annual)"])).toBe("pro");
  });

  it("falls back to free rather than guessing a paid plan", () => {
    expect(planFromSubscriptionNames([])).toBe("free");
    expect(planFromSubscriptionNames(["Agency"])).toBe("free"); // not sold yet
    expect(planFromSubscriptionNames(["Professional services add-on"])).toBe("free"); // no word boundary match
  });
});

describe("merge quota", () => {
  it("allows the single free merge, then blocks", () => {
    expect(mergeQuota("free", 0)).toMatchObject({ allowed: true, remaining: 1, limit: 1 });
    expect(mergeQuota("free", 1)).toMatchObject({ allowed: false, remaining: 0 });
    expect(mergeQuota("free", 7)).toMatchObject({ allowed: false, remaining: 0 }); // never negative
  });

  it("never blocks Pro", () => {
    expect(mergeQuota("pro", 0)).toMatchObject({ allowed: true, limit: null, remaining: null });
    expect(mergeQuota("pro", 500)).toMatchObject({ allowed: true, limit: null });
  });

  it("counts over the calendar month in UTC", () => {
    const now = new Date("2026-10-19T23:30:00Z");
    expect(monthStart(now).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(monthEnd(now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(monthEnd(new Date("2026-12-14T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z"); // year rollover
  });
});

describe("snapshot retention", () => {
  const at = (iso: string, id: string, inUse = false) => ({ id, createdAt: new Date(iso), inUse });
  const now = new Date("2026-10-19T00:00:00Z");

  it("free keeps the newest three", () => {
    const snaps = [at("2026-10-18", "a"), at("2026-10-17", "b"), at("2026-10-16", "c"), at("2026-10-15", "d"), at("2026-10-14", "e")];
    expect(snapshotsToPrune(snaps, "free", now)).toEqual(["d", "e"]);
  });

  it("free keeps three regardless of the order it is given them", () => {
    const snaps = [at("2026-10-14", "e"), at("2026-10-18", "a"), at("2026-10-16", "c"), at("2026-10-17", "b")];
    expect(snapshotsToPrune(snaps, "free", now)).toEqual(["e"]);
  });

  it("pro keeps 90 days", () => {
    const snaps = [at("2026-10-01", "recent"), at("2026-06-01", "old"), at("2026-07-22", "edge")];
    expect(snapshotsToPrune(snaps, "pro", now)).toEqual(["old"]);
  });

  it("never prunes a baseline a working copy still points at", () => {
    const snaps = [at("2026-10-18", "a"), at("2026-10-17", "b"), at("2026-10-16", "c"), at("2026-01-01", "baseline", true)];
    expect(snapshotsToPrune(snaps, "free", now)).toEqual([]);
    expect(snapshotsToPrune(snaps, "pro", now)).toEqual([]);
  });

  it("prunes nothing when the shop is under the limit", () => {
    expect(snapshotsToPrune([at("2026-10-18", "a")], "free", now)).toEqual([]);
  });
});

describe("plan table", () => {
  it("matches the published Free/Pro limits", () => {
    expect(PLANS.free.limits).toMatchObject({ mergesPerMonth: 1, export: false, apply: true, restore: false, themeUpdateMode: false });
    expect(PLANS.pro.limits).toMatchObject({ mergesPerMonth: null, export: true, apply: true, restore: true, themeUpdateMode: true });
  });
});
