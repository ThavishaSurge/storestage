import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { describeError } from "../services/admin.server";
import { themeWritesEnabled } from "../services/flags.server";
import { setFileResolution, startApply, type ApplyMode } from "../services/themeMerge.server";
import type { Resolution } from "../lib/theme/compare";
import { downloadFile, formatDate, JobProgress, Stat, StatusBadge } from "../components/ui";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merge = await db.themeMerge.findFirst({ where: { id: String(params.id), shop: session.shop } });
  if (!merge) throw new Response("Not found", { status: 404 });
  const files = await db.themeMergeFile.findMany({
    where: { mergeId: merge.id },
    orderBy: { filename: "asc" },
    select: { filename: true, kind: true, status: true, reason: true, resolution: true, resolved: true, conflictCount: true, presence: true },
  });
  const applyJob = await db.job.findFirst({
    where: { shop: session.shop, type: "theme.apply", payload: { contains: merge.id } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, result: true, error: true },
  });
  return {
    merge: {
      id: merge.id,
      kind: merge.kind,
      liveThemeName: merge.liveThemeName,
      targetThemeName: merge.targetThemeName,
      liveShop: merge.liveShop,
      targetShop: merge.targetShop,
      mode: merge.mode,
      status: merge.status,
      jobId: merge.jobId,
      forkTime: merge.forkTime?.toISOString() ?? null,
      createdAt: merge.createdAt.toISOString(),
      appliedAt: merge.appliedAt?.toISOString() ?? null,
      summary: merge.summary ? (JSON.parse(merge.summary) as { counts: Record<string, number>; unresolved: number; total: number }) : null,
    },
    files: files.map((f) => ({ ...f, presence: JSON.parse(f.presence) as { base: boolean | null; live: boolean; target: boolean } })),
    applyJob: applyJob ? { ...applyJob, result: applyJob.result ? (JSON.parse(applyJob.result) as Record<string, unknown>) : null } : null,
    writesEnabled: themeWritesEnabled(),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "resolution") {
      await setFileResolution(session.shop, String(params.id), String(form.get("filename")), String(form.get("resolution")) as Resolution);
      return { ok: true };
    }
    if (intent === "apply") {
      const mode: ApplyMode = form.get("applyMode") === "new-copy" ? "new-copy" : "in-place";
      const jobId = await startApply(session.shop, String(params.id), mode);
      return { jobId };
    }
    throw new Error(`Unknown action ${intent}`);
  } catch (error) {
    return { error: describeError(error) };
  }
};

const FILTERS: { id: string; label: string; match: (f: { status: string; resolved: boolean }) => boolean }[] = [
  { id: "attention", label: "Needs decision", match: (f) => !f.resolved },
  { id: "all", label: "All changed", match: () => true },
  { id: "live-changed", label: "Changed on live", match: (f) => f.status === "live-changed" },
  { id: "target-changed", label: "Changed in copy", match: (f) => f.status === "target-changed" },
  { id: "auto-merged", label: "Auto-merged", match: (f) => f.status === "auto-merged" },
  { id: "conflict", label: "Conflicts", match: (f) => f.status === "conflict" },
];

const RESOLUTION_LABELS: Record<string, string> = {
  keep: "Keep working copy version",
  live: "Take live version",
  merged: "Use merged result",
  delete: "Delete file",
};

