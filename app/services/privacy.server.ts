/**
 * Data retention. ThemeMerge stores theme files and merge decisions — no customer data.
 */
import db from "../db.server";

/** Removes everything stored for a shop (shop/redact, 48h after uninstall). */
export async function purgeShopData(shop: string) {
  await db.$transaction([
    db.themeMerge.deleteMany({ where: { shop } }),
    db.themeLink.deleteMany({ where: { shop } }),
    db.themeSnapshot.deleteMany({ where: { shop } }),
    db.job.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
}
