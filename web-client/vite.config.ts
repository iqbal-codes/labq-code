/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// Vite Plus reads `lint`/`create`/`fmt` options from this config at runtime.
// Augment Vite's UserConfig so the type checker accepts them.
declare module "vite" {
  interface UserConfig {
    lint?: {
      options?: {
        typeCheck?: boolean;
        typeAware?: boolean;
      };
    };
    create?: unknown;
    fmt?: unknown;
  }
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolvePath("src"),
      "@labq": resolvePath("../src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    alias: {
      "electrobun/view": resolvePath("src/orchestrator/electrobun-stub.ts"),
    },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  // Vite Plus `check` runs format, lint, and the type checker.
  lint: {
    options: {
      typeCheck: true,
      typeAware: true,
    },
  },
});

function resolvePath(rel: string): string {
  return fileURLToPath(new URL(rel, import.meta.url));
}
