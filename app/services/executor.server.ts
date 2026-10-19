/**
 * Runs resource changes against a target store, in dependency order.
 * Shared by Clone (live -> staging), Promote (staging -> live) and Rollback.
 */
import { buildOperations, BuildError, type Operation } from "../lib/resources/build";
import type { RefIndex } from "../lib/resources/refs";
import { refId, type ResourceType } from "../lib/resources/types";
import { ONLINE_STORE_PUBLICATION } from "../lib/shopify/queries";
import { PUBLISHABLE_PUBLISH } from "../lib/shopify/mutations";
import { assertNoUserErrors, describeError, gql, type AdminClient } from "./admin.server";

export interface ExecutableChange {
  id?: string;
  type: ResourceType;
  key: string;
  title: string;
  action: "create" | "update" | "delete";
  data: Record<string, unknown> | null;
  liveData: Record<string, unknown> | null;
  transfer: Record<string, unknown> | null;
  liveGid: string | null;
}

export interface ExecutionResult {
  change: ExecutableChange;
  status: "done" | "failed" | "skipped";
  error?: string;
  /** GID of the resource on the target after the write (created or updated). */
  gid?: string | null;
  warnings: string[];
}

function dig(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => (acc === null || acc === undefined ? acc : (acc as Record<string, unknown>)[key]), value);
}

async function runOperation(admin: AdminClient, op: Operation): Promise<string | null> {
  const data = await gql<Record<string, unknown>>(admin, op.document, op.variables);
  const payload = data[op.root] as { userErrors?: { field?: string[] | null; message: string }[] } | null;
  assertNoUserErrors(payload, op.label);
  return op.idPath ? ((dig(payload, op.idPath) as string | undefined) ?? null) : null;
}

export async function onlineStorePublicationId(admin: AdminClient): Promise<string | null> {
  const data = await gql<{ publications: { nodes: { id: string; catalog: { title: string } | null }[] } }>(admin, ONLINE_STORE_PUBLICATION);
  return data.publications.nodes.find((p) => /online store/i.test(p.catalog?.title ?? ""))?.id ?? null;
}

export async function executeChanges(args: {
  admin: AdminClient;
  changes: ExecutableChange[];
  refIndex: RefIndex;
  publishCreated: boolean;
  onResult?: (result: ExecutionResult, index: number, total: number) => void | Promise<void>;
}): Promise<ExecutionResult[]> {
  const { admin, refIndex } = args;
  const results: ExecutionResult[] = [];
  let publicationId: string | null | undefined;

  // Changes whose references aren't on the target yet get one retry after everything else ran.
  let queue = [...args.changes];
  for (let pass = 0; pass < 2 && queue.length; pass++) {
    const deferred: ExecutableChange[] = [];
    for (const change of queue) {
      const warnings: string[] = [];
      let result: ExecutionResult;
      try {
        const built = buildOperations({
          type: change.type,
          key: change.key,
          action: change.action,
          data: change.data as never,
          liveData: change.liveData as never,
          transfer: change.transfer as never,
          liveGid: change.liveGid,
          refIndex,
        });
        if (built.missingRefs.length && pass === 0) {
          deferred.push(change);
          continue;
        }
        if (built.missingRefs.length) {
          throw new BuildError(`References missing on the target store: ${built.missingRefs.join(", ")}. Include them in this run.`);
        }

        let gid: string | null = change.liveGid;
        for (const op of built.operations) {
          try {
            const id = await runOperation(admin, op);
            if (op.critical && id) gid = id;
          } catch (error) {
            if (op.critical) throw error;
            warnings.push(describeError(error));
          }
        }

        if (change.action === "delete") {
          refIndex.delete(refId(change.type, change.key));
        } else if (gid) {
          refIndex.set(refId(change.type, change.key), gid);
        }

        if (change.action === "create" && gid && args.publishCreated && (change.type === "product" || change.type === "collection")) {
          try {
            if (publicationId === undefined) publicationId = await onlineStorePublicationId(admin);
            if (publicationId) {
              const data = await gql<{ publishablePublish: { userErrors: { field: string[] | null; message: string }[] } }>(admin, PUBLISHABLE_PUBLISH, {
                id: gid,
                publicationId,
              });
              assertNoUserErrors(data.publishablePublish, "Publishing to Online Store");
            }
          } catch (error) {
            warnings.push(`Created but not published: ${describeError(error)}`);
          }
        }
        result = { change, status: "done", gid, warnings };
      } catch (error) {
        result = { change, status: "failed", error: describeError(error), warnings };
      }
      results.push(result);
      await args.onResult?.(result, results.length, args.changes.length);
    }
    queue = deferred;
  }
  return results;
}
