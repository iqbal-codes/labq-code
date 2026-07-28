import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "LabQ Code Acceptance",
    identifier: "dev.labq.code.acceptance",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/electrobun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/index.css": "views/mainview/index.css",
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
