import { runSearch, buildReportJson, buildReportMarkdown } from "../../../../src/search";

// A full search does dozens of sequential, deliberately-paced requests
// (Sofascore alone paces itself ~800ms apart) so this can realistically
// take 1-3 minutes, occasionally longer under load (observed up to ~6min
// in testing). This value is ignored entirely by local dev/CLI use --
// maxDuration only takes effect on Vercel. If deploying to Vercel again,
// note the Hobby plan caps this at 300 (a higher value fails deployment
// outright: "Builder returned invalid maxDuration value... must be
// between 1 and 300 for plan hobby") -- Pro's Fluid Compute allows up to
// 800, which this is set to since Vercel deployment isn't the current
// target.
export const maxDuration = 800;

// NDJSON streaming (one JSON object per line) rather than a single
// response: a full search takes long enough that a caller with no progress
// signal would just look hung. Each source's scrape emits a progress line
// as runSearch's onProgress callback fires, then a final "done" line
// carries the same JSON shape the CLI writes to output/*.json, plus the
// markdown the CLI writes to output/*.md, so the two consumers (CLI file,
// web dashboard) stay byte-identical.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const team = searchParams.get("team")?.trim();
  if (!team) {
    return Response.json({ error: 'Missing required "team" query parameter' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // controller already closed (client disconnected) -- ignore
        }
      };
      try {
        const result = await runSearch(team, (message) => send({ type: "progress", message }));
        const report = buildReportJson(result);
        const markdown = buildReportMarkdown(result);
        send({ type: "done", report, markdown });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // client navigated away / aborted -- nothing to clean up server-side,
      // runSearch has no cancellation hook, it'll just finish in the
      // background and its result gets discarded.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
