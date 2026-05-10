/**
 * /api/v1/products — product discovery via Firecrawl web search.
 *
 * Auth: HMAC internal (agent service) + dev-mode wallet header.
 * Cost: each call hits Firecrawl /v1/search (1 credit on free tier).
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchProducts } from "../lib/firecrawl.js";

export const productsRouter = new Hono();

const SearchInput = z.object({
  query: z.string().min(2).max(120),
  country: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

productsRouter.post(
  "/search",
  zValidator("json", SearchInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const input = c.req.valid("json");
    try {
      const results = await searchProducts(input);
      return c.json(
        {
          query: input.query,
          country: input.country ?? "mx",
          count: results.length,
          products: results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.description,
          })),
        },
        200
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "search failed";
      return c.json({ error: "SEARCH_FAILED", message }, 502);
    }
  }
);
