/**
 * Which plan a shop is on, and the checks that depend on it.
 *
 * Plans are sold through Shopify **Managed Pricing**: the tiers are configured in the Partner
 * Dashboard and Shopify owns the checkout, plan changes and proration. This module only *reads*
 * the resulting subscription and maps it onto the entitlements in `lib/billing/plans.ts`, so
 * nothing here needs to change if pricing does.
 */
import db from "../db.server";
import { APP_SUBSCRIPTIONS, type RawAppSubscription } from "../lib/shopify/queries";
import {
  DEFAULT_PLAN,
  limitsFor,
  mergeQuota,
  monthEnd,
  monthStart,
  planFromSubscriptionNames,
  PLANS,
  snapshotsToPrune,
  type PlanId,
  type PlanLimits,
  type Quota,
} from "../lib/billing/plans";
import { gql, type AdminClient } from "./admin.server";

export { PLANS, type PlanId, type PlanLimits } from "../lib/billing/plans";

/** Raised when a shop's plan doesn't include what it just tried to do. */
export class UpgradeRequiredError extends Error {
  readonly feature: string;
  constructor(feature: string, message: string) {
    super(message);
    this.name = "UpgradeRequiredError";
    this.feature = feature;
  }
}

/**
 * Shopify is the source of truth, but it is also a network call on a path the UI hits often,
 * so the answer is cached briefly per shop. Short enough that an upgrade is picked up on the
 * merchant's next click, long enough that a page with several loaders asks once.
 */
const CACHE_MS = 30_000;
const cache = new Map<string, { plan: PlanId; at: number }>();

export function forgetPlan(shop: string) {
  cache.delete(shop);
}

export async function planForShop(admin: AdminClient, shop: string): Promise<PlanId> {
  const hit = cache.get(shop);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.plan;

  let plan: PlanId = DEFAULT_PLAN;
  try {
    const data = await gql<{ currentAppInstallation: { activeSubscriptions: RawAppSubscription[] } | null }>(admin, APP_SUBSCRIPTIONS);
    const active = (data.currentAppInstallation?.activeSubscriptions ?? []).filter((s) => s.status === "ACTIVE");
    plan = planFromSubscriptionNames(active.map((s) => s.name));
  } catch {
    // Never block the app on a billing read: fall back to free, which only ever grants less.
    plan = DEFAULT_PLAN;
  }
  cache.set(shop, { plan, at: Date.now() });
  return plan;
}

/** Where to send someone to subscribe or change plan (Shopify-hosted). */
export function pricingPageUrl(shop: string): string {
  const handle = process.env.SHOPIFY_APP_HANDLE;
  const store = shop.replace(/\.myshopify\.com$/, "");
  return handle
    ? `https://admin.shopify.com/store/${store}/charges/${handle}/pricing_plans`
    : `https://admin.shopify.com/store/${store}/settings/apps`;
}

export interface PlanState {
  plan: PlanId;
  name: string;
  limits: PlanLimits;
  merges: Quota;
  /** When the merge quota resets, ISO. Null when there is no limit. */
  resetsAt: string | null;
  pricingUrl: string;
}

export async function planState(admin: AdminClient, shop: string, now = new Date()): Promise<PlanState> {
  const plan = await planForShop(admin, shop);
  const used = await db.themeMerge.count({ where: { shop, createdAt: { gte: monthStart(now) } } });
  const merges = mergeQuota(plan, used);
  return {
    plan,
    name: PLANS[plan].name,
    limits: limitsFor(plan),
    merges,
    resetsAt: merges.limit === null ? null : monthEnd(now).toISOString(),
    pricingUrl: pricingPageUrl(shop),
  };
}

export async function assertCanStartMerge(admin: AdminClient, shop: string, now = new Date()) {
  const plan = await planForShop(admin, shop);
  const limit = limitsFor(plan).mergesPerMonth;
  if (limit === null) return;
  const used = await db.themeMerge.count({ where: { shop, createdAt: { gte: monthStart(now) } } });
  if (used >= limit) {
    const resets = monthEnd(now).toISOString().slice(0, 10);
    throw new UpgradeRequiredError(
      "merges",
      `The Free plan includes ${limit} merge per month and you have used it. Upgrade to Pro for unlimited merges, or start a new one on ${resets}.`,
    );
  }
}

export async function assertCanExport(admin: AdminClient, shop: string) {
  const plan = await planForShop(admin, shop);
  if (!limitsFor(plan).export) {
    throw new UpgradeRequiredError("export", "Downloading the merged theme is a Pro feature. Upgrade to Pro to export, or apply the merge to a theme instead.");
  }
}

export async function assertCanApply(admin: AdminClient, shop: string) {
  const plan = await planForShop(admin, shop);
  if (!limitsFor(plan).apply) {
    throw new UpgradeRequiredError("apply", "Writing the merged result into a theme is not included in your plan.");
  }
}

/**
 * Drops automatic snapshots that fall outside the plan's retention. Called after a snapshot is
 * taken, so retention is enforced continuously rather than by a nightly sweep. Baselines a
 * working copy still points at are always kept — losing one downgrades every later merge of
 * that copy from a real three-way merge to timestamp guessing.
 */
export async function pruneSnapshots(admin: AdminClient, shop: string, now = new Date()): Promise<number> {
  const plan = await planForShop(admin, shop);
  const [snapshots, links] = await Promise.all([
    db.themeSnapshot.findMany({ where: { shop }, select: { id: true, createdAt: true, reason: true } }),
    db.themeLink.findMany({ where: { shop }, select: { baselineSnapshotId: true } }),
  ]);
  const inUse = new Set(links.map((l) => l.baselineSnapshotId));
  // Snapshots someone asked for by hand are theirs to delete.
  const automatic = snapshots.filter((s) => s.reason !== "manual");
  const ids = snapshotsToPrune(
    automatic.map((s) => ({ id: s.id, createdAt: s.createdAt, inUse: inUse.has(s.id) })),
    plan,
    now,
  );
  if (!ids.length) return 0;
  await db.themeSnapshot.deleteMany({ where: { id: { in: ids }, shop } });
  return ids.length;
}
