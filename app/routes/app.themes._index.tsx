import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { describeError, type AdminClient } from "../services/admin.server";
import { themeWritesEnabled } from "../services/flags.server";
import { planState, UpgradeRequiredError } from "../services/billing.server";
import { enqueueJob } from "../services/jobs.server";
import { startThemeMerge } from "../services/themeMerge.server";
import { listThemes } from "../services/themes.server";
import { formatDate, JobProgress, StatusBadge } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const themes = await listThemes(admin as unknown as AdminClient);
  const plan = await planState(admin as unknown as AdminClient, session.shop);
  const [snapshots, merges, links] = await Promise.all([
    db.themeSnapshot.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, themeId: true, themeName: true, reason: true, label: true, createdAt: true, _count: { select: { files: true } } },
    }),
    db.themeMerge.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, liveThemeName: true, targetThemeName: true, status: true, mode: true, summary: true, createdAt: true },
    }),
    db.themeLink.findMany({ where: { shop: session.shop } }),
  ]);
  return {
    themes,
    snapshots: snapshots.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), files: s._count.files })),
    merges: merges.map((m) => ({ ...m, createdAt: m.createdAt.toISOString(), summary: m.summary ? (JSON.parse(m.summary) as { unresolved: number; counts: Record<string, number> }) : null })),
    links: links.map((l) => ({ workingThemeId: l.workingThemeId, sourceThemeId: l.sourceThemeId, baselineSnapshotId: l.baselineSnapshotId })),
    writesEnabled: themeWritesEnabled(),
    plan,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    switch (intent) {
      case "compare": {
        const mergeId = await startThemeMerge({
          shop: session.shop,
          admin: admin as unknown as AdminClient,
          liveThemeId: String(form.get("liveThemeId")),
          targetThemeId: String(form.get("targetThemeId")),
          baselineSnapshotId: (form.get("baselineSnapshotId") as string) || null,
        });
        return redirect(`/app/themes/merge/${mergeId}`);
      }
      case "workingCopy": {
        if (!themeWritesEnabled()) throw new Error("Theme writes are disabled (THEME_WRITES_ENABLED).");
        const jobId = await enqueueJob(session.shop, "theme.workingCopy", { sourceThemeId: form.get("sourceThemeId"), name: form.get("name") });
        return { jobId, label: "Creating working copy" };
      }
      case "recordBaseline": {
        const jobId = await enqueueJob(session.shop, "theme.recordBaseline", {
          sourceThemeId: form.get("sourceThemeId"),
          workingThemeId: form.get("workingThemeId"),
          workingThemeName: form.get("workingThemeName"),
        });
        return { jobId, label: "Recording baseline" };
      }
      case "snapshot": {
        const jobId = await enqueueJob(session.shop, "theme.snapshot", { themeId: form.get("themeId"), label: form.get("label") });
        return { jobId, label: "Taking snapshot" };
      }
      case "deleteSnapshot": {
        const id = String(form.get("snapshotId"));
        const inUse = await db.themeLink.count({ where: { baselineSnapshotId: id } });
        if (inUse) throw new Error("This snapshot is the baseline of a working copy");
        await db.themeSnapshot.deleteMany({ where: { id, shop: session.shop } });
        return { ok: true };
      }
      default:
        throw new Error(`Unknown action ${intent}`);
    }
  } catch (error) {
    return { error: describeError(error), upgrade: error instanceof UpgradeRequiredError };
  }
};

type ActionData = { jobId?: string; label?: string; error?: string; ok?: boolean; upgrade?: boolean };

