/**
 * Claude Code detection + auth helpers.
 *
 * Each check returns a structured result so they compose cleanly into the
 * /health response (Phase 1.6). Phase 1 fills these in order:
 *
 *   1.2  checkClaudeDir()            ← THIS FILE, current iteration
 *   1.3  checkClaudeBinary()         ← Phase 1.3
 *   1.4  initAgentSdk()              ← Phase 1.4
 *   1.5  pingAnthropic()             ← Phase 1.5
 *   1.6  detectClaudeCode()  composer ← Phase 1.6
 *
 * Keep this module side-effect-free (no top-level fs reads). Callers invoke
 * the checks explicitly so they're easy to test and re-run.
 */

import { access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

/** Absolute path to `~/.claude/`. */
export const CLAUDE_DIR = join(homedir(), ".claude");

/** Result of a single detection step. */
export interface CheckResult<T = undefined> {
  ok: boolean;
  /** Stable code surfaced to the plugin UI for gate routing. */
  code:
    | "ok"
    | "claude-dir-missing"
    | "claude-dir-unreadable"
    | "claude-binary-missing"     // reserved for 1.3
    | "claude-binary-not-executable" // reserved for 1.3
    | "sdk-init-failed"           // reserved for 1.4
    | "anthropic-unauthed"        // reserved for 1.5
    | "anthropic-no-credit"       // reserved for 1.5
    | "anthropic-unreachable";    // reserved for 1.5
  message: string;
  details?: T;
}

export interface ClaudeDirDetails {
  path: string;
  exists: boolean;
  readable: boolean;
}

/**
 * Phase 1.2 — does `~/.claude/` exist and is it readable?
 *
 * "Readable" matters because corporate machines sometimes have the directory
 * but with locked-down permissions (e.g. MDM profile). Treat that the same as
 * "missing" from the user's perspective — they need to fix their install.
 */
export async function checkClaudeDir(): Promise<CheckResult<ClaudeDirDetails>> {
  const path = CLAUDE_DIR;

  // Existence check first — distinguishes "not installed" from "permissions".
  let exists = false;
  try {
    const s = await stat(path);
    exists = s.isDirectory();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        code: "claude-dir-missing",
        message: "~/.claude directory not found — Claude Code is not installed.",
        details: { path, exists: false, readable: false },
      };
    }
    if (code === "EACCES" || code === "EPERM") {
      return {
        ok: false,
        code: "claude-dir-unreadable",
        message: "~/.claude exists but the current process cannot read it (permission denied).",
        details: { path, exists: true, readable: false },
      };
    }
    // Anything else — surface as unreadable so the UI knows there's *something*.
    return {
      ok: false,
      code: "claude-dir-unreadable",
      message: `~/.claude could not be stat'd: ${(err as Error).message}`,
      details: { path, exists: false, readable: false },
    };
  }

  if (!exists) {
    // Path exists but isn't a directory (very rare — a file named `.claude`).
    return {
      ok: false,
      code: "claude-dir-missing",
      message: "~/.claude exists but is not a directory.",
      details: { path, exists: false, readable: false },
    };
  }

  // Confirm readability — stat succeeding doesn't guarantee read access.
  try {
    await access(path, fsConstants.R_OK | fsConstants.X_OK);
  } catch {
    return {
      ok: false,
      code: "claude-dir-unreadable",
      message: "~/.claude exists but the current process cannot read or enter it.",
      details: { path, exists: true, readable: false },
    };
  }

  return {
    ok: true,
    code: "ok",
    message: "~/.claude is present and readable.",
    details: { path, exists: true, readable: true },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 1.3 — claude binary in PATH
// ─────────────────────────────────────────────────────────────────────────

export interface ClaudeBinaryDetails {
  /** Resolved absolute path to the binary, or null when not found. */
  resolvedPath: string | null;
  /** PATH entries we scanned (for debugging). */
  searchedPaths: string[];
  /** Candidate filenames we tried (varies by platform). */
  candidates: string[];
}

/** Candidate filenames to look for inside each PATH entry. */
function binaryCandidates(): string[] {
  if (platform() === "win32") {
    // Windows: PATHEXT lists the executable suffixes. Default to common ones.
    const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase());
    return ["claude", ...exts.map((e) => `claude${e}`)];
  }
  return ["claude"];
}

/**
 * Phase 1.3 — is the `claude` binary on PATH and executable?
 *
 * Implemented natively (no shell-out to `which`) so it works the same on
 * macOS, Linux, and Windows. We walk every PATH entry in order and return
 * the first match, mirroring the OS's own resolution rules.
 *
 * Distinguishes three states:
 *   - Found + executable      → ok
 *   - Not found anywhere      → claude-binary-missing
 *   - Found but not chmod +x  → claude-binary-not-executable
 */
export async function checkClaudeBinary(): Promise<CheckResult<ClaudeBinaryDetails>> {
  const rawPath = process.env.PATH ?? "";
  const searchedPaths = rawPath.split(delimiter).filter((p) => p.length > 0);
  const candidates = binaryCandidates();

  // First pass — look for any file matching a candidate, regardless of perms.
  // This lets us tell "not installed" apart from "installed but blocked".
  let firstHit: { path: string; executable: boolean } | null = null;

  for (const dir of searchedPaths) {
    for (const name of candidates) {
      const candidatePath = join(dir, name);
      try {
        const s = await stat(candidatePath);
        if (!s.isFile()) continue;

        let executable = true;
        try {
          await access(candidatePath, fsConstants.X_OK);
        } catch {
          executable = false;
        }

        if (executable) {
          // Best match — executable file found. Return immediately.
          return {
            ok: true,
            code: "ok",
            message: `Found executable claude at ${candidatePath}`,
            details: {
              resolvedPath: candidatePath,
              searchedPaths,
              candidates,
            },
          };
        }

        // Remember the first non-executable hit so we can report a precise
        // error if we never find an executable one.
        if (!firstHit) firstHit = { path: candidatePath, executable: false };
      } catch {
        // ENOENT etc. — keep walking.
      }
    }
  }

  if (firstHit) {
    return {
      ok: false,
      code: "claude-binary-not-executable",
      message: `Found ${firstHit.path} but it is not marked executable. Run 'chmod +x' or reinstall Claude Code.`,
      details: {
        resolvedPath: firstHit.path,
        searchedPaths,
        candidates,
      },
    };
  }

  return {
    ok: false,
    code: "claude-binary-missing",
    message: "Could not find 'claude' on PATH. Install Claude Code from https://claude.com/code.",
    details: {
      resolvedPath: null,
      searchedPaths,
      candidates,
    },
  };
}
