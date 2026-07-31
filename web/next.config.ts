import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The scraper library this app calls lives in ../src (a sibling project,
  // shared with the CLI tool -- see ../src/search.ts's exported runSearch).
  // That's outside web/'s own directory, so both the dev-server workspace
  // detection and the production file tracer need to be told the real
  // project root explicitly.
  outputFileTracingRoot: path.join(__dirname, ".."),
  // fotmob.ts/goal.ts/stadiumdb.ts cache their team-name indexes to
  // ../data/*.json via a dynamic fs.readFile() call, which Next.js's
  // static import tracer can't see -- without this, those seed files
  // silently wouldn't ship in the Vercel deployment, and every cold start
  // would re-fetch the full Fotmob/Goal.com sitemap from scratch.
  outputFileTracingIncludes: {
    // ../data/**: fotmob.ts/goal.ts/stadiumdb.ts's pre-fetched team-name
    // indexes, read via a dynamic fs.readFile() the tracer can't see.
    //
    // playwright-core's own **/*: @sparticuz/chromium's launch path (see
    // browserLaunch.ts) needs playwright-core's coreBundle.js, which in
    // turn dynamically requires its own browsers.json at runtime --
    // confirmed live that this file otherwise silently doesn't ship
    // ("Cannot find module '.../playwright-core/browsers.json'" on every
    // production request), the same class of "tracer can't see a dynamic
    // require" gap as the data/ files above.
    //
    // @sparticuz/chromium's own **/*: its actual compressed Chromium
    // binary lives under its own bin/ directory, read relative to the
    // package's own location at runtime, not via a traceable import --
    // confirmed live with a second, near-identical failure ("The input
    // directory '.../@sparticuz/chromium/bin' does not exist") right after
    // fixing the playwright-core one above.
    "/api/search": ["../data/**/*", "../node_modules/playwright-core/**/*", "../node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
