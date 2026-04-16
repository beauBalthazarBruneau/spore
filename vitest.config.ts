import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["backend/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
