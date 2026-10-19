import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { buildExportZip, buildFullThemeZip } from "../services/themeMerge.server";

/**
 * `?full=1` → every file of the merged theme, ready to upload as a new theme.
 * Otherwise  → only the files that changed, plus MERGE-REPORT.md, for `shopify theme push`.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const full = new URL(request.url).searchParams.get("full") === "1";
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
