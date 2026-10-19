/**
 * Integration test harness: a real Prisma client on a throwaway Postgres, with FakeStores
 * standing in for Shopify.
 *
 * Postgres runs in-process via PGlite, so the suite needs no database server and the committed
 * migration SQL is applied exactly as it would be in production. Set DATABASE_URL_TEST to run
 * against a real Postgres instead (its public schema is dropped and recreated).
 */
import fs from "node:fs";
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
  const migrations = migrationSql();
  if (process.env.DATABASE_URL_TEST) {
    const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS public CASCADE`);
    for (const sql of migrations) await prisma.$executeRawUnsafe(sql);
    globalThis.prismaGlobal = prisma;
    return { prisma, cleanup: () => prisma.$disconnect() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { PrismaPGlite } = await import("pglite-prisma-adapter");
  const pglite = new PGlite(); // in-memory
  // exec() takes whole migration files, so no statement splitting to get wrong.
  for (const sql of migrations) await pglite.exec(sql);
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) } as never);

  globalThis.prismaGlobal = prisma;
  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      await pglite.close();
    },
  };
}

/** The committed migrations, oldest first. */
function migrationSql(): string[] {
  const dir = path.resolve(__dirname, "../../prisma/migrations");
  return fs
    .readdirSync(dir)
    .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
    .sort()
    .map((d) => fs.readFileSync(path.join(dir, d, "migration.sql"), "utf8"));
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