export default function MergePage() {
  const { merge, files, applyJob, writesEnabled } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const action = useFetcher<{ ok?: boolean; jobId?: string; error?: string }>();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const crossStore = merge.kind === "cross-store";
  const unresolved = files.filter((f) => !f.resolved).length;
  const defaultFilter = unresolved ? "attention" : "all";
  const filterId = params.get("filter") ?? defaultFilter;
  const filter = FILTERS.find((f) => f.id === filterId) ?? FILTERS[1];
  const visible = files.filter(filter.match);
  const sideLabel = crossStore ? "staging" : "working copy";
  const jobId = action.data?.jobId ?? (applyJob && ["queued", "running"].includes(applyJob.status) ? applyJob.id : null);
  const applyDisabled = !writesEnabled || unresolved > 0 || merge.status !== "ready" || Boolean(jobId);
  const applyBlockedReason = !writesEnabled ? "Theme writes are disabled" : unresolved ? "Resolve every file first" : "";

  if (merge.status === "analyzing" && merge.jobId) {
    return (
      <s-page heading="Analyzing themes">
        <s-section>
          <JobProgress jobId={merge.jobId} label={`Comparing ${merge.liveThemeName} and ${merge.targetThemeName}`} />
        </s-section>
      </s-page>
    );
  }

  const download = async (full = false) => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadFile(
        `/app/themes/merge/${merge.id}/export${full ? "?full=1" : ""}`,
        full ? "theme-merged.zip" : "theme-merge.zip",
      );
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <s-page heading={`${merge.liveThemeName} → ${merge.targetThemeName}`}>
      <s-section>
        <div className="ss-row" style={{ justifyContent: "space-between" }}>
          <div className="ss-col">
            <div className="ss-row">
              <StatusBadge status={merge.status} />
              <s-badge tone={merge.mode === "three-way" ? "success" : "info"}>{merge.mode}</s-badge>
              {crossStore && <s-badge tone="info">staging → live</s-badge>}
            </div>
            <span className="ss-muted">
              {crossStore
                ? `Live theme on ${merge.liveShop}, staging theme on ${merge.targetShop}.`
                : merge.mode === "heuristic" && merge.forkTime
                  ? `Changes attributed by timestamp; working copy created ${formatDate(merge.forkTime)}.`
                  : `Compared ${formatDate(merge.createdAt)}.`}
            </span>
          </div>
          <div className="ss-row">
            <button className="ss-btn" type="button" onClick={() => download(false)} disabled={downloading || merge.status === "failed"}>
              {downloading ? "Preparing…" : "Download changed files"}
            </button>
            <button
              className="ss-btn"
              type="button"
              onClick={() => download(true)}
              disabled={downloading || unresolved > 0 || merge.status !== "ready"}
              title={unresolved ? "Resolve every file first" : "Every file of the merged theme, ready to upload as a new theme"}
            >
              {downloading ? "Preparing…" : "Download full theme"}
            </button>
            <action.Form method="post" className="ss-row">
              <input type="hidden" name="intent" value="apply" />
              {!crossStore && (
                <button
                  className="ss-btn"
                  type="submit"
                  name="applyMode"
                  value="new-copy"
                  disabled={applyDisabled}
                  title={applyBlockedReason || "Duplicates the working copy and writes the merged result into the duplicate"}
                >
                  Create merged theme
                </button>
              )}
              <button
                className="ss-btn ss-btn--primary"
                type="submit"
                name="applyMode"
                value="in-place"
                disabled={applyDisabled}
                title={applyBlockedReason}
              >
                {crossStore ? "Create merged copy on live" : "Apply to working copy"}
              </button>
            </action.Form>
          </div>
        </div>

        {downloadError && (
          <s-banner tone="critical">
            <s-paragraph>{downloadError}</s-paragraph>
          </s-banner>
        )}
        {action.data?.error && (
          <s-banner tone="critical">
            <s-paragraph>{action.data.error}</s-paragraph>
          </s-banner>
        )}
        {jobId && (
          <div style={{ marginTop: 12 }}>
            <JobProgress jobId={jobId} label="Writing theme files" />
          </div>
        )}
        {!jobId && applyJob?.status === "failed" && merge.status === "ready" && (
          <s-banner tone="critical" heading="Apply failed">
            <s-paragraph>{applyJob.error}</s-paragraph>
            <s-paragraph>Your decisions are saved — fix the problem and apply again.</s-paragraph>
          </s-banner>
        )}
        {merge.status === "applied" && (
          <s-banner tone="success" heading="Applied">
            <s-paragraph>
              {crossStore
                ? `Merged copy created on the live store${applyJob?.result?.themeName ? ` as "${String(applyJob.result.themeName)}"` : ""}. Preview it in Online Store → Themes, then publish.`
                : applyJob?.result?.themeName
                  ? `Merged theme created as "${String(applyJob.result.themeName)}", with the working copy left untouched. Preview it in Online Store → Themes, then publish.`
                  : `The working copy now contains the client's live changes. Preview it, then publish it from Online Store → Themes.`}{" "}
              Applied {formatDate(merge.appliedAt)}.
            </s-paragraph>
          </s-banner>
        )}
        {!writesEnabled && merge.status === "ready" && (
          <s-banner tone="info">
            <s-paragraph>
              Theme writes are disabled until Shopify grants the theme-write exemption. Use <strong>Download full theme</strong> and
              upload the zip under Online Store → Themes → Add theme → Upload zip file; Shopify creates a new unpublished theme you
              can preview and publish. <strong>Download changed files</strong> gives just the diff plus the matching{" "}
              <code>shopify theme push</code> command in MERGE-REPORT.md.
            </s-paragraph>
          </s-banner>
        )}

        {merge.summary && (
          <div className="ss-row" style={{ marginTop: 12 }}>
            <Stat label="Need a decision" value={unresolved} />
            <Stat label="Changed on live" value={merge.summary.counts["live-changed"] ?? 0} />
            <Stat label={`Changed in ${sideLabel}`} value={merge.summary.counts["target-changed"] ?? 0} />
            <Stat label="Auto-merged" value={merge.summary.counts["auto-merged"] ?? 0} />
            <Stat label="Unchanged" value={merge.summary.counts.unchanged ?? 0} />
          </div>
        )}
      </s-section>

      <s-section heading="Files">
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
              {f.label} ({files.filter(f.match).length})
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <div className="ss-muted">Nothing here.</div>
        ) : (
          <table className="ss-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Result in {crossStore ? "live copy" : "working copy"}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => (
                <FileRow key={f.filename} mergeId={merge.id} file={f} applied={merge.status === "applied"} />
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}

