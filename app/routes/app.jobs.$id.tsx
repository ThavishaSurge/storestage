import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getJob } from "../services/jobs.server";

/** Job status for polling (see components/ui.tsx JobProgress). */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { job: await getJob(String(params.id), session.shop) };
};
