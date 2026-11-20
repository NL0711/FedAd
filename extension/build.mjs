// Bundles the extension into extension/dist (Chrome, Edge: "Load unpacked") and extension/dist-firefox (Firefox desktop and Android).
//   npm run build   build both folders
//   npm run pack    build, then write the store packages to extension/release/ (Chrome Web Store zip, Firefox zip for signing)
// The server it joins is the deployed backend. For local testing only: $env:FEDAD_BASE="http://localhost:8000"; npm run build
// (a release package refuses to be built against anything that is not https).
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = (process.env.FEDAD_BASE ?? "https://fedad.onrender.com").replace(/\/+$/, "");
const PACK = process.argv.includes("--zip");
if (PACK && !BASE.startsWith("https://")) throw new Error(`A release package must use the deployed https backend, not ${BASE}. Unset FEDAD_BASE.`);
console.log(`backend: ${BASE}`);

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: { background: "src/background.ts", popup: "src/popup.ts", content: "src/content.ts" },
  bundle: true, format: "esm", target: "chrome110", outdir: "dist", minify: false, logLevel: "info",
  define: { FEDAD_BASE: JSON.stringify(BASE) },
});
// The extension runs on every page (host permission <all_urls>, granted at install) except the demo's own server, whose pages are not
// browsing worth learning from.
const base = JSON.parse(readFileSync("manifest.json", "utf8"));
base.content_scripts[0].exclude_matches = [...new Set([...base.content_scripts[0].exclude_matches, new URL(BASE).origin + "/*"])];
writeFileSync("dist/manifest.json", JSON.stringify(base, null, 2));
cpSync("src/popup.html", "dist/popup.html");
cpSync("src/popup.css", "dist/popup.css");
cpSync("icons", "dist/icons", { recursive: true });                      // drawn by scripts/make-icons.mjs

// Firefox (desktop and Android) build: same code, manifest adapted (event-page scripts instead of a service worker, add-on id, minimum versions).
rmSync("dist-firefox", { recursive: true, force: true });
cpSync("dist", "dist-firefox", { recursive: true });
const m = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
m.background = { scripts: ["background.js"], type: "module" };
m.browser_specific_settings = {
  gecko: { id: "fedad-contributor@fedad.onrender.com", strict_min_version: "142.0", data_collection_permissions: { required: ["browsingActivity"] } },
  gecko_android: { strict_min_version: "142.0" },
};
writeFileSync("dist-firefox/manifest.json", JSON.stringify(m, null, 2));

if (PACK) {
  // web-ext writes a correct zip (manifest at the root, forward slashes); the Windows tools do not.
  rmSync("release", { recursive: true, force: true });
  const v = base.version;
  const webext = "node node_modules/web-ext/bin/web-ext.js";             // the project's own copy, not whatever npx resolves
  const zip = (dir, name) => execSync(`${webext} build --source-dir ${dir} --artifacts-dir release --filename ${name} --overwrite-dest`, { stdio: "inherit" });
  zip("dist", `fedad-contributor-${v}-chrome.zip`);
  zip("dist-firefox", `fedad-contributor-${v}-firefox.zip`);
  console.log(`\nrelease/fedad-contributor-${v}-chrome.zip   upload to the Chrome Web Store developer dashboard`);
  console.log(`release/fedad-contributor-${v}-firefox.zip  sign on addons.mozilla.org (unlisted) or submit it listed`);
}
