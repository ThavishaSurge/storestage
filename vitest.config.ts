import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.ts", "test/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
