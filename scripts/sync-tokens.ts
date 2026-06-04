/**
 * sync-tokens.ts
 *
 * Phase 3.1.
 *
 * Copies `design-system/tokens.json` (the W3C source of truth, generated
 * from the Hydrogen DS Figma file) into `Poseidon/data/tokens.json` so the
 * Poseidon bridge + plugin can ship with a baked snapshot.
 *
 * Idempotent. Re-run whenever `design-system/tokens.json` changes
 * (typically after the team publishes a new DS version and the upstream
 * sync script regenerates the source file).
 *
 * Usage:
 *   pnpm scan:tokens
 *   # or
 *   tsx Poseidon/scripts/sync-tokens.ts
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");        // Hydrogen-Designs/
const SRC = resolve(ROOT, "design-system", "tokens.json");
const DEST = resolve(__dirname, "..", "data", "tokens.json");

async function main(): Promise<void> {
  let src;
  try {
    src = await stat(SRC);
  } catch (err) {
    console.error(`[sync-tokens] source not found: ${SRC}`);
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }
  if (!src.isFile()) {
    console.error(`[sync-tokens] source is not a file: ${SRC}`);
    process.exit(1);
  }

  await mkdir(dirname(DEST), { recursive: true });
  await copyFile(SRC, DEST);

  console.log(`[sync-tokens] copied ${SRC} → ${DEST} (${src.size} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
