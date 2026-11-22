// Scene Phase 2 (#351): builds public/vendor/three-vrm-3.4.5.min.js, the VRM loader plugin (@pixiv/three-vrm, MIT,
// peer three >= 0.137) the scene page uses for VRoid characters, as one ES module that imports only "three" (served
// from the pinned vendor copy by the clip host's import map). @pixiv/three-vrm is a devDependency used only here.
// Run after changing the version, then update the integrity in src/v2/render/htmlLibs.ts.
//   node scripts/vendor-three-vrm.mjs
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "node_modules/@pixiv/three-vrm/package.json"), "utf8"));
if (pkg.version !== "3.4.5") throw new Error(`@pixiv/three-vrm ${pkg.version} is installed; the vendored copy is pinned to 3.4.5`);
const out = join(root, "public/vendor/three-vrm-3.4.5.min.js");
const entry = `export { VRMLoaderPlugin, VRMUtils, VRMHumanBoneName, VRMExpressionPresetName } from "@pixiv/three-vrm";`;
await build({
  stdin: { contents: entry, resolveDir: root, loader: "js" },
  bundle: true, format: "esm", minify: true, external: ["three"], legalComments: "inline", outfile: out, logLevel: "warning",
});
const sri = `sha384-${createHash("sha384").update(readFileSync(out)).digest("base64")}`;
console.log(`${out}\n${sri}`);
