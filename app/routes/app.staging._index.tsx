import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { describeError } from "../services/admin.server";
import { themeWritesEnabled } from "../services/flags.server";
import { activePairingCode, createPairingCode, getPairForShop, redeemPairingCode, unpair, type StoreRole } from "../services/pairing.server";
import { startClone, startCompare } from "../services/staging.server";
import { RESOURCE_LABELS, RESOURCE_TYPES, isResourceType, type ResourceType } from "../lib/resources/types";
import { formatDate, JobProgress, StatusBadge } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const pair = await getPairForShop(session.shop);
  const code = pair ? null : await activePairingCode(session.shop);
  if (!pair) {
    return { shop: session.shop, pair: null, code: code ? { code: code.code, role: code.role, expiresAt: code.expiresAt.toISOString() } : null } as const;
  }

  const [compares, promotions, cloneJob, baseline] = await Promise.all([
    db.storeCompare.findMany({ where: { pairId: pair.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.promotion.findMany({ where: { pairId: pair.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.job.findFirst({
      where: { type: "store.clone", payload: { contains: pair.id } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, result: true, error: true, createdAt: true },
    }),
    pair.baselineSnapshotId
      ? db.storeSnapshotItem.groupBy({ by: ["type"], where: { snapshotId: pair.baselineSnapshotId }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);

  return {
    shop: session.shop,
    code: null,
    pair: { ...pair, clonedAt: pair.clonedAt?.toISOString() ?? null },
    compares: compares.map((c) => ({ id: c.id, status: c.status, createdAt: c.createdAt.toISOString(), jobId: c.jobId, summary: c.summary ? (JSON.parse(c.summary) as { promotable: number; byStatus: Record<string, number> }) : null })),
    promotions: promotions.map((p) => ({ id: p.id, status: p.status, createdAt: p.createdAt.toISOString(), summary: p.summary ? (JSON.parse(p.summary) as { done: number; failed: number }) : null })),
    cloneJob: cloneJob
      ? { id: cloneJob.id, status: cloneJob.status, error: cloneJob.error, createdAt: cloneJob.createdAt.toISOString(), result: cloneJob.result ? (JSON.parse(cloneJob.result) as Record<string, unknown>) : null }
      : null,
    baseline: baseline.map((b) => ({ type: b.type, count: b._count._all })),
    writesEnabled: themeWritesEnabled(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    switch (intent) {
      case "code":
        await createPairingCode(session.shop, String(form.get("role")) as StoreRole);
        return { ok: true };
      case "redeem":
        await redeemPairingCode(session.shop, String(form.get("code")));
        return { ok: true };
      case "unpair":
        await unpair(session.shop);
        return { ok: true };
      case "clone": {
        const pair = await getPairForShop(session.shop);
        if (!pair) throw new Error("Not paired");
        const types = form.getAll("types").map(String).filter(isResourceType);
        if (!types.length) throw new Error("Pick at least one resource type");
        const jobId = await startClone(session.shop, pair.id, {
          types,
          copyTheme: form.get("copyTheme") === "on",
          baselineOnly: form.get("mode") === "baseline",
        });
        return { jobId };
      }
      case "compare": {
        const pair = await getPairForShop(session.shop);
        if (!pair) throw new Error("Not paired");
        const compareId = await startCompare(session.shop, pair.id, { includeTheme: form.get("includeTheme") === "on" });
        return redirect(`/app/staging/compare/${compareId}`);
      }
      default:
        throw new Error(`Unknown action ${intent}`);
    }
  } catch (error) {
    return { error: describeError(error) };
  }
};

type ActionData = { ok?: boolean; error?: string; jobId?: string };

export default function StagingIndex() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();

  return (
    <s-page heading="Staging">
      {fetcher.data?.error && (
        <s-section>
          <s-banner tone="critical">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        </s-section>
      )}
      {data.pair ? <Paired data={data as Extract<typeof data, { pair: object }>} /> : <Pairing shop={data.shop} code={data.code} fetcher={fetcher} />}
    </s-page>
  );
}

function Pairing({
  shop,
  code,
  fetcher,
}: {
  shop: string;
  code: { code: string; role: string; expiresAt: string } | null;
  fetcher: ReturnType<typeof useFetcher<ActionData>>;
}) {
  const [role, setRole] = useState<StoreRole>("live");
  return (
    <>
      <s-section heading="Connect your staging and live stores">
        <s-paragraph>
          Install StoreStage on both stores. Generate a code on one of them and enter it on the other. You can then clone live into
          staging, make changes on staging, and promote only the changes you approve back to live.
        </s-paragraph>
      </s-section>
      <s-section heading={`Generate a code on this store (${shop})`}>
        {code ? (
          <div className="ss-col">
            <div className="ss-row">
              <span style={{ fontSize: 28, fontWeight: 650, letterSpacing: 2 }} className="ss-mono">
                {code.code}
              </span>
              <s-badge tone="info">This store is {code.role}</s-badge>
            </div>
            <span className="ss-muted">Enter it in StoreStage on the other store. Expires {formatDate(code.expiresAt)}.</span>
          </div>
        ) : (
          <fetcher.Form method="post" className="ss-row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="intent" value="code" />
            <label className="ss-field">
              <span>This store is the</span>
              <select className="ss-select" name="role" value={role} onChange={(e) => setRole(e.target.value as StoreRole)}>
                <option value="live">Live store</option>
                <option value="staging">Staging store</option>
              </select>
            </label>
            <button className="ss-btn ss-btn--primary" type="submit">
              Generate code
            </button>
          </fetcher.Form>
        )}
      </s-section>
      <s-section heading="…or enter a code from the other store">
        <fetcher.Form method="post" className="ss-row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="intent" value="redeem" />
          <label className="ss-field">
            <span>Pairing code</span>
            <input className="ss-input ss-mono" name="code" placeholder="ABCD-EFGH" autoComplete="off" required />
          </label>
          <button className="ss-btn" type="submit">
            Pair stores
          </button>
        </fetcher.Form>
      </s-section>
    </>
  );
}

function Paired({ data }: { data: Extract<ReturnType<typeof useLoaderData<typeof loader>>, { pair: object }> }) {
  const { pair, compares, promotions, cloneJob, baseline, writesEnabled } = data;
  const fetcher = useFetcher<ActionData>();
  const [finishedJob, setFinishedJob] = useState<string | null>(null);
  const candidate = fetcher.data?.jobId ?? (cloneJob && ["queued", "running"].includes(cloneJob.status) ? cloneJob.id : null);
  const jobId = candidate && candidate !== finishedJob ? candidate : null;
  const [types, setTypes] = useState<ResourceType[]>([...RESOURCE_TYPES]);
  const result = cloneJob?.result as { copied?: number; failed?: number; unchanged?: number; theme?: string; baselineOnly?: boolean; failures?: { type: string; key: string; error: string }[] } | null;

  return (
    <>
      <s-section heading="Paired stores">
        <div className="ss-row" style={{ justifyContent: "space-between" }}>
          <div className="ss-col">
            <span>
              <strong>Staging:</strong> {pair.stagingShop} {pair.role === "staging" && <s-badge>this store</s-badge>}
            </span>
            <span>
              <strong>Live:</strong> {pair.liveShop} {pair.role === "live" && <s-badge>this store</s-badge>}
            </span>
            <span className="ss-muted">{pair.clonedAt ? `Baseline recorded ${formatDate(pair.clonedAt)}` : "No baseline yet — clone or record one below."}</span>
          </div>
          <fetcher.Form method="post" onSubmit={(e) => !confirm("Unpair these stores? History is kept.") && e.preventDefault()}>
            <input type="hidden" name="intent" value="unpair" />
            <button className="ss-btn" type="submit">
              Unpair
            </button>
          </fetcher.Form>
        </div>
        {fetcher.data?.error && (
          <s-banner tone="critical">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        )}
      </s-section>

      <s-section heading="1. Clone live into staging">
        <s-paragraph>
          Copies live&apos;s catalog, content and custom data into staging and records a baseline: the shared starting point every later
          comparison is measured against. Orders, customers and inventory levels are never copied.
        </s-paragraph>
        {jobId ? (
          <div style={{ marginTop: 12 }}>
            <JobProgress jobId={jobId} label="Cloning" onDone={() => setFinishedJob(jobId)} />
          </div>
        ) : (
          <fetcher.Form method="post" className="ss-col" style={{ marginTop: 12 }}>
            <input type="hidden" name="intent" value="clone" />
            <div className="ss-row">
              {RESOURCE_TYPES.map((t) => (
                <label key={t} className="ss-check">
                  <input
                    type="checkbox"
                    name="types"
                    value={t}
                    checked={types.includes(t)}
                    onChange={(e) => setTypes((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)))}
                  />
                  {RESOURCE_LABELS[t].plural}
                </label>
              ))}
            </div>
            <label className="ss-check">
              <input type="checkbox" name="copyTheme" disabled={!writesEnabled} />
              Also copy the live theme into staging as an unpublished theme {!writesEnabled && <span className="ss-muted">(needs theme writes)</span>}
            </label>
            <div className="ss-row">
              <button className="ss-btn ss-btn--primary" type="submit" name="mode" value="clone">
                Clone live → staging
              </button>
              <button className="ss-btn" type="submit" name="mode" value="baseline">
                Staging is already a copy — just record the baseline
              </button>
            </div>
          </fetcher.Form>
        )}
        {cloneJob?.status === "done" && result && !jobId && (
          <div style={{ marginTop: 12 }}>
            <s-banner tone={result.failed ? "warning" : "success"} heading={result.baselineOnly ? "Baseline recorded" : "Clone finished"}>
              <s-paragraph>
                {result.baselineOnly
                  ? "Live was snapshotted as the baseline."
                  : `${result.copied ?? 0} copied, ${result.unchanged ?? 0} already identical, ${result.failed ?? 0} failed.`}{" "}
                {result.theme ?? ""}
              </s-paragraph>
              {result.failures?.length ? (
                <ul>
                  {result.failures.slice(0, 10).map((f) => (
                    <li key={`${f.type}:${f.key}`} className="ss-muted">
                      {f.type} {f.key}: {f.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </s-banner>
          </div>
        )}
        {baseline.length > 0 && (
          <div className="ss-row" style={{ marginTop: 12 }}>
            {baseline.map((b) => (
              <s-badge key={b.type}>
                {isResourceType(b.type) ? RESOURCE_LABELS[b.type].plural : b.type}: {b.count}
              </s-badge>
            ))}
          </div>
        )}
      </s-section>

      <s-section heading="2. Compare staging with live">
        <s-paragraph>
          Finds what changed on staging since the baseline, what changed on live (client edits — never overwritten), and where both
          changed the same thing.
        </s-paragraph>
        <fetcher.Form method="post" className="ss-row" style={{ marginTop: 12 }}>
          <input type="hidden" name="intent" value="compare" />
          <label className="ss-check">
            <input type="checkbox" name="includeTheme" defaultChecked />
            Include the published themes
          </label>
          <button className="ss-btn ss-btn--primary" type="submit" disabled={!pair.clonedAt || fetcher.state !== "idle"}>
            Compare now
          </button>
        </fetcher.Form>
        {compares.length > 0 && (
          <table className="ss-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Comparison</th>
                <th>Status</th>
                <th>Promotable</th>
                <th>Conflicts</th>
              </tr>
            </thead>
            <tbody>
              {compares.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/app/staging/compare/${c.id}`}>{formatDate(c.createdAt)}</Link>
                  </td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>{c.summary?.promotable ?? "—"}</td>
                  <td>{c.summary?.byStatus.conflict ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      {promotions.length > 0 && (
        <s-section heading="3. Promotions (audit log)">
          <table className="ss-table">
            <thead>
              <tr>
                <th>Promotion</th>
                <th>Status</th>
                <th>Done</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/app/staging/promotion/${p.id}`}>{formatDate(p.createdAt)}</Link>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>{p.summary?.done ?? "—"}</td>
                  <td>{p.summary?.failed ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-section>
      )}
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
