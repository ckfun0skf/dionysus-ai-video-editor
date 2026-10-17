import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === "true" ? "/dionysus-ai-video-editor/" : "/",
  plugins: [react()],
});
