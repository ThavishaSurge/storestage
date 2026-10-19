/**
 * Minimal durable job queue backed by the database.
 *
 * Long-running work (theme analysis, store clone/compare/promote) runs here instead of in a
 * request. A single in-process worker polls for queued jobs; jobs left "running" by a crash are
 * re-queued on boot. For multi-instance deployments replace this with a real queue (e.g. BullMQ)
 * — the handler signatures stay the same.
 */
import db from "../db.server";

export interface JobContext {
  jobId: string;
  shop: string;
  progress: (fraction: number, message?: string) => Promise<void>;
}

export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

declare global {
  // eslint-disable-next-line no-var
  var __storestageWorker: { started: boolean; busy: boolean; timer?: ReturnType<typeof setInterval> } | undefined;
}

export async function enqueueJob(shop: string, type: string, payload: Record<string, unknown>): Promise<string> {
  const job = await db.job.create({ data: { shop, type, payload: JSON.stringify(payload) } });
  ensureWorker();
  setImmediate(() => void tick());
  return job.id;
}

export async function getJob(id: string, shop: string) {
  const job = await db.job.findFirst({ where: { id, shop } });
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    status: job.status as "queued" | "running" | "done" | "failed",
    progress: job.progress,
    message: job.message,
    error: job.error,
    result: job.result ? (JSON.parse(job.result) as unknown) : null,
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function ensureWorker() {
  if (globalThis.__storestageWorker?.started) return;
  globalThis.__storestageWorker = { started: true, busy: false };
  // Re-queue jobs interrupted by a restart.
  void db.job.updateMany({ where: { status: "running" }, data: { status: "queued", message: "Restarted after interruption" } });
  globalThis.__storestageWorker.timer = setInterval(() => void tick(), 2000);
}

async function tick() {
  const worker = globalThis.__storestageWorker;
  if (!worker || worker.busy) return;
  worker.busy = true;
  try {
    for (;;) {
      const job = await db.job.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
      if (!job) break;
      const claimed = await db.job.updateMany({ where: { id: job.id, status: "queued" }, data: { status: "running", progress: 0 } });
      if (claimed.count === 0) continue;
      await run(job.id, job.shop, job.type, job.payload);
    }
  } finally {
    worker.busy = false;
  }
}

async function run(id: string, shop: string, type: string, payload: string) {
  const handler = handlers.get(type);
  if (!handler) {
    await db.job.update({ where: { id }, data: { status: "failed", error: `No handler for job type ${type}` } });
    return;
  }
  let lastWrite = 0;
  const ctx: JobContext = {
    jobId: id,
    shop,
    progress: async (fraction, message) => {
      const now = Date.now();
      if (now - lastWrite < 500 && fraction < 1) return; // throttle DB writes
      lastWrite = now;
      await db.job.update({
        where: { id },
        data: { progress: Math.max(0, Math.min(100, Math.round(fraction * 100))), ...(message ? { message } : {}) },
      });
    },
  };
  try {
    const result = await handler(JSON.parse(payload) as Record<string, unknown>, ctx);
    await db.job.update({
      where: { id },
      data: { status: "done", progress: 100, result: JSON.stringify(result ?? null), message: "Done" },
    });
  } catch (error) {
    console.error(`[jobs] ${type} ${id} failed`, error);
    await db.job.update({
      where: { id },
      data: { status: "failed", error: error instanceof Error ? error.message : String(error) },
    });
  }
}
