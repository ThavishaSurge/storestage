/**
 * Plans and entitlements. Pure: no I/O, no Shopify, no database.
 *
 * The plan a shop is on comes from its active Shopify app subscription (see
 * `services/billing.server.ts`); everything that *depends* on the plan is decided here so the
 * limits are in one place and unit-testable.
 */

export type PlanId = "free" | "pro";

export type Retention = { kind: "count"; value: number } | { kind: "days"; value: number };

export interface PlanLimits {
  /** Merges that may be started per calendar month. `null` is unlimited. */
  mergesPerMonth: number | null;
  /** Downloading the changed files plus MERGE-REPORT.md, for `shopify theme push`. */
  exportChangedFiles: boolean;
  /** Downloading every file of the merged theme, ready to upload as a new theme. */
  exportFullTheme: boolean;
  /**
   * Writing the merged result into a theme from inside the app — "Create merged theme" (a new
   * draft theme) and "Apply to working copy". Needs Shopify's Online Store protected-scope
   * exemption on top of the plan; the plan alone is not enough.
   */
  apply: boolean;
  /** Re-merging a vendor's new theme version onto a customised copy. Not built yet. */
  themeUpdateMode: boolean;
  /** Restoring a theme from a snapshot in one click. Not built yet. */
  restore: boolean;
  /** How long automatic snapshots are kept. Baselines in use are never pruned. */
  retention: Retention;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Shown in the UI; billing itself is configured in the Partner Dashboard. */
  priceHint: string;
  limits: PlanLimits;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceHint: "Free",
    limits: {
      mergesPerMonth: 1,
      exportChangedFiles: true,
      exportFullTheme: false,
      apply: false,
      themeUpdateMode: false,
      restore: false,
      retention: { kind: "count", value: 3 },
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceHint: "Paid monthly",
    limits: {
      mergesPerMonth: null,
      exportChangedFiles: true,
      exportFullTheme: true,
      apply: true,
      themeUpdateMode: true,
      restore: true,
      retention: { kind: "days", value: 90 },
    },
  },
};

export const DEFAULT_PLAN: PlanId = "free";

/**
 * Maps the names of a shop's active Shopify subscriptions onto a plan. Matching is loose on
 * purpose — the Partner Dashboard plan may be called "Pro", "ThemeMerge Pro" or "Pro (annual)".
 * Unknown names fall back to free rather than granting paid features by accident.
 */
export function planFromSubscriptionNames(names: readonly string[]): PlanId {
  for (const name of names) {
    if (/\bpro\b/i.test(name)) return "pro";
  }
  return DEFAULT_PLAN;
}

export function limitsFor(plan: PlanId): PlanLimits {
  return PLANS[plan].limits;
}

export interface Quota {
  used: number;
  /** `null` is unlimited. */
  limit: number | null;
  remaining: number | null;
  allowed: boolean;
}

export function mergeQuota(plan: PlanId, usedThisMonth: number): Quota {
  const limit = limitsFor(plan).mergesPerMonth;
  if (limit === null) return { used: usedThisMonth, limit: null, remaining: null, allowed: true };
  const remaining = Math.max(limit - usedThisMonth, 0);
  return { used: usedThisMonth, limit, remaining, allowed: remaining > 0 };
}

/** First instant of the current calendar month in UTC — the window merge quota is counted over. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Start of the next calendar month: when the quota resets. */
export function monthEnd(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface PrunableSnapshot {
  id: string;
  createdAt: Date;
  /** Baselines a working copy still depends on are never pruned. */
  inUse: boolean;
}

/**
 * Which automatic snapshots fall outside the plan's retention. Newest first is not assumed —
 * the list is sorted here. In-use baselines are kept whatever the plan says, because deleting
 * one silently downgrades every later merge of that working copy to timestamp guessing.
 */
export function snapshotsToPrune(snapshots: readonly PrunableSnapshot[], plan: PlanId, now: Date): string[] {
  const retention = limitsFor(plan).retention;
  const candidates = snapshots.filter((s) => !s.inUse).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (retention.kind === "count") {
    return candidates.slice(retention.value).map((s) => s.id);
  }
  const cutoff = now.getTime() - retention.value * 24 * 60 * 60 * 1000;
  return candidates.filter((s) => s.createdAt.getTime() < cutoff).map((s) => s.id);
}
