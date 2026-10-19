import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { describeError } from "../services/admin.server";
import { getPairForShop } from "../services/pairing.server";
import { setItemSelected, startPromotion } from "../services/staging.server";
import { RESOURCE_LABELS, RESOURCE_TYPES, isResourceType } from "../lib/resources/types";
import type { JsonConflict } from "../lib/merge/json3";
import { formatDate, JobProgress, Stat, StatusBadge } from "../components/ui";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const pair = await getPairForShop(session.shop);
  const compare = await db.storeCompare.findFirst({ where: { id: String(params.id), pairId: pair?.id ?? "-" } });
  if (!compare || !pair) throw new Response("Not found", { status: 404 });
  const items = await db.storeCompareItem.findMany({
    where: { compareId: compare.id },
    select: { id: true, type: true, key: true, title: true, status: true, action: true, selected: true, conflicts: true, decisions: true },
  });
  const summary = compare.summary
    ? (JSON.parse(compare.summary) as {
        themeMergeId?: string | null;
        themeNote?: string | null;
        unknownGids?: number;
        settingsDiff?: { key: string; label: string; staging: string; live: string }[] | null;
      })
    : null;
  const themeMerge = summary?.themeMergeId
    ? await db.themeMerge.findUnique({ where: { id: summary.themeMergeId }, select: { id: true, status: true, summary: true, mode: true } })
    : null;
  return {
    pair,
    compare: { id: compare.id, status: compare.status, jobId: compare.jobId, createdAt: compare.createdAt.toISOString() },
    summary,
    themeMerge: themeMerge ? { ...themeMerge, summary: themeMerge.summary ? (JSON.parse(themeMerge.summary) as { unresolved: number; counts: Record<string, number> }) : null } : null,
    items: items
      .map((i) => {
        const conflicts = i.conflicts ? (JSON.parse(i.conflicts) as JsonConflict[]) : [];
        const decisions = i.decisions ? (JSON.parse(i.decisions) as Record<string, unknown>) : {};
        return {
          id: i.id,
          type: i.type,
          key: i.key,
          title: i.title,
          status: i.status,
          action: i.action,
          selected: i.selected,
          conflictCount: conflicts.length,
          undecided: conflicts.filter((c) => !decisions[c.id]).length,
        };
      })
      .sort((a, b) => RESOURCE_TYPES.indexOf(a.type as never) - RESOURCE_TYPES.indexOf(b.type as never) || a.title.localeCompare(b.title)),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const compareId = String(params.id);
  try {
    switch (String(form.get("intent"))) {
      case "select":
        await setItemSelected(session.shop, compareId, form.getAll("ids").map(String), form.get("selected") === "true");
        return { ok: true };
      case "promote": {
        const promotionId = await startPromotion(session.shop, compareId);
        return redirect(`/app/staging/promotion/${promotionId}`);
      }
    }
    return { ok: true };
  } catch (error) {
    return { error: describeError(error) };
  }
};

type Item = Awaited<ReturnType<typeof loader>>["items"][number];

const FILTERS: { id: string; label: string; match: (i: Item) => boolean }[] = [
  { id: "promotable", label: "Changes on staging", match: (i) => i.action !== "none" },
  { id: "conflicts", label: "Conflicts", match: (i) => i.status === "conflict" },
  { id: "drift", label: "Changed on live only", match: (i) => i.status === "live-changed" },
  { id: "all", label: "Everything", match: () => true },
];

