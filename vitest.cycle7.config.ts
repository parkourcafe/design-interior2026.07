import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

// Гейты доказательств цикла 7. Красные, пока не предоставлен внешний реальный
// пакет, — это их назначение, а не поломка. Завершённость M2 P0 подтверждается
// зелёным прогоном именно этого конфига, а не `npm run test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.gate.test.ts"],
    exclude: [...configDefaults.exclude, ".next/**", ".next.nosync/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
