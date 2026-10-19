import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { buildExportZip } from "../services/themeMerge.server";

/** Zip of merged theme files + MERGE-REPORT.md. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { filename, bytes } = await buildExportZip(session.shop, String(params.id));
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
