import type { Browser } from "playwright-core";

// Sofascore and Squawka both need a real headless Chromium (see their own
// doc comments). Locally (CLI or `next dev`), the full `playwright`
// package already has a Chromium binary installed via `npx playwright
// install chromium` -- use it directly. On Vercel, that binary doesn't
// exist and wouldn't fit/match the Lambda environment even if it did, so
// this swaps to @sparticuz/chromium (a Vercel/Lambda-compatible Chromium
// build) driven through playwright-core (the same Playwright API, no
// bundled browser) whenever the standard Vercel runtime env var is
// present. Both branches return the same Browser type, since `playwright`
// re-exports playwright-core's types under the hood.
//
// Both branches use dynamic import() deliberately -- a static top-level
// `import { chromium } from "playwright"` gets hoisted and evaluated
// eagerly regardless of which branch actually runs, and since Next.js
// treats `playwright` as a "server external package" (loaded via real
// require() at runtime, not bundled), that eager load happens even in
// production, where `playwright`'s full package is present but its
// browser binaries were never downloaded -- confirmed live: this exact
// mistake produced "Cannot find module '.../playwright-core/browsers.json'"
// on every single request in production, regardless of team searched.
export async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const [{ default: sparticuzChromium }, { chromium: chromiumCore }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("playwright-core"),
    ]);
    return chromiumCore.launch({
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    });
  }
  const { chromium: chromiumFull } = await import("playwright");
  return chromiumFull.launch() as unknown as Promise<Browser>;
}
