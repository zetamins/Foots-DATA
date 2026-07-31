"use client";

import { useCallback, useRef, useState } from "react";
import type { ReportJson, StreamEvent } from "./types";

export type SearchStatus = "idle" | "loading" | "done" | "error";

// Reads the NDJSON stream from /api/search (see app/api/search/route.ts)
// line by line as it arrives, rather than waiting for the whole response --
// a full search takes long enough (multiple minutes, sequential
// Sofascore-paced requests) that waiting for one big response would leave
// the page looking hung with no feedback.
export function useSearchStream() {
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [report, setReport] = useState<ReportJson | null>(null);
  const [markdown, setMarkdown] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (team: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    setProgress([]);
    setReport(null);
    setMarkdown("");
    setError(null);

    try {
      const res = await fetch(`/api/search?team=${encodeURIComponent(team)}`, { signal: controller.signal });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "progress") {
            setProgress((prev) => [...prev, event.message]);
          } else if (event.type === "done") {
            setReport(event.report);
            setMarkdown(event.markdown);
            setStatus("done");
          } else if (event.type === "error") {
            setError(event.message);
            setStatus("error");
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  return { status, progress, report, markdown, error, run };
}
