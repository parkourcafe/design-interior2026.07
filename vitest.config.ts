import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      ".next/**",
      ".next.nosync/**",
      // Гейты доказательств цикла 7: намеренно красные, пока нет внешнего
      // пакета. Запускаются отдельно через `npm run test:cycle7`.
      "**/*.gate.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
