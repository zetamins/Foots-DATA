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
    "/api/search": ["../data/**/*"],
  },
};

export default nextConfig;
