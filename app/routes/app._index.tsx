import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { publishCreatedToOnlineStore, themeWritesEnabled } from "../services/flags.server";
import { getPairForShop } from "../services/pairing.server";
import { formatDate, StatusBadge } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const pair = await getPairForShop(session.shop);
  const [merges, promotions] = await Promise.all([
    db.themeMerge.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, liveThemeName: true, targetThemeName: true, status: true, kind: true, createdAt: true } }),
    pair ? db.promotion.findMany({ where: { pairId: pair.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, createdAt: true } }) : Promise.resolve([]),
  ]);
  return {
    shop: session.shop,
    pair: pair ? { role: pair.role, otherShop: pair.otherShop, clonedAt: pair.clonedAt?.toISOString() ?? null } : null,
    merges: merges.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    promotions: promotions.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    flags: { themeWrites: themeWritesEnabled(), publishCreated: publishCreatedToOnlineStore() },
  };
};

export default function Overview() {
  const { pair, merges, promotions, flags } = useLoaderData<typeof loader>();
  return (
    <s-page heading="StoreStage">
      <s-section heading="Theme Compare">
        <s-paragraph>
          The client edited the live theme while you worked on a copy? Compare the two, keep their edits, and publish your copy
          without losing anything. Works on this store alone.
        </s-paragraph>
        <div style={{ marginTop: 8 }}>
          <Link to="/app/themes">Open Theme Compare →</Link>
        </div>
      </s-section>

      <s-section heading="Staging">
        <s-paragraph>
          Pair a staging store with this one. Clone live into staging, make changes there, then review a three-way diff and promote only
          the changes you approve — products, collections, pages, blogs, menus, redirects, files, metafield and metaobject definitions,
          metaobjects, and the theme.
        </s-paragraph>
        <div className="ss-row" style={{ marginTop: 8 }}>
          {pair ? (
            <span>
              Paired with <strong>{pair.otherShop}</strong> (this store is {pair.role}).{" "}
              {pair.clonedAt ? `Baseline ${formatDate(pair.clonedAt)}.` : "No baseline yet."}
            </span>
          ) : (
            <span className="ss-muted">Not paired.</span>
          )}
          <Link to="/app/staging">Open Staging →</Link>
        </div>
      </s-section>

      {(merges.length > 0 || promotions.length > 0) && (
        <s-section heading="Recent activity">
          <table className="ss-table">
            <tbody>
              {merges.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/app/themes/merge/${m.id}`}>
                      Theme {m.kind === "cross-store" ? "promotion" : "merge"}: {m.liveThemeName} ← {m.targetThemeName}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="ss-nowrap">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
              {promotions.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/app/staging/promotion/${p.id}`}>Promotion to live</Link>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="ss-nowrap">{formatDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-section>
      )}

      <s-section slot="aside" heading="Settings">
        <div className="ss-col">
          <div className="ss-row">
            <s-badge tone={flags.themeWrites ? "success" : "warning"}>{flags.themeWrites ? "On" : "Off"}</s-badge>
            <span>Theme writes</span>
          </div>
          <span className="ss-muted">
            Writing theme files needs Shopify&apos;s Online Store protected-scope exemption. Until it&apos;s granted, compare and download the
            merged files, then push them with Shopify CLI. Turn on with THEME_WRITES_ENABLED=true.
          </span>
          <div className="ss-row">
            <s-badge tone="info">{flags.publishCreated ? "On" : "Off"}</s-badge>
            <span>Publish promoted new products/collections</span>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
