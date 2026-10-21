import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { themeWritesEnabled } from "../services/flags.server";
import { planState } from "../services/billing.server";
import type { AdminClient } from "../services/admin.server";
import { BrandLockup, formatDate, StatusBadge } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [merges, themeCount] = await Promise.all([
    db.themeMerge.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, liveThemeName: true, targetThemeName: true, status: true, createdAt: true },
    }),
    db.themeLink.count({ where: { shop: session.shop } }),
  ]);
  return {
    shop: session.shop,
    merges: merges.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    workingCopies: themeCount,
    flags: { themeWrites: themeWritesEnabled() },
    plan: await planState(admin as unknown as AdminClient, session.shop),
  };
};

export default function Overview() {
  const { merges, workingCopies, flags, plan } = useLoaderData<typeof loader>();
  return (
    <s-page heading="ThemeMerge">
      <s-section>
        <div className="tm-hero">
          <BrandLockup />
          <h2 className="tm-hero__title">Publish your theme without losing the client&apos;s edits.</h2>
          <p className="tm-hero__body">
            They kept editing the live theme while you worked on a copy. ThemeMerge finds every file either side changed,
            merges theme-editor JSON key by key and Liquid, CSS and JS line by line, and leaves only the real conflicts for
            you to decide.
          </p>
          <div className="tm-row" style={{ marginTop: 16 }}>
            <Link className="tm-btn tm-btn--primary" to="/app/themes">
              Compare two themes
            </Link>
            {workingCopies > 0 && (
              <span className="tm-muted">
                {workingCopies} working {workingCopies === 1 ? "copy" : "copies"} with a recorded baseline
              </span>
            )}
          </div>
        </div>
      </s-section>

      <s-section heading="How it works">
        <ol className="tm-steps">
          <li>
            <strong>Record a baseline.</strong> Duplicate the live theme from here, or record the baseline right after you
            duplicate it yourself. That fork point is what makes the merge a true three-way merge.
          </li>
          <li>
            <strong>Compare.</strong> Changed only on live → take live. Changed only in your copy → keep it. Changed on both →
            merged automatically where possible, flagged as a conflict where not.
          </li>
          <li>
            <strong>Decide.</strong> Resolve conflicts per file, per conflict, or by editing the result by hand.
          </li>
          <li>
            <strong>Ship.</strong> Download the full merged theme and upload it as a new theme, or apply it straight to your
            working copy. The live theme is never written.
          </li>
        </ol>
      </s-section>

      {merges.length > 0 && (
        <s-section heading="Recent merges">
          <table className="tm-table">
            <tbody>
              {merges.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/app/themes/merge/${m.id}`}>
                      {m.liveThemeName} → {m.targetThemeName}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="tm-nowrap">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-section>
      )}

      <s-section slot="aside" heading="Plan">
        <div className="tm-col">
          <div className="tm-row">
            <s-badge tone={plan.plan === "pro" ? "success" : "neutral"}>{plan.name}</s-badge>
            <span>
              {plan.merges.limit === null
                ? "Unlimited merges"
                : `${plan.merges.used} of ${plan.merges.limit} ${plan.merges.limit === 1 ? "merge" : "merges"} used this month`}
            </span>
          </div>
          {plan.merges.limit !== null && (
            <span className="tm-muted">
              {plan.merges.remaining === 0
                ? `Your quota resets ${formatDate(plan.resetsAt)}.`
                : `Comparing themes is always unlimited; the limit is on running a merge.`}
            </span>
          )}
          <div className="tm-row">
            <a className="tm-btn" href={plan.pricingUrl} target="_top">
              {plan.plan === "pro" ? "Manage plan" : "Upgrade to Pro"}
            </a>
          </div>
        </div>
      </s-section>

      <s-section slot="aside" heading="Theme writes">
        <div className="tm-col">
          <div className="tm-row">
            <s-badge tone={flags.themeWrites ? "success" : "warning"}>{flags.themeWrites ? "On" : "Off"}</s-badge>
            <span>{flags.themeWrites ? "ThemeMerge can write themes" : "Export only"}</span>
          </div>
          <span className="tm-muted">
            Writing theme files needs Shopify&apos;s Online Store protected-scope exemption. Until it&apos;s granted, compare,
            decide, then download the full merged theme and upload it under Online Store → Themes.
          </span>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
