/**
 * Store pairing: the same app is installed on both stores; a short-lived code links them.
 * Generate the code on one store, enter it on the other. The code says which role the
 * issuing store plays, so either side can start.
 */
import { randomInt } from "node:crypto";
import db from "../db.server";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const CODE_TTL_MS = 15 * 60 * 1000;

export type StoreRole = "staging" | "live";

export interface PairInfo {
  id: string;
  role: StoreRole;
  stagingShop: string;
  liveShop: string;
  otherShop: string;
  clonedAt: Date | null;
  baselineSnapshotId: string | null;
}

function generateCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export async function createPairingCode(shop: string, role: StoreRole) {
  await db.pairingCode.deleteMany({ where: { OR: [{ shop }, { expiresAt: { lt: new Date() } }] } });
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await db.pairingCode.create({ data: { code, shop, role, expiresAt } });
  return { code, expiresAt, role };
}

export async function activePairingCode(shop: string) {
  return db.pairingCode.findFirst({ where: { shop, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
}

export async function redeemPairingCode(shop: string, rawCode: string): Promise<PairInfo> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");
  const record = await db.pairingCode.findUnique({ where: { code } });
  if (!record || record.expiresAt < new Date()) throw new Error("That code is invalid or expired. Generate a new one on the other store.");
  if (record.shop === shop) throw new Error("That code was generated on this store. Enter it on the other store.");

  const stagingShop = record.role === "staging" ? record.shop : shop;
  const liveShop = record.role === "live" ? record.shop : shop;

  const existing = await db.storePair.findFirst({
    where: { OR: [{ stagingShop: { in: [stagingShop, liveShop] } }, { liveShop: stagingShop }] },
  });
  if (existing) throw new Error(`${existing.stagingShop} is already paired. Unpair it first.`);

  const sessions = await db.session.count({ where: { shop: { in: [stagingShop, liveShop] }, isOnline: false } });
  if (sessions < 2) throw new Error("Both stores need the app installed before pairing.");

  const pair = await db.storePair.create({ data: { stagingShop, liveShop } });
  await db.pairingCode.delete({ where: { code } });
  return toInfo(pair, shop);
}

function toInfo(
  pair: { id: string; stagingShop: string; liveShop: string; clonedAt: Date | null; baselineSnapshotId: string | null },
  shop: string,
): PairInfo {
  const role: StoreRole = pair.stagingShop === shop ? "staging" : "live";
  return {
    id: pair.id,
    role,
    stagingShop: pair.stagingShop,
    liveShop: pair.liveShop,
    otherShop: role === "staging" ? pair.liveShop : pair.stagingShop,
    clonedAt: pair.clonedAt,
    baselineSnapshotId: pair.baselineSnapshotId,
  };
}

export async function getPairForShop(shop: string): Promise<PairInfo | null> {
  const pair = await db.storePair.findFirst({ where: { OR: [{ stagingShop: shop }, { liveShop: shop }] } });
  return pair ? toInfo(pair, shop) : null;
}

export async function unpair(shop: string) {
  const pair = await db.storePair.findFirst({ where: { OR: [{ stagingShop: shop }, { liveShop: shop }] } });
  if (!pair) return;
  await db.storePair.delete({ where: { id: pair.id } });
}
