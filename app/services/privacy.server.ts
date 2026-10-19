/**
 * Data retention. StoreStage stores theme files and catalog/content snapshots — no customer data.
 */
import db from "../db.server";

/** Removes everything stored for a shop (shop/redact, 48h after uninstall). */
export async function purgeShopData(shop: string) {
  const pairs = await db.storePair.findMany({ where: { OR: [{ stagingShop: shop }, { liveShop: shop }] }, select: { id: true } });
  const pairIds = pairs.map((p) => p.id);
  await db.$transaction([
    db.promotion.deleteMany({ where: { pairId: { in: pairIds } } }),
    db.storeCompare.deleteMany({ where: { pairId: { in: pairIds } } }),
    db.storeSnapshot.deleteMany({ where: { OR: [{ pairId: { in: pairIds } }, { shop }] } }),
    db.storePair.deleteMany({ where: { id: { in: pairIds } } }),
    db.pairingCode.deleteMany({ where: { shop } }),
    db.themeMerge.deleteMany({ where: { OR: [{ shop }, { liveShop: shop }, { targetShop: shop }] } }),
    db.themeLink.deleteMany({ where: { shop } }),
    db.themeSnapshot.deleteMany({ where: { shop } }),
    db.job.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
}
