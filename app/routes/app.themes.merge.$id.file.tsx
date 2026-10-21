import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { describeError } from "../services/admin.server";
import { decideAll, setConflictDecision, setCustomContent, setFileResolution } from "../services/themeMerge.server";
import { lineDiff, diffStats, type DiffRow } from "../lib/merge/lineDiff";
import type { FileMergeData, Resolution } from "../lib/theme/compare";
import { DiffView, JsonBlock, StatusBadge } from "../components/ui";

const MAX_DIFF_CHARS = 400_000;

function safeDiff(a: string | null, b: string | null): DiffRow[] | null {
  if (a === null || b === null) return null;
  if (a.length + b.length > MAX_DIFF_CHARS) return null;
  return lineDiff(a, b);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const filename = new URL(request.url).searchParams.get("f") ?? "";
  const merge = await db.themeMerge.findFirst({ where: { id: String(params.id), shop: session.shop } });
  if (!merge) throw new Response("Not found", { status: 404 });
  const file = await db.themeMergeFile.findUnique({ where: { mergeId_filename: { mergeId: merge.id, filename } } });
  if (!file) throw new Response("File not found", { status: 404 });

  const text = file.encoding === "text" && file.kind !== "binary";
  const data = file.mergeData ? (JSON.parse(file.mergeData) as FileMergeData) : null;
  const finalBody =
    file.resolution === "live" ? file.liveBody : file.resolution === "merged" ? file.resultBody : file.resolution === "delete" ? null : file.targetBody;

  return {
    merge: { id: merge.id, liveThemeName: merge.liveThemeName, targetThemeName: merge.targetThemeName, status: merge.status },
    file: {
      filename: file.filename,
      kind: file.kind,
      status: file.status,
      reason: file.reason,
      resolution: file.resolution,
      resolved: file.resolved,
      presence: JSON.parse(file.presence) as { base: boolean | null; live: boolean; target: boolean },
      hasBase: file.baseBody !== null,
      text,
    },
    diffs: text
      ? {
          liveVsTarget: safeDiff(file.liveBody ?? "", file.targetBody ?? ""),
          baseVsLive: file.baseBody !== null ? safeDiff(file.baseBody, file.liveBody ?? "") : null,
          baseVsTarget: file.baseBody !== null ? safeDiff(file.baseBody, file.targetBody ?? "") : null,
          resultVsTarget: finalBody !== null ? safeDiff(file.targetBody ?? "", finalBody) : null,
        }
      : null,
    mergeData: data,
    resultBody: file.resultBody ?? file.targetBody ?? file.liveBody ?? "",
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const mergeId = String(params.id);
  const filename = String(form.get("filename"));
  try {
    switch (String(form.get("intent"))) {
      case "decide":
        await setConflictDecision(session.shop, mergeId, filename, String(form.get("conflictId")), String(form.get("decision")) as never);
        break;
      case "decideAll":
        await decideAll(session.shop, mergeId, filename, String(form.get("decision")) as "left" | "right");
        break;
      case "custom":
        await setCustomContent(session.shop, mergeId, filename, String(form.get("content") ?? ""));
        break;
      case "resolution":
        await setFileResolution(session.shop, mergeId, filename, String(form.get("resolution")) as Resolution);
        break;
    }
    return { ok: true };
  } catch (error) {
    return { error: describeError(error) };
  }
};

export default function FilePage() {
  const { merge, file, diffs, mergeData, resultBody } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [tab, setTab] = useState<string>(mergeData ? "conflicts" : "diff");
  const [editing, setEditing] = useState(false);
  const leftName = `Live (${merge.liveThemeName})`;
  const rightName = `Working copy (${merge.targetThemeName})`;
  const locked = merge.status === "applied";

  const submit = (fields: Record<string, string>) => fetcher.submit({ filename: file.filename, ...fields }, { method: "post" });

  const tabs: { id: string; label: string; show: boolean }[] = [
    { id: "conflicts", label: "Decisions", show: Boolean(mergeData) },
    { id: "diff", label: "Live vs copy", show: Boolean(diffs) },
    { id: "base", label: "What each side changed", show: Boolean(diffs?.baseVsLive || diffs?.baseVsTarget) },
    { id: "result", label: "Result", show: Boolean(diffs) },
  ];

  return (
    <s-page heading={file.filename}>
      <s-section>
        <div className="tm-row" style={{ justifyContent: "space-between" }}>
          <div className="tm-col">
            <div className="tm-row">
              <StatusBadge status={file.status} />
              {!file.resolved && <s-badge tone="warning">Needs decision</s-badge>}
              <span className="tm-muted">{file.reason}</span>
            </div>
            <Link to={`/app/themes/merge/${merge.id}`}>← Back to all files</Link>
          </div>
          <div className="tm-row">
            <span className="tm-muted">Result:</span>
            {(["keep", "live", ...(mergeData ? ["merged"] : []), "delete"] as const).map((r) => (
              <button
                key={r}
                type="button"
                disabled={locked || (r === "live" && !file.presence.live)}
                className={`tm-btn tm-btn--small ${file.resolution === r ? "tm-btn--active" : ""}`}
                onClick={() => submit({ intent: "resolution", resolution: r })}
              >
                {r === "keep" ? "Copy version" : r === "live" ? "Live version" : r === "merged" ? "Merged" : "Delete"}
              </button>
            ))}
          </div>
        </div>
        {fetcher.data?.error && (
          <s-banner tone="critical">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        )}
      </s-section>

      {!file.text ? (
        <s-section heading="Binary file">
          <s-paragraph>
            Binary assets are compared by checksum. Choose which version the theme should keep with the buttons above.
          </s-paragraph>
        </s-section>
      ) : (
        <s-section>
          <div className="tm-tabs" style={{ marginBottom: 12 }}>
            {tabs
              .filter((t) => t.show)
              .map((t) => (
                <button key={t.id} type="button" className={`tm-btn tm-btn--small ${tab === t.id ? "tm-btn--active" : ""}`} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
          </div>

          {tab === "conflicts" && mergeData && (
            <Decisions data={mergeData} leftName={leftName} rightName={rightName} locked={locked} onDecide={(conflictId, decision) => submit({ intent: "decide", conflictId, decision })} onAll={(decision) => submit({ intent: "decideAll", decision })} />
          )}

          {tab === "diff" && diffs && (
            <div className="tm-col">
              <span className="tm-muted">
                Red = live, green = working copy.
              </span>
              {diffs.liveVsTarget ? <DiffView rows={diffs.liveVsTarget} empty="Identical" /> : <span className="tm-muted">File too large to diff in the browser.</span>}
            </div>
          )}

          {tab === "base" && diffs && (
            <div className="tm-col">
              <s-heading>Changed on live since the baseline</s-heading>
              {diffs.baseVsLive ? <DiffView rows={diffs.baseVsLive} empty="No changes on live" /> : <span className="tm-muted">Not available</span>}
              <s-heading>Changed in the working copy since the baseline</s-heading>
              {diffs.baseVsTarget ? <DiffView rows={diffs.baseVsTarget} empty="No changes in the copy" /> : <span className="tm-muted">Not available</span>}
            </div>
          )}

          {tab === "result" && diffs && (
            <div className="tm-col">
              <div className="tm-row" style={{ justifyContent: "space-between" }}>
                <span className="tm-muted">
                  {file.resolution === "delete" ? "The file will be deleted." : "How the file will change compared with the working copy."}
                  {diffs.resultVsTarget && ` ${diffStats(diffs.resultVsTarget).added} added, ${diffStats(diffs.resultVsTarget).removed} removed.`}
                </span>
                {!locked && (
                  <button className="tm-btn tm-btn--small" type="button" onClick={() => setEditing((e) => !e)}>
                    {editing ? "Cancel editing" : "Edit result by hand"}
                  </button>
                )}
              </div>
              {editing ? (
                <fetcher.Form method="post" className="tm-col" onSubmit={() => setEditing(false)}>
                  <input type="hidden" name="intent" value="custom" />
                  <input type="hidden" name="filename" value={file.filename} />
                  <textarea className="tm-textarea" name="content" defaultValue={resultBody} spellCheck={false} />
                  <div>
                    <button className="tm-btn tm-btn--primary" type="submit">
                      Save as result
                    </button>
                  </div>
                </fetcher.Form>
              ) : diffs.resultVsTarget ? (
                <DiffView rows={diffs.resultVsTarget} empty="Same as the working copy" />
              ) : null}
            </div>
          )}
        </s-section>
      )}
    </s-page>
  );
}

function Decisions({
  data,
  leftName,
  rightName,
  locked,
  onDecide,
  onAll,
}: {
  data: FileMergeData;
  leftName: string;
  rightName: string;
  locked: boolean;
  onDecide: (conflictId: string, decision: string) => void;
  onAll: (decision: "left" | "right") => void;
}) {
  const total = data.mode === "json" ? data.conflicts.length : data.regions.filter((r) => r.type === "conflict").length;
  const decided = data.mode === "json" ? Object.keys(data.decisions).length : Object.keys(data.decisions).length;

  if (total === 0) {
    return (
      <s-banner tone="success">
        <s-paragraph>Merged automatically: both sides&apos; changes were combined without overlap. Check the Result tab.</s-paragraph>
      </s-banner>
    );
  }

  return (
    <div className="tm-col">
      <div className="tm-row" style={{ justifyContent: "space-between" }}>
        <span>
          <strong>
            {decided}/{total}
          </strong>{" "}
          decided. {data.mode === "json" ? "Theme-editor settings that both sides changed:" : "Code both sides changed:"}
        </span>
        {!locked && (
          <div className="tm-row">
            <button className="tm-btn tm-btn--small" type="button" onClick={() => onAll("left")}>
              All live
            </button>
            <button className="tm-btn tm-btn--small" type="button" onClick={() => onAll("right")}>
              All copy
            </button>
          </div>
        )}
      </div>

      {data.mode === "json"
        ? data.conflicts.map((c) => {
            const decision = data.decisions[c.id];
            return (
              <div key={c.id} className={`tm-hunk ${decision ? "tm-hunk--decided" : ""}`}>
                <div className="tm-hunk__head">
                  <span className="tm-mono tm-break">{c.id}</span>
                  <span className="tm-muted">{c.kind === "delete-modify" ? "Deleted on one side, changed on the other" : c.kind === "order" ? "Re-ordered differently" : "Changed on both sides"}</span>
                  <DecisionButtons locked={locked} current={typeof decision === "string" ? decision : undefined} onPick={(d) => onDecide(c.id, d)} text={false} />
                </div>
                <div className="tm-hunk__sides">
                  <div className="tm-hunk__side">
                    <div className="tm-hunk__label">{leftName}</div>
                    <JsonBlock value={c.left} />
                  </div>
                  <div className="tm-hunk__side">
                    <div className="tm-hunk__label">{rightName}</div>
                    <JsonBlock value={c.right} />
                  </div>
                </div>
                {c.base !== undefined && (
                  <details style={{ padding: "4px 8px" }}>
                    <summary className="tm-muted">Original value</summary>
                    <JsonBlock value={c.base} />
                  </details>
                )}
              </div>
            );
          })
        : data.regions.map((r, i) => {
            if (r.type !== "conflict") return null;
            const before = data.regions[i - 1];
            const context = before && before.type === "ok" ? before.lines.slice(-3).join("") : "";
            const decision = data.decisions[r.id];
            return (
              <div key={r.id} className={`tm-hunk ${decision ? "tm-hunk--decided" : ""}`}>
                <div className="tm-hunk__head">
                  <span className="tm-muted">Hunk {r.id + 1}</span>
                  <DecisionButtons locked={locked} current={typeof decision === "string" ? decision : undefined} onPick={(d) => onDecide(String(r.id), d)} text />
                </div>
                {context && <pre className="tm-context">{context}</pre>}
                <div className="tm-hunk__sides">
                  <div className="tm-hunk__side">
                    <div className="tm-hunk__label">{leftName}</div>
                    <pre>{r.left.join("") || "(nothing)"}</pre>
                  </div>
                  <div className="tm-hunk__side">
                    <div className="tm-hunk__label">{rightName}</div>
                    <pre>{r.right.join("") || "(nothing)"}</pre>
                  </div>
                </div>
              </div>
            );
          })}
    </div>
  );
}

function DecisionButtons({ current, onPick, text, locked }: { current?: string; onPick: (d: string) => void; text: boolean; locked: boolean }) {
  const options = text
    ? [
        ["left", "Live"],
        ["right", "Copy"],
        ["left-then-right", "Both (live first)"],
        ["right-then-left", "Both (copy first)"],
      ]
    : [
        ["left", "Live"],
        ["right", "Copy"],
      ];
  return (
    <div className="tm-row">
      {options.map(([value, label]) => (
        <button key={value} type="button" disabled={locked} className={`tm-btn tm-btn--small ${current === value ? "tm-btn--active" : ""}`} onClick={() => onPick(value)}>
          {label}
        </button>
      ))}
      {current && !locked && (
        <button type="button" className="tm-btn tm-btn--small" onClick={() => onPick("clear")}>
          Undo
        </button>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
