import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // This repository is deployed as a project site, not a user/org root site.
  // Vite must prefix built asset URLs with the repository path on GitHub Pages.
  base: "/dionysus-ai-video-editor/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
});
