import path from "node:path";
import { fileURLToPath } from "node:url";

// Anchored to this file's own location, not process.cwd() -- the CLI runs
// with cwd at the project root, but the web dashboard's Next.js server
// runs with cwd inside web/, so a cwd-relative path would silently
// resolve to two different (and differently-populated) directories.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Always the committed data/ directory and its pre-fetched seed caches
// (fotmob-teams.json, goal-teams.json, stadiumdb-countries.json). Reading
// from here works even on a read-only Vercel deployment, as long as these
// files are included in it (see web/next.config.ts's
// outputFileTracingIncludes).
export function dataReadDir(): string {
  return path.resolve(PROJECT_ROOT, "data");
}

// Where to write a freshly-rebuilt cache after a read miss. On Vercel the
// deployed filesystem is read-only outside /tmp, so this falls back there
// -- ephemeral for that function instance, unlike the CLI/local dev case
// where it writes back to the same committed data/ directory it read from.
export function dataWriteDir(): string {
  return process.env.VERCEL ? path.resolve("/tmp", "football-data-cache") : dataReadDir();
}
