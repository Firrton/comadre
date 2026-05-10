/**
 * Firecrawl client — product search via /v1/search endpoint.
 *
 * Single-purpose: web search with content scraping for product discovery.
 * Used by the buscar_producto agent tool. Free tier covers ~500 queries/mo.
 *
 * Docs: https://docs.firecrawl.dev/api-reference/endpoint/search
 */

export interface FirecrawlSearchResult {
  url: string;
  title: string;
  description: string;
  /** Optional — scraped page markdown if scrapeOptions was passed. */
  markdown?: string;
}

export interface ProductSearchInput {
  query: string;
  /** Pseudo-country hint for query refinement, e.g. "mx" or "ar". */
  country?: string;
  limit?: number;
}

const COUNTRY_HINTS: Record<string, string> = {
  mx: "México",
  ar: "Argentina",
  cl: "Chile",
  co: "Colombia",
  pe: "Perú",
  us: "",
};

export async function searchProducts(input: ProductSearchInput): Promise<FirecrawlSearchResult[]> {
  const apiKey = process.env["FIRECRAWL_API_KEY"];
  if (!apiKey) {
    throw new Error("[firecrawl] FIRECRAWL_API_KEY env var is required");
  }

  const country = (input.country ?? "mx").toLowerCase();
  const hint = COUNTRY_HINTS[country] ?? "";
  const enrichedQuery = hint ? `${input.query} comprar ${hint} precio` : `${input.query} buy price`;

  const response = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: enrichedQuery,
      limit: Math.min(input.limit ?? 5, 10),
      lang: country === "us" ? "en" : "es",
      country,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Firecrawl /v1/search HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as {
    success?: boolean;
    data?: Array<{ url: string; title?: string; description?: string; markdown?: string }>;
  };

  if (!json.success || !Array.isArray(json.data)) {
    throw new Error(`Firecrawl returned unsuccessful response`);
  }

  return json.data.map((r) => ({
    url: r.url,
    title: r.title ?? r.url,
    description: r.description ?? "",
    markdown: r.markdown,
  }));
}
