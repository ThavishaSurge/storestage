import { useEffect, useRef } from "react";
import { useFetcher, useRevalidator } from "react-router";
import type { DiffRow } from "../lib/merge/lineDiff";

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/**
 * The ThemeMerge mark: an orange stroke (the live theme) and a blue stroke (the working copy)
 * meeting in one ink-coloured stem (the merged result).
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label="ThemeMerge"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M18 82 V32 L50 62" stroke="#ff7a1a" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M82 82 V32 L50 62" stroke="#2f6bff" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 62 V82" stroke="#15161a" strokeWidth="16" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <span className="tm-brand">
      <BrandMark className="tm-brand__mark" />
      <span className="tm-brand__name">ThemeMerge</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Job progress (polls /app/jobs/:id)
// ---------------------------------------------------------------------------

export interface JobStatus {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  message: string | null;
  error: string | null;
  result: unknown;
}

export function JobProgress({ jobId, label, onDone }: { jobId: string; label?: string; onDone?: (job: JobStatus) => void }) {
  const fetcher = useFetcher<{ job: JobStatus | null }>();
  const revalidator = useRevalidator();
  const finished = useRef(false);
  const job = fetcher.data?.job;

  useEffect(() => {
    finished.current = false;
    fetcher.load(`/app/jobs/${jobId}`);
    const timer = setInterval(() => {
      if (!finished.current && fetcher.state === "idle") fetcher.load(`/app/jobs/${jobId}`);
    }, 1500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    if (job && (job.status === "done" || job.status === "failed") && !finished.current) {
      finished.current = true;
      onDone?.(job);
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  if (!job) return <div className="tm-muted">Starting…</div>;
  if (job.status === "failed") {
    return (
      <s-banner tone="critical" heading={`${label ?? "Job"} failed`}>
        <s-paragraph>{job.error}</s-paragraph>
      </s-banner>
    );
  }
  if (job.status === "done") return null;
  return (
    <div className="tm-col">
      <div className="tm-row">
        <s-spinner size="base" accessibilityLabel="Working" />
        <strong>{label ?? "Working"}</strong>
        <span className="tm-muted">{job.message ?? (job.status === "queued" ? "Queued" : "Running")}</span>
      </div>
      <div className="tm-progress" aria-label={`${job.progress}%`}>
        <div style={{ width: `${Math.max(job.progress, 3)}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff view
// ---------------------------------------------------------------------------

export function DiffView({ rows, empty = "No differences" }: { rows: DiffRow[]; empty?: string }) {
  if (!rows.some((r) => r.type === "add" || r.type === "del")) return <div className="tm-muted">{empty}</div>;
  return (
    <div className="tm-diff">
      <table>
        <tbody>
          {rows.map((row, i) =>
            row.type === "skip" ? (
              <tr key={i} className="skip">
                <td colSpan={3}>… {row.count} unchanged line{row.count === 1 ? "" : "s"} …</td>
              </tr>
            ) : (
              <tr key={i} className={row.type === "same" ? "" : row.type}>
                <td className="ln">{row.oldNo ?? ""}</td>
                <td className="ln">{row.newNo ?? ""}</td>
                <td>
                  {row.type === "add" ? "+ " : row.type === "del" ? "- " : "  "}
                  {row.text}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

type Tone = "neutral" | "info" | "success" | "caution" | "warning" | "critical";

const STATUS_TONES: Record<string, { tone: Tone; label: string }> = {
  unchanged: { tone: "neutral", label: "Unchanged" },
  "live-changed": { tone: "info", label: "Changed on live" },
  "target-changed": { tone: "neutral", label: "Changed in copy" },
  "both-same": { tone: "neutral", label: "Same change" },
  "auto-merged": { tone: "success", label: "Auto-merged" },
  conflict: { tone: "critical", label: "Conflict" },
  create: { tone: "success", label: "Create" },
  update: { tone: "info", label: "Update" },
  delete: { tone: "warning", label: "Delete" },
  none: { tone: "neutral", label: "No action" },
  done: { tone: "success", label: "Done" },
  failed: { tone: "critical", label: "Failed" },
  partial: { tone: "warning", label: "Partial" },
  running: { tone: "info", label: "Running" },
  queued: { tone: "neutral", label: "Queued" },
  pending: { tone: "neutral", label: "Pending" },
  skipped: { tone: "neutral", label: "Skipped" },
  ready: { tone: "success", label: "Ready" },
  analyzing: { tone: "info", label: "Analyzing" },
  applied: { tone: "success", label: "Applied" },
  "rolled-back": { tone: "caution", label: "Rolled back" },
  "rollback-failed": { tone: "critical", label: "Rollback failed" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_TONES[status] ?? { tone: "neutral" as Tone, label: status };
  return <s-badge tone={s.tone}>{s.label}</s-badge>;
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="tm-stat">
      <strong>{value}</strong>
      <span className="tm-muted">{label}</span>
    </div>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return <pre className="tm-code">{value === undefined ? "(absent)" : JSON.stringify(value, null, 2)}</pre>;
}

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Strips the gid://shopify/OnlineStoreTheme/ prefix for display. */
export function shortId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

// ---------------------------------------------------------------------------
// Downloads (embedded app: fetch is authenticated by App Bridge)
// ---------------------------------------------------------------------------

export async function downloadFile(url: string, fallbackName: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(detail || `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
