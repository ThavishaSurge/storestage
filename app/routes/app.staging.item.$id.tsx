import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { describeError } from "../services/admin.server";
import { getPairForShop } from "../services/pairing.server";
import { itemToChange, setItemDecision, setItemSelected } from "../services/staging.server";
import { resolvedData } from "../lib/resources/diff";
import { lineDiff } from "../lib/merge/lineDiff";
import type { ConflictDecision } from "../lib/merge/json3";
import { RESOURCE_LABELS, isResourceType } from "../lib/resources/types";
import { DiffView, JsonBlock, StatusBadge } from "../components/ui";

const pretty = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v, null, 2));

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const pair = await getPairForShop(session.shop);
  const item = await db.storeCompareItem.findUnique({ where: { id: String(params.id) }, include: { compare: true } });
  if (!item || !pair || item.compare.pairId !== pair.id) throw new Response("Not found", { status: 404 });
  const change = itemToChange(item);
  const decisions = item.decisions ? (JSON.parse(item.decisions) as Record<string, ConflictDecision>) : {};
  const result = change.action === "delete" ? null : resolvedData(change, decisions);
  return {
    pair,
    item: { id: item.id, compareId: item.compareId, type: item.type, key: item.key, title: item.title, status: item.status, action: item.action, selected: item.selected },
    conflicts: change.conflicts,
    decisions,
    willChangeLive: lineDiff(pretty(change.live), pretty(result)),
    stagingChanges: lineDiff(pretty(change.base), pretty(change.staging)),
    liveChanges: lineDiff(pretty(change.base), pretty(change.live)),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "decide") {
      await setItemDecision(session.shop, String(params.id), String(form.get("conflictId")), String(form.get("decision")) as "left" | "right" | "clear");
    } else if (form.get("intent") === "select") {
      await setItemSelected(session.shop, String(form.get("compareId")), [String(params.id)], form.get("selected") === "true");
    }
    return { ok: true };
  } catch (error) {
    return { error: describeError(error) };
  }
};

export default function ItemPage() {
  const { item, conflicts, decisions, willChangeLive, stagingChanges, liveChanges } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string }>();
  const label = isResourceType(item.type) ? RESOURCE_LABELS[item.type].singular : item.type;
  const decide = (conflictId: string, decision: string) => fetcher.submit({ intent: "decide", conflictId, decision }, { method: "post" });

  return (
    <s-page heading={item.title}>
      <s-section>
        <div className="ss-row" style={{ justifyContent: "space-between" }}>
          <div className="ss-col">
            <div className="ss-row">
              <s-badge>{label}</s-badge>
              <StatusBadge status={item.status} />
              <StatusBadge status={item.action} />
            </div>
            <span className="ss-muted ss-mono">{item.key}</span>
            <Link to={`/app/staging/compare/${item.compareId}`}>← Back to comparison</Link>
          </div>
          {item.action !== "none" && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="select" />
              <input type="hidden" name="compareId" value={item.compareId} />
              <input type="hidden" name="selected" value={String(!item.selected)} />
              <button className={`ss-btn ${item.selected ? "" : "ss-btn--primary"}`} type="submit">
                {item.selected ? "Don't promote" : "Promote this"}
              </button>
            </fetcher.Form>
          )}
        </div>
        {fetcher.data?.error && (
          <s-banner tone="critical">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        )}
        {item.action === "delete" && (
          <s-banner tone="warning">
            <s-paragraph>This was deleted on staging. Promoting it deletes it on live.</s-paragraph>
          </s-banner>
        )}
      </s-section>

      {conflicts.length > 0 && (
        <s-section heading={`Conflicts (${conflicts.filter((c) => !decisions[c.id]).length} undecided)`}>
          <s-paragraph>Both stores changed these fields since the baseline. Choose which value live should end up with.</s-paragraph>
          {conflicts.map((c) => {
            const d = decisions[c.id];
            return (
              <div key={c.id} className={`ss-hunk ${d ? "ss-hunk--decided" : ""}`}>
                <div className="ss-hunk__head">
                  <span className="ss-mono ss-break">{c.id}</span>
                  <div className="ss-row">
                    <button type="button" className={`ss-btn ss-btn--small ${d === "left" ? "ss-btn--active" : ""}`} onClick={() => decide(c.id, "left")}>
                      Keep live
                    </button>
                    <button type="button" className={`ss-btn ss-btn--small ${d === "right" ? "ss-btn--active" : ""}`} onClick={() => decide(c.id, "right")}>
                      Use staging
                    </button>
                    {d && (
                      <button type="button" className="ss-btn ss-btn--small" onClick={() => decide(c.id, "clear")}>
                        Undo
                      </button>
                    )}
                  </div>
                </div>
                <div className="ss-hunk__sides">
                  <div className="ss-hunk__side">
                    <div className="ss-hunk__label">Live now</div>
                    <JsonBlock value={c.left} />
                  </div>
                  <div className="ss-hunk__side">
                    <div className="ss-hunk__label">Staging</div>
                    <JsonBlock value={c.right} />
                  </div>
                </div>
                <details style={{ padding: "4px 8px" }}>
                  <summary className="ss-muted">Baseline value</summary>
                  <JsonBlock value={c.base} />
                </details>
              </div>
            );
          })}
        </s-section>
      )}

      <s-section heading="What promoting does to live">
        <DiffView rows={willChangeLive} empty="Live already matches." />
      </s-section>
      <s-section heading="Changed on staging since the baseline">
        <DiffView rows={stagingChanges} empty="No staging changes." />
      </s-section>
      <s-section heading="Changed on live since the baseline">
        <DiffView rows={liveChanges} empty="No live changes." />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
