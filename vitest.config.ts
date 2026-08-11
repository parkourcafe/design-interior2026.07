import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // React-плагин нужен ровно одному виду тестов — рендеру компонента. Без
  // него JSX в `.test.tsx` не собирается, а проверять кнопку по исходнику
  // значит проверять не кнопку.
  plugins: [react()],
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
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
