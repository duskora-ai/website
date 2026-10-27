# duskora.ai

The public landing page for [Duskora.ai](https://duskora.ai), served by GitHub Pages from `main`.

It's plain HTML and CSS with no build step: edit the HTML and push. Shared styles live in `styles.css`. `CNAME` sets the custom domain.

Legal pages (`terms/`, `privacy/`, `refunds/`) are folders with an `index.html` so URLs stay clean. Their wording is still **DRAFT — to be supplied**; do not merge until the owner provides reviewed text.

## Tests

`pnpm install && pnpm test:e2e` runs the Playwright checks in `e2e/` against a built-in static server (browsers: `pnpm exec playwright install chromium` if missing).
