import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import type { AdminClient } from "../services/admin.server";
import { assertCanExport, UpgradeRequiredError } from "../services/billing.server";
import { buildExportZip, buildFullThemeZip } from "../services/themeMerge.server";

/**
 * `?full=1` → every file of the merged theme, ready to upload as a new theme.
 * Otherwise  → only the files that changed, plus MERGE-REPORT.md, for `shopify theme push`.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const full = new URL(request.url).searchParams.get("full") === "1";
  try {
    await assertCanExport(admin as unknown as AdminClient, session.shop, full);
  } catch (error) {
    if (error instanceof UpgradeRequiredError) {
      return new Response(error.message, { status: 402, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw error;
  }

  const { filename, bytes } = full
    ? await buildFullThemeZip(session.shop, String(params.id))
    : await buildExportZip(session.shop, String(params.id));
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