function FileRow({
  mergeId,
  file,
  applied,
}: {
  mergeId: string;
  applied: boolean;
  file: { filename: string; kind: string; status: string; reason: string; resolution: string; resolved: boolean; conflictCount: number; presence: { live: boolean; target: boolean } };
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const options = ["keep", "live", ...(file.status === "auto-merged" || file.status === "conflict" ? ["merged"] : []), "delete"].filter(
    (o) => !(o === "live" && !file.presence.live) && !(o === "keep" && !file.presence.target && file.status !== "target-changed"),
  );
  const pending = fetcher.state !== "idle";
  const current = (fetcher.formData?.get("resolution") as string) ?? file.resolution;
  return (
    <tr>
      <td className="ss-break">
        <Link to={`/app/themes/merge/${mergeId}/file?f=${encodeURIComponent(file.filename)}`} className="ss-mono">
          {file.filename}
        </Link>
        <div className="ss-muted">{file.reason}</div>
        {fetcher.data?.error && <div style={{ color: "#8e1f0b", fontSize: 12 }}>{fetcher.data.error}</div>}
      </td>
      <td className="ss-nowrap">
        <div className="ss-col" style={{ gap: 4 }}>
          <StatusBadge status={file.status} />
          {!file.resolved && (
            <s-badge tone="warning">{file.conflictCount > 1 ? `${file.conflictCount} to decide` : "Decide"}</s-badge>
          )}
        </div>
      </td>
      <td>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="resolution" />
          <input type="hidden" name="filename" value={file.filename} />
          <select
            className="ss-select"
            name="resolution"
            value={current}
            disabled={pending || applied}
            onChange={(e) => fetcher.submit(e.currentTarget.form)}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {RESOLUTION_LABELS[o]}
              </option>
            ))}
          </select>
        </fetcher.Form>
      </td>
    </tr>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
