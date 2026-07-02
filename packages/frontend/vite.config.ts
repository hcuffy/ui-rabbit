/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Pick up the monorepo-root .env (VITE_API_BASE_URL etc.) — vite.config.ts
  // lives in packages/frontend, but .env/.env.example live at the repo root.
  envDir: "../../",
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    // Required for @testing-library/react's automatic afterEach(cleanup) to
    // register — without a global `afterEach`, renders leak across tests in
    // the same file.
    globals: true,
  },
});
