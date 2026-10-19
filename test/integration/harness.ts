/**
 * Integration test harness: a real Prisma client on a throwaway SQLite file (schema created from
 * the committed migrations) and FakeStores standing in for Shopify.
 *
 * Runs with the standard Prisma engine. In sandboxes where Prisma's engine binaries can't be
 * downloaded, set PRISMA_TEST_ADAPTER=libsql (and install @prisma/adapter-libsql) to use a driver
 * adapter instead.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { FakeStore } from "../fakes/fakeShopify";

declare global {
  // eslint-disable-next-line no-var
  var __fakeStores: Record<string, FakeStore>;
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

export async function createTestDb(): Promise<{ prisma: PrismaClient; cleanup: () => Promise<void> }> {
  const file = path.join(os.tmpdir(), `storestage-test-${process.pid}-${Date.now()}.sqlite`);
  let prisma: PrismaClient;
  if (process.env.PRISMA_TEST_ADAPTER === "libsql") {
    const mod = (await import(/* @vite-ignore */ "@prisma/adapter-libsql" as string)) as { PrismaLibSQL: new (cfg: { url: string }) => unknown };
    prisma = new PrismaClient({ adapter: new mod.PrismaLibSQL({ url: `file:${file}` }) } as never);
  } else {
    prisma = new PrismaClient({ datasourceUrl: `file:${file}` });
  }

  const dir = path.resolve(__dirname, "../../prisma/migrations");
  for (const migration of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
    const sql = fs.readFileSync(path.join(dir, migration, "migration.sql"), "utf8");
    const statements = sql
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  }

  globalThis.prismaGlobal = prisma;
  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      fs.rmSync(file, { force: true });
    },
  };
}

export function registerStores(...stores: FakeStore[]) {
  globalThis.__fakeStores = Object.fromEntries(stores.map((s) => [s.shop, s]));
}

export async function addOfflineSession(prisma: PrismaClient, shop: string) {
  await prisma.session.create({ data: { id: `offline_${shop}`, shop, state: "x", isOnline: false, accessToken: "test-token", scope: "" } });
}

export async function waitForJob(prisma: PrismaClient, jobId: string, timeoutMs = 20_000) {
  const start = Date.now();
  for (;;) {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status === "done") return job.result ? (JSON.parse(job.result) as Record<string, unknown>) : null;
    if (job.status === "failed") throw new Error(`Job ${job.type} failed: ${job.error}`);
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${job.type} timed out (${job.status}, ${job.message})`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