export default function ComparePage() {
  const { pair, compare, items, summary, themeMerge } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<{ error?: string }>();
  const promote = useFetcher<{ error?: string }>();
  const filter = FILTERS.find((f) => f.id === (params.get("filter") ?? "promotable")) ?? FILTERS[0];
  const visible = items.filter(filter.match);
  const selected = items.filter((i) => i.selected && i.action !== "none");
  const undecided = selected.filter((i) => i.undecided > 0);

  if (compare.status === "running" && compare.jobId) {
    return (
      <s-page heading="Comparing stores">
        <s-section>
          <JobProgress jobId={compare.jobId} label={`Reading ${pair.stagingShop} and ${pair.liveShop}`} />
        </s-section>
      </s-page>
    );
  }

  const select = (ids: string[], value: boolean) => {
    const form = new FormData();
    form.set("intent", "select");
    form.set("selected", String(value));
    ids.forEach((id) => form.append("ids", id));
    fetcher.submit(form, { method: "post" });
  };

  const groups = RESOURCE_TYPES.map((type) => ({ type, items: visible.filter((i) => i.type === type) })).filter((g) => g.items.length);

  return (
    <s-page heading={`Staging → live · ${formatDate(compare.createdAt)}`}>
      <s-section>
        <div className="ss-row" style={{ justifyContent: "space-between" }}>
          <div className="ss-row">
            <Stat label="Selected to promote" value={selected.length} />
            <Stat label="Changes on staging" value={items.filter((i) => i.action !== "none").length} />
            <Stat label="Conflicts" value={items.filter((i) => i.status === "conflict").length} />
            <Stat label="Changed on live only" value={items.filter((i) => i.status === "live-changed").length} />
          </div>
          <promote.Form method="post" onSubmit={(e) => !confirm(`Promote ${selected.length} change(s) to ${pair.liveShop}? A pre-push snapshot is taken for rollback.`) && e.preventDefault()}>
            <input type="hidden" name="intent" value="promote" />
            <button className="ss-btn ss-btn--primary" type="submit" disabled={!selected.length || undecided.length > 0 || compare.status !== "ready"}>
              Promote {selected.length} to live
            </button>
          </promote.Form>
        </div>
        {undecided.length > 0 && (
          <s-banner tone="warning">
            <s-paragraph>{undecided.length} selected change(s) have conflicts to decide. Open them to choose live or staging for each field.</s-paragraph>
          </s-banner>
        )}
        {(promote.data?.error || fetcher.data?.error) && (
          <s-banner tone="critical">
            <s-paragraph>{promote.data?.error ?? fetcher.data?.error}</s-paragraph>
          </s-banner>
        )}
        {compare.status === "failed" && (
          <s-banner tone="critical">
            <s-paragraph>This comparison failed. Check the job log and try again.</s-paragraph>
          </s-banner>
        )}
      </s-section>

      {(themeMerge || summary?.themeNote) && (
        <s-section heading="Theme">
          {themeMerge ? (
            <div className="ss-row" style={{ justifyContent: "space-between" }}>
              <div className="ss-row">
                <StatusBadge status={themeMerge.status} />
                <s-badge>{themeMerge.mode}</s-badge>
                {themeMerge.summary && (
                  <span className="ss-muted">
                    {(themeMerge.summary.counts["target-changed"] ?? 0) + (themeMerge.summary.counts["auto-merged"] ?? 0) + (themeMerge.summary.counts.conflict ?? 0)} file(s) changed on staging,{" "}
                    {themeMerge.summary.unresolved} need a decision
                  </span>
                )}
              </div>
              <Link to={`/app/themes/merge/${themeMerge.id}`}>Review theme changes →</Link>
            </div>
          ) : null}
          {summary?.themeNote && <span className="ss-muted">{summary.themeNote}</span>}
          <div className="ss-muted" style={{ marginTop: 8 }}>
            Theme changes are promoted separately: StoreStage creates a merged copy of the live theme for you to preview and publish. The live theme itself is never edited.
          </div>
        </s-section>
      )}

      {summary?.settingsDiff && (
        <s-section heading="Store settings">
          {summary.settingsDiff.length === 0 ? (
            <span className="ss-muted">Staging and live have the same currency, tax, unit, order-number and policy settings.</span>
          ) : (
            <>
              <s-paragraph>These settings differ. Shopify doesn&apos;t allow apps to change most of them, so update them by hand in Settings.</s-paragraph>
              <table className="ss-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Setting</th>
                    <th>Staging</th>
                    <th>Live</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.settingsDiff.map((d) => (
                    <tr key={d.key}>
                      <td>{d.label}</td>
                      <td className="ss-break">{d.staging}</td>
                      <td className="ss-break">{d.live}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </s-section>
      )}

      <s-section heading="Resources">
        <div className="ss-tabs" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`ss-btn ss-btn--small ${f.id === filter.id ? "ss-btn--active" : ""}`}
              onClick={() => setParams((p) => {
                p.set("filter", f.id);
                return p;
              })}
            >
              {f.label} ({items.filter(f.match).length})
            </button>
          ))}
        </div>
        {groups.length === 0 && <div className="ss-muted">Nothing to show. Staging and live match the baseline for this filter.</div>}
        {groups.map((g) => {
          const promotable = g.items.filter((i) => i.action !== "none");
          const allSelected = promotable.length > 0 && promotable.every((i) => i.selected);
          return (
            <div key={g.type} style={{ marginBottom: 20 }}>
              <div className="ss-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                <s-heading>{isResourceType(g.type) ? RESOURCE_LABELS[g.type].plural : g.type}</s-heading>
                {promotable.length > 0 && (
                  <button className="ss-btn ss-btn--small" type="button" onClick={() => select(promotable.map((i) => i.id), !allSelected)}>
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>
              <table className="ss-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>Item</th>
                    <th>Status</th>
                    <th>On live</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.action !== "none" && (
                          <input type="checkbox" aria-label={`Promote ${i.title}`} checked={i.selected} onChange={(e) => select([i.id], e.target.checked)} />
                        )}
                      </td>
                      <td>
                        <Link to={`/app/staging/item/${i.id}`}>{i.title}</Link>
                        <div className="ss-muted ss-mono ss-break">{i.key}</div>
                      </td>
                      <td>
                        <div className="ss-row">
                          <StatusBadge status={i.status} />
                          {i.undecided > 0 && <s-badge tone="warning">{i.undecided} to decide</s-badge>}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={i.action} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
