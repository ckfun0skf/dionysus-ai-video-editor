import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // This repository is deployed as a project site, not a user/org root site.
  // Vite must prefix built asset URLs with the repository path on GitHub Pages.
  base: "/dionysus-ai-video-editor/",
  plugins: [react()],
  // App version stamped into project files (V2-CUT-PROJ manifest).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
});
