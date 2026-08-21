# Firecrawl API Notes for the Creddy Pipeline

The Creddy implementation uses Firecrawl v2.

Official references:

- Scrape: `https://docs.firecrawl.dev/api-reference/endpoint/scrape`
- Search: `https://docs.firecrawl.dev/api-reference/endpoint/search`
- Credit usage: `https://docs.firecrawl.dev/api-reference/endpoint/credit-usage`

Implementation rules:

- Use `POST /v2/scrape` with `markdown` and `links` for approved listing pages and new articles.
- Use the basic proxy initially so a normal page remains predictable at one credit.
- Set a short cache age for retry protection. Do not accept Firecrawl's two-day default cache for twice-daily news discovery.
- Use `POST /v2/search` with the `news` source and a one-day time filter for the four configured discovery topics.
- Do not include `scrapeOptions` in discovery search requests. Deduplicate URLs first, then scrape only new pages.
- Store the response metadata and credit usage when Firecrawl returns it.
- Never log the bearer credential or raw authorization header.
- Search and scraped publisher content are discovery inputs, not authoritative verification.
