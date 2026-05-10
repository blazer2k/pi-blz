import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import { createTimeoutSignal } from "../helpers/request";
import { truncateContent } from "../extractors/shared";

export interface SearchOptions {
  limit: number;
  timeoutMs: number;
  safesearch: 0 | 1 | 2;
  signal?: AbortSignal;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  engine: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

const SearchResultSchema = Type.Object({
  title: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
  engine: Type.Optional(Type.String()),
});

const SearchResponseSchema = Type.Object({
  results: Type.Array(SearchResultSchema),
});

type RawSearchResponse = Static<typeof SearchResponseSchema>;

const searchResponseValidator = Compile(SearchResponseSchema);

function normalizeSearchResponse(raw: unknown): SearchResponse {
  if (!searchResponseValidator.Check(raw)) {
    throw new Error("Invalid SearxNG response shape");
  }

  const response = raw as RawSearchResponse;

  return {
    results: response.results
      .filter((result) => result.url)
      .map((result) => ({
        title: truncateContent(result.title ?? "Untitled", 200),
        url: result.url!,
        content: truncateContent(result.content ?? "", 1000),
        engine: truncateContent(result.engine ?? "unknown", 50),
      })),
  };
}

export async function webSearch(
  query: string,
  options: SearchOptions,
): Promise<SearchResponse> {
  const baseUrl = process.env.SEARXNG_URL || "http://localhost:8888";

  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", options.safesearch.toString());

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const apiKey = process.env.SEARXNG_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const timeout = createTimeoutSignal(options.timeoutMs, options.signal);

  try {
    const res = await fetch(url.toString(), {
      signal: timeout.signal,
      headers,
    });

    if (!res.ok) {
      throw new Error(`SearxNG returned ${res.status} ${res.statusText}`);
    }

    const raw = await res.json();
    const response = normalizeSearchResponse(raw);
    const results = response.results.slice(0, options.limit);

    return { results };
  } finally {
    timeout.cleanup();
  }
}

export function formatSearchResults(response: SearchResponse): string {
  const results = response.results;

  const resultsString =
    results.length === 0
      ? "No results found. Try changing your query."
      : results
          .map(
            (r, i) =>
              `## **${i + 1}.** ${r.title}\n**URL:** ${r.url}\n${r.content}`,
          )
          .join("\n\n---\n\n");

  return resultsString;
}
