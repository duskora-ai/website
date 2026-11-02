# duskora.ai

The public landing page for [Duskora.ai](https://duskora.ai), served by GitHub Pages from `main`.

It's plain HTML and CSS with no build step: edit the HTML and push. Shared styles live in `styles.css`. `CNAME` sets the custom domain.

Legal pages (`terms/`, `privacy/`, `refunds/`) are folders with an `index.html` so URLs stay clean. To mark a fact still to be supplied, wrap it in `<mark class="fill">[…]</mark>`: the e2e check `no unfilled facts remain` fails while any are left. The text has not had legal review yet.

## Tests

`pnpm install && pnpm test:e2e` runs the Playwright checks in `e2e/` against a built-in static server (browsers: `pnpm exec playwright install chromium` if missing).

## Platform screenshots

The four images in the "Platform" section (`screenshots/*.png`) are real app screens framed in a laptop on a dusk-coloured background. `scripts/shots.mjs` regenerates them:

1. Put the demo workspace's page paths for each shot in `scripts/shots.config.json` (use demo data only — no customer repos, names or tokens). Each shot can `click` Playwright selectors to open or collapse sections and `scrollTo` one to bring it to the top. `replaceText` swaps exact text, such as the signed-in user's email, before every capture, and `mask` covers anything else that shouldn't be shown.
2. `pnpm shots:login` opens a browser window; sign in to the demo workspace and press Enter. The session is saved to `.auth/` (git-ignored).
3. `pnpm shots` captures each page into `screenshots/raw/` (git-ignored) and writes the framed 2400×1500 PNGs over `screenshots/<name>.png`.

Already have screenshots? Drop 16:10 PNGs named `plan.png`, `build-pr.png`, `review.png` and `qa-approval.png` into `screenshots/raw/` and run `pnpm shots:frame`. The images show at roughly 500px wide on the page, so the config captures at a 1152×720 viewport to keep the app text as large as possible.
