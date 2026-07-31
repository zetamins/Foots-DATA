// Mirrors exactly what buildReportJson() in the CLI project returns --
// imported as types only (erased at build time, zero runtime cost) so the
// dashboard's data shape can never drift from what the API route actually
// sends.
import type { MergedMatch, MergedProfile, Source, SourceStatus } from "../../src/search";
import type { FormSummary, MatchInsights, VenueDetails } from "../../src/types";

export interface ReportJson {
  team: string;
  generatedAt: string;
  sources: SourceStatus[];
  match: MergedMatch | null;
  venueDetails: VenueDetails | null;
  formSource: Source | undefined;
  form: FormSummary | null;
  opponentForm: FormSummary | null;
  teamProfile: MergedProfile | null;
  opponentProfile: MergedProfile | null;
  insights: MatchInsights | null;
}

export type StreamEvent =
  | { type: "progress"; message: string }
  | { type: "done"; report: ReportJson; markdown: string }
  | { type: "error"; message: string };
