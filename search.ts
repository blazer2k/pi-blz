interface SearchResult {
  title: string;
  url: string;
  content: string;
  engine: string;
}

interface SearchResponse {
  results: SearchResult[];
}

export async function search(
  query: string,
  limit: number,
  timeoutMs: number,
  safesearch: 0 | 1 | 2,
): Promise<string> {
  const baseUrl = process.env.SEARXNG_URL || "http://localhost:8888";

  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", safesearch.toString());

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (process.env.SEARXNG_API_KEY) {
    headers.Authorization = `Bearer ${process.env.SEARXNG_API_KEY}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers,
    });

    if (!res.ok) {
      throw new Error(`SearxNG returned ${res.status}`);
    }

    const response = (await res.json()) as SearchResponse;
    const results = response.results.slice(0, limit);

    if (results.length === 0) {
      return `No results found for "${query}"`;
    }

    return results
      .map((r, i) => `## ${i + 1}. ${r.title}\n**URL:** ${r.url}\n**Engine:** ${r.engine}\n${r.content}`)
      .join("\n\n---\n\n");
  } finally {
    clearTimeout(timer);
  }
}
