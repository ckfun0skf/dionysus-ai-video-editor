import { defineConfig, runnerImport, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildSiteUrl } from "./src/v2/domain/siteUrl";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * Deployment target (V2-OPS-LINKS, docs/v2/DEPLOYMENT.md). Set DIONYSUS_SITE_URL to the public URL the app is served
 * from, e.g. `DIONYSUS_SITE_URL=https://video.example.com/ npm run build`. Its path becomes Vite's `base`; without it
 * the GitHub Pages project site (DEFAULT_SITE_URL) is used. `--base` on the CLI still overrides the path.
 */
const SITE_URL = buildSiteUrl(process.env.DIONYSUS_SITE_URL);

/** What the plugin uses from src/v2/domain/aiGuide.ts (declared here so tsconfig.node does not type-check the app). */
interface AiGuideModule {
  aiGuideFiles(site: string, formatDoc: string, clipDoc: string): Record<string, string>;
  FORMAT_DOC_SOURCE: string;
  CLIP_DOC_SOURCE: string;
  PRESET_PROBLEMS: string[];
}

/**
 * Writes the AI planner files (ai/storyboard-guide.md/.html, ai/presets.json, llms.txt) into the build output,
 * regenerated from the registry for this build's site URL + base, and publishes the format reference next to them
 * (ai/STORYBOARD_FORMAT.md) and the HTML clip package spec (ai/HTML_CLIP_PACKAGE.md). The copies in public/ are the committed defaults for dev and GitHub browsing.
 */
function aiFilesPlugin(): Plugin {
  let outDir = "";
  let site = SITE_URL;
  let root = "";
  return {
    name: "dionysus-ai-files",
    apply: "build",
    configResolved(c) {
      root = c.root;
      outDir = resolve(c.root, c.build.outDir);
      site = buildSiteUrl(process.env.DIONYSUS_SITE_URL, c.base);
    },
    async closeBundle() {
      // Loaded through Vite's module runner (not a plain import) so the preset modules' import.meta.glob discovery works.
      const { module } = await runnerImport<AiGuideModule>(resolve(root, "src/v2/domain/aiGuide.ts"), { configFile: false, root, logLevel: "warn" });
      const { aiGuideFiles, FORMAT_DOC_SOURCE, CLIP_DOC_SOURCE, PRESET_PROBLEMS } = module;
      if (PRESET_PROBLEMS.length) throw new Error(`Invalid preset modules:\n  ${PRESET_PROBLEMS.join("\n  ")}`);
      const files = aiGuideFiles(site, readFileSync(resolve(root, FORMAT_DOC_SOURCE), "utf8"), readFileSync(resolve(root, CLIP_DOC_SOURCE), "utf8"));
      for (const [rel, content] of Object.entries(files)) {
        const file = resolve(outDir, rel.replace(/^public\//, ""));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
      this.environment.logger.info(`dionysus-ai-files: ${Object.keys(files).length} AI files written for ${site}`);
    },
  };
}

export default defineConfig({
  // Asset URLs are prefixed with the deployment's path (a project site on GitHub Pages by default).
  base: new URL(SITE_URL).pathname,
  plugins: [react(), aiFilesPlugin()],
  define: {
    // App version stamped into project files (V2-CUT-PROJ manifest).
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Public site the in-app AI prompt falls back to on localhost/LAN, where an outside AI can't open links.
    __DIONYSUS_SITE_URL__: JSON.stringify(SITE_URL),
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
});
