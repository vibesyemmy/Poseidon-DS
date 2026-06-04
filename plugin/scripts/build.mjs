/**
 * Plugin build orchestrator.
 *
 * Produces three artifacts in `dist/`:
 *
 *   dist/sandbox.js   — Figma plugin sandbox entry (runs `figma.*` API)
 *   dist/ui.js        — Preact UI bundle (runs in the plugin iframe)
 *   dist/ui.html      — HTML shell that loads ui.js
 *
 * Two-target build is required because Figma plugins run sandbox + UI in
 * separate contexts with very different globals.
 */

import { build, context } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const WATCH = process.argv.includes("--watch");

const sharedOptions = /** @type {import("esbuild").BuildOptions} */ ({
  bundle: true,
  format: "iife",
  target: "es2020",
  logLevel: "info",
  sourcemap: WATCH ? "inline" : false,
  minify: !WATCH,
});

/** @type {import("esbuild").BuildOptions} */
const sandboxOptions = {
  ...sharedOptions,
  entryPoints: [resolve(ROOT, "src/sandbox/main.ts")],
  outfile: resolve(DIST, "sandbox.js"),
  platform: "browser",
  // Sandbox runs in Figma's plugin VM (QuickJS) — limited modern JS support.
  // Downlevel to ES2017 so optional chaining (`?.`) and nullish coalescing
  // (`??`) get transpiled rather than passed through.
  target: "es2017",
};

/** @type {import("esbuild").BuildOptions} */
const uiOptions = {
  ...sharedOptions,
  entryPoints: [resolve(ROOT, "src/ui/index.tsx")],
  outfile: resolve(DIST, "ui.js"),
  platform: "browser",
  jsx: "automatic",
  jsxImportSource: "preact",
  loader: { ".css": "text" },
};

/**
 * Inline `ui.js` directly into `ui.html`. Figma plugins load the UI HTML
 * as a string and inject it into a sandboxed iframe — relative `<script src>`
 * tags can't fetch sibling files. Everything has to be inline.
 */
async function writeHtmlShell() {
  let inlineScript = "";
  try {
    inlineScript = await readFile(resolve(DIST, "ui.js"), "utf8");
  } catch {
    // First build hasn't produced ui.js yet — write a placeholder; the
    // post-build hook re-runs this after the bundle is ready.
    inlineScript = "/* ui.js not built yet */";
  }
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Poseidon</title>
    <style>
      html, body, #root { height: 100%; margin: 0; padding: 0; }
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: #1e1e1e;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>${inlineScript}</script>
  </body>
</html>
`;
  await writeFile(resolve(DIST, "ui.html"), html);
}

/** esbuild plugin that re-inlines ui.js into ui.html after each UI bundle. */
const inlineHtmlPlugin = {
  name: "inline-ui-html",
  setup(build) {
    build.onEnd(async () => {
      await writeHtmlShell();
    });
  },
};

async function main() {
  await mkdir(DIST, { recursive: true });

  if (WATCH) {
    const sb = await context(sandboxOptions);
    const ui = await context({
      ...uiOptions,
      plugins: [inlineHtmlPlugin],
    });
    await Promise.all([sb.watch(), ui.watch()]);
    console.log("[poseidon-plugin] watching for changes…");
    await new Promise(() => {});
  } else {
    await Promise.all([build(sandboxOptions), build(uiOptions)]);
    await writeHtmlShell();
    console.log("[poseidon-plugin] build complete →", DIST);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
