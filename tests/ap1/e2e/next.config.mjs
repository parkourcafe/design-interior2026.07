import path from "node:path";
// This file is copied to the disposable runtime root before it is evaluated.
import baseConfig from "../next.config.mjs";

// The disposable runtime is created as a direct child of the repository. Keep
// the application root isolated while allowing Next/Turbopack to resolve the
// pinned dependency tree from the parent repository.
const runtimeConfig = {
  ...baseConfig,
  turbopack: {
    ...baseConfig.turbopack,
    root: path.resolve(process.cwd(), ".."),
  },
};

export default runtimeConfig;