export default function ThemesIndex() {
  const { themes, snapshots, merges, links, writesEnabled, plan } = useLoaderData<typeof loader>();
  const compare = useFetcher<ActionData>();
  const tools = useFetcher<ActionData>();
  const main = themes.find((t) => t.role === "MAIN");
  const [liveId, setLiveId] = useState(main?.id ?? themes[0]?.id ?? "");
  const others = themes.filter((t) => t.id !== liveId);
  const [targetId, setTargetId] = useState(others[0]?.id ?? "");
  const link = links.find((l) => l.workingThemeId === targetId && l.sourceThemeId === liveId);
  const liveSnapshots = snapshots.filter((s) => s.themeId === liveId);
  const [baselineId, setBaselineId] = useState("");
  const [finishedJob, setFinishedJob] = useState<string | null>(null);
  const job = tools.data?.jobId && tools.data.jobId !== finishedJob ? { id: tools.data.jobId, label: tools.data.label ?? "Working" } : null;

  const changeLive = (id: string) => {
    setLiveId(id);
    if (targetId === id || !targetId) setTargetId(themes.find((t) => t.id !== id)?.id ?? "");
  };

  const target = themes.find((t) => t.id === targetId);
  const busy = compare.state !== "idle";

  return (
    <s-page heading="Compare themes">
      <s-section heading="Compare two themes">
        {plan.merges.limit !== null && (
          <div className="tm-row" style={{ marginBottom: 4 }}>
            <s-badge tone={plan.merges.allowed ? "neutral" : "warning"}>{plan.name}</s-badge>
            <span className="tm-muted">
              {plan.merges.remaining} of {plan.merges.limit} {plan.merges.limit === 1 ? "merge" : "merges"} left this month ·{" "}
              <a href={plan.pricingUrl} target="_top">
                Upgrade for unlimited
              </a>
            </span>
          </div>
        )}
        <s-paragraph>
          Pick the live theme (it has the client&apos;s edits) and the working copy you want to publish. ThemeMerge finds every
          file changed on either side, merges theme-editor JSON key by key, and lists the conflicts for you to decide.
        </s-paragraph>
        <compare.Form method="post">
          <input type="hidden" name="intent" value="compare" />
          <div className="tm-row" style={{ alignItems: "flex-end", marginTop: 12 }}>
            <label className="tm-field tm-grow">
              <span>Live theme (keep its changes)</span>
              <select className="tm-select" name="liveThemeId" value={liveId} onChange={(e) => changeLive(e.target.value)}>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {themeOptionLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="tm-field tm-grow">
              <span>Working copy (to publish)</span>
              <select className="tm-select" name="targetThemeId" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {themeOptionLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="tm-field tm-grow">
              <span>Baseline</span>
              <select className="tm-select" name="baselineSnapshotId" value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
                <option value="">{link ? "Automatic (recorded when the copy was made)" : "None — use timestamps"}</option>
                {liveSnapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    Snapshot {formatDate(s.createdAt)} {s.label ? `— ${s.label}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button className="tm-btn tm-btn--primary" type="submit" disabled={busy || !targetId}>
              {busy ? "Starting…" : "Compare"}
            </button>
          </div>
        </compare.Form>
        {compare.data?.error && (
          <s-banner tone={compare.data.upgrade ? "info" : "critical"} heading={compare.data.upgrade ? "Merge limit reached" : undefined}>
            <s-paragraph>{compare.data.error}</s-paragraph>
            {compare.data.upgrade && (
              <s-paragraph>
                <a href={plan.pricingUrl} target="_top">
                  See plans →
                </a>
              </s-paragraph>
            )}
          </s-banner>
        )}
        <div style={{ marginTop: 12 }}>
          {link || baselineId ? (
            <s-banner tone="success">
              <s-paragraph>Three-way compare: ThemeMerge knows exactly what each side changed since the copy was made.</s-paragraph>
            </s-banner>
          ) : target ? (
            <s-banner tone="info">
              <s-paragraph>
                No baseline for this pair. Changes are attributed by timestamp: files edited on live after{" "}
                {formatDate(target.createdAt)} (when the copy was created) count as client changes. Files edited on both sides
                become conflicts.
              </s-paragraph>
            </s-banner>
          ) : null}
        </div>
      </s-section>

      {merges.length > 0 && (
        <s-section heading="Recent comparisons">
          <table className="tm-table">
            <thead>
              <tr>
                <th>Live → working copy</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Needs decision</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {merges.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/app/themes/merge/${m.id}`}>
                      {m.liveThemeName} → {m.targetThemeName}
                    </Link>
                  </td>
                  <td>{m.mode}</td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td>{m.summary ? m.summary.unresolved : "—"}</td>
                  <td className="tm-nowrap">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-section>
      )}

      <s-section heading="Baselines for future merges">
        <s-paragraph>
          A baseline is a snapshot of the live theme taken when the working copy is made. With it, ThemeMerge can tell a client
          edit from a developer edit exactly instead of guessing from timestamps.
        </s-paragraph>
        {job && (
          <div style={{ margin: "12px 0" }}>
            <JobProgress jobId={job.id} label={job.label} onDone={() => setFinishedJob(job.id)} />
          </div>
        )}
        {tools.data?.error && (
          <s-banner tone="critical">
            <s-paragraph>{tools.data.error}</s-paragraph>
          </s-banner>
        )}
        <div className="tm-col" style={{ marginTop: 12 }}>
          <tools.Form method="post" className="tm-row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="intent" value="workingCopy" />
            <input type="hidden" name="sourceThemeId" value={main?.id ?? ""} />
            <label className="tm-field tm-grow">
              <span>New working copy of {main?.name ?? "the published theme"}</span>
              <input className="tm-input" name="name" placeholder={`${main?.name ?? "Theme"} (working copy)`} maxLength={50} />
            </label>
            <button className="tm-btn" type="submit" disabled={!writesEnabled || !main}>
              Duplicate + record baseline
            </button>
          </tools.Form>
          {!writesEnabled && (
            <span className="tm-muted">
              Duplicating needs theme write access (THEME_WRITES_ENABLED + Shopify&apos;s exemption). Until then, duplicate the theme
              in the Shopify admin and record its baseline right away below.
            </span>
          )}
          <tools.Form method="post" className="tm-row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="intent" value="recordBaseline" />
            <input type="hidden" name="sourceThemeId" value={main?.id ?? ""} />
            <label className="tm-field tm-grow">
              <span>I just duplicated it myself — record the baseline for</span>
              <select className="tm-select" name="workingThemeId" defaultValue={others[0]?.id}>
                {themes
                  .filter((t) => t.role !== "MAIN")
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <button className="tm-btn" type="submit" disabled={!main}>
              Record baseline
            </button>
          </tools.Form>
          <span className="tm-muted">Only correct if nobody has edited the live theme since the copy was made.</span>
          <tools.Form method="post" className="tm-row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="intent" value="snapshot" />
            <label className="tm-field tm-grow">
              <span>Snapshot a theme now</span>
              <select className="tm-select" name="themeId" defaultValue={main?.id}>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="tm-field tm-grow">
              <span>Label (optional)</span>
              <input className="tm-input" name="label" placeholder="Before Black Friday" />
            </label>
            <button className="tm-btn" type="submit">
              Take snapshot
            </button>
          </tools.Form>
        </div>
      </s-section>

      {snapshots.length > 0 && (
        <s-section heading="Snapshots">
          <table className="tm-table">
            <thead>
              <tr>
                <th>Theme</th>
                <th>Why</th>
                <th>Files</th>
                <th>Taken</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.themeName}
                    {s.label && <div className="tm-muted">{s.label}</div>}
                  </td>
                  <td>{s.reason}</td>
                  <td>{s.files}</td>
                  <td className="tm-nowrap">{formatDate(s.createdAt)}</td>
                  <td>
                    <tools.Form method="post">
                      <input type="hidden" name="intent" value="deleteSnapshot" />
                      <input type="hidden" name="snapshotId" value={s.id} />
                      <button className="tm-btn tm-btn--small" type="submit">
                        Delete
                      </button>
                    </tools.Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
/** Published state and the edit date, so the newest themes are identifiable at a glance. */
function themeOptionLabel(t: { name: string; role: string; createdAt: string; updatedAt: string }) {
  const role = t.role === "MAIN" ? "published" : t.role.toLowerCase();
  return `${t.name} — ${role}, edited ${formatDate(t.updatedAt)}`;
}
