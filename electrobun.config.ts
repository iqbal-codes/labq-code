import type { ElectrobunConfig } from "electrobun/bun";

const config: ElectrobunConfig = {
  app: {
    name: "LabQ Code",
    identifier: "com.labq.code",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "web-client/dist/index.html": "views/mainview/index.html",
      "web-client/dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["web-client/dist/**"],
  },
};

export default config;
