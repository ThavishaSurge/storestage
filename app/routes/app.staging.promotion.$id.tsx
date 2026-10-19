import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { describeError } from "../services/admin.server";
import { getPairForShop } from "../services/pairing.server";
import { startRollback } from "../services/staging.server";
import { RESOURCE_LABELS, isResourceType } from "../lib/resources/types";
import { formatDate, JobProgress, Stat, StatusBadge } from "../components/ui";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const pair = await getPairForShop(session.shop);
  const promotion = await db.promotion.findFirst({ where: { id: String(params.id), pairId: pair?.id ?? "-" }, include: { items: { orderBy: { createdAt: "asc" } } } });
  if (!promotion || !pair) throw new Response("Not found", { status: 404 });
  const rollbackJob = await db.job.findFirst({
    where: { type: "store.rollback", payload: { contains: promotion.id } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  return {
    pair,
    promotion: {
      id: promotion.id,
      compareId: promotion.compareId,
      status: promotion.status,
      jobId: promotion.jobId,
      createdAt: promotion.createdAt.toISOString(),
      finishedAt: promotion.finishedAt?.toISOString() ?? null,
    },
    items: promotion.items.map((i) => ({ id: i.id, type: i.type, key: i.key, title: i.title, action: i.action, status: i.status, error: i.error })),
    rollbackJob,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const jobId = await startRollback(session.shop, String(params.id));
    return { jobId };
  } catch (error) {
    return { error: describeError(error) };
  }
};

export default function PromotionPage() {
  const { pair, promotion, items, rollbackJob } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ jobId?: string; error?: string }>();
  const running = ["queued", "running"].includes(promotion.status);
  const [finishedJob, setFinishedJob] = useState<string | null>(null);
  const candidate = fetcher.data?.jobId ?? (rollbackJob && ["queued", "running"].includes(rollbackJob.status) ? rollbackJob.id : null);
  const rollbackId = candidate && candidate !== finishedJob ? candidate : null;

  const count = (s: string) => items.filter((i) => i.status === s).length;

  return (
    <s-page heading={`Promotion · ${formatDate(promotion.createdAt)}`}>
      <s-section>
        <div className="ss-row" style={{ justifyContent: "space-between" }}>
          <div className="ss-col">
            <div className="ss-row">
              <StatusBadge status={promotion.status} />
              <span className="ss-muted">
                {pair.stagingShop} → {pair.liveShop}
              </span>
            </div>
            <Link to={`/app/staging/compare/${promotion.compareId}`}>← Back to comparison</Link>
          </div>
          {["done", "partial"].includes(promotion.status) && !rollbackId && (
            <fetcher.Form method="post" onSubmit={(e) => !confirm("Restore live to its state before this promotion? Created items are deleted, updated items restored.") && e.preventDefault()}>
              <button className="ss-btn ss-btn--critical" type="submit">
                Roll back
              </button>
            </fetcher.Form>
          )}
        </div>
        {running && promotion.jobId && (
          <div style={{ marginTop: 12 }}>
            <JobProgress jobId={promotion.jobId} label="Promoting to live" />
          </div>
        )}
        {rollbackId && (
          <div style={{ marginTop: 12 }}>
            <JobProgress jobId={rollbackId} label="Rolling back" onDone={() => setFinishedJob(rollbackId)} />
          </div>
        )}
        {fetcher.data?.error && (
          <s-banner tone="critical">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        )}
        <div className="ss-row" style={{ marginTop: 12 }}>
          <Stat label="Done" value={count("done")} />
          <Stat label="Failed" value={count("failed")} />
          <Stat label="Pending" value={count("pending")} />
          <Stat label="Rolled back" value={count("rolled-back")} />
        </div>
      </s-section>
      <s-section heading="Items">
        <table className="ss-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Action</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.title}
                  <div className="ss-muted ss-mono ss-break">{i.key}</div>
                  {i.error && <div style={{ color: i.status === "done" ? "#8a6116" : "#8e1f0b", fontSize: 12 }}>{i.error}</div>}
                </td>
                <td>{isResourceType(i.type) ? RESOURCE_LABELS[i.type].singular : i.type}</td>
                <td>
                  <StatusBadge status={i.action} />
                </td>
                <td>
                  <StatusBadge status={i.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
