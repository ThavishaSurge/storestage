import { defineConfig } from "vitest/config";

/** Renders the admin pages to static HTML for marketing screenshots: see scripts/screens. */
export default defineConfig({
  test: {
    include: ["scripts/screens/*.test.tsx"],
    environment: "node",
  },
});
