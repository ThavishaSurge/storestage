import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { purgeShopData } from "../services/privacy.server";

/**
 * Mandatory compliance webhooks.
 * ThemeMerge never reads or stores customer data, so customer requests have nothing to return or erase.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      break;
    case "SHOP_REDACT":
      await purgeShopData(shop);
      break;
  }
  return new Response();
};
