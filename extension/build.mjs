// Bundles the extension into extension/dist (load that folder with "Load unpacked"). `--zip` also writes fedad-extension.zip.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: { background: "src/background.ts", popup: "src/popup.ts", content: "src/content.ts" },
  bundle: true, format: "esm", target: "chrome110", outdir: "dist", minify: false, logLevel: "info",
  // Server the extension joins automatically: the deployed backend by default. For local testing: $env:FEDAD_BASE="http://localhost:8000"; npm run build
  define: { FEDAD_BASE: JSON.stringify(process.env.FEDAD_BASE ?? "https://fedad.onrender.com") },
});
cpSync("manifest.json", "dist/manifest.json");
cpSync("src/popup.html", "dist/popup.html");
cpSync("src/popup.css", "dist/popup.css");
// 1x1 placeholder icon, replace with a real 128x128 PNG before publishing
if (existsSync("icon.png")) cpSync("icon.png", "dist/icon.png");
else writeFileSync("dist/icon.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));

// Firefox (desktop and Android) build: same code, manifest adapted (event-page scripts instead of a service worker, extension id).
rmSync("dist-firefox", { recursive: true, force: true });
cpSync("dist", "dist-firefox", { recursive: true });
const m = JSON.parse(readFileSync("manifest.json", "utf8"));
m.background = { scripts: ["background.js"], type: "module" };
m.browser_specific_settings = { gecko: { id: "fedad-contributor@example.org", data_collection_permissions: { required: ["websiteActivity"] } }, gecko_android: {} };
writeFileSync("dist-firefox/manifest.json", JSON.stringify(m, null, 2));

if (process.argv.includes("--zip")) {
  // Windows 10+ and macOS/Linux all ship a tar that can write zip (bsdtar); fall back to PowerShell.
  try { execSync("tar -a -c -f fedad-extension.zip -C dist .", { stdio: "inherit" }); }
  catch { execSync('powershell -NoProfile -Command "Compress-Archive -Path dist/* -DestinationPath fedad-extension.zip -Force"', { stdio: "inherit" }); }
}
