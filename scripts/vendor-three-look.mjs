// Scene Phase 1 (#350): builds public/vendor/three-look-0.160.0.min.js, the three.js 0.160 addons the scene page uses
// for its look (post-processing, procedural sky, HDR environment maps), bundled into one ES module that imports only
// "three" (served from the pinned vendor copy by the clip host's import map). Run after changing the list, then update
// the integrity in src/v2/render/htmlLibs.ts (the SRI test prints the expected value).
//   node scripts/vendor-three-look.mjs
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsm = join(root, "node_modules/three/examples/jsm").replace(/\\/g, "/");
const version = JSON.parse(readFileSync(join(root, "node_modules/three/package.json"), "utf8")).version;
if (version !== "0.160.0") throw new Error(`three ${version} is installed; the vendored addons are pinned to 0.160.0`);
const out = join(root, "public/vendor/three-look-0.160.0.min.js");
const entry = [
  ["EffectComposer", "postprocessing/EffectComposer.js"],
  ["RenderPass", "postprocessing/RenderPass.js"],
  ["ShaderPass", "postprocessing/ShaderPass.js"],
  ["OutputPass", "postprocessing/OutputPass.js"],
  ["UnrealBloomPass", "postprocessing/UnrealBloomPass.js"],
  ["BokehPass", "postprocessing/BokehPass.js"],
  ["SSAOPass", "postprocessing/SSAOPass.js"],
  ["SMAAPass", "postprocessing/SMAAPass.js"],
  ["FXAAShader", "shaders/FXAAShader.js"],
  ["Sky", "objects/Sky.js"],
  ["RGBELoader", "loaders/RGBELoader.js"],
].map(([name, file]) => `export { ${name} } from "${jsm}/${file}";`).join("\n");
await build({
  stdin: { contents: entry, resolveDir: root, loader: "js" },
  bundle: true, format: "esm", minify: true, external: ["three"], legalComments: "none", outfile: out, logLevel: "warning",
});
const sri = `sha384-${createHash("sha384").update(readFileSync(out)).digest("base64")}`;
console.log(`${out}\n${sri}`);
