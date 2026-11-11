# duskora.ai

The public landing page for [Duskora.ai](https://duskora.ai), served by GitHub Pages from `main`.

It's plain HTML and CSS with no build step: edit the HTML and push. Shared styles live in `styles.css`. `CNAME` sets the custom domain.

Legal pages (`terms/`, `privacy/`, `refunds/`) are folders with an `index.html` so URLs stay clean. To mark a fact still to be supplied, wrap it in `<mark class="fill">[…]</mark>`: the e2e check `no unfilled facts remain` fails while any are left. The text has not had legal review yet.

## Pull request previews

Each pull request from a branch of this repo is deployed to `https://pr-<number>.preview.duskora.ai/`, and a comment on the pull request links to it. Every push updates the preview, and closing the pull request deletes it. The workflow is `.github/workflows/preview.yml`. The AWS side (an S3 bucket, a CloudFront distribution on `*.preview.duskora.ai` and the role the workflow assumes) is Terraform in the private Duskora repo, under `infra/terraform/envs/website-previews`, with its setup steps. The workflow needs the repository variables `WEBSITE_PREVIEW_ROLE_ARN`, `WEBSITE_PREVIEW_BUCKET` and `WEBSITE_PREVIEW_DOMAIN` from that stack, and skips its jobs until they are set. Pull requests from forks and Dependabot get no preview.

## Tests

`pnpm install && pnpm test:e2e` runs the Playwright checks in `e2e/` against a built-in static server (browsers: `pnpm exec playwright install chromium` if missing).

## Share image

Every page's Open Graph and Twitter card tags point at `og-image.png`, a 1200×630 preview image. It is rasterised from `scripts/og-image.svg` by `node scripts/og-image.mjs`; after editing the SVG, run it and commit both files. The e2e check `social-meta` asserts the tags on every page and the image's size, so add the same tag block to any new page.

## Favicons

Every page declares `favicon.ico` (16, 32 and 48px, for search results and browsers that request it directly), then `favicon.svg`, then `apple-touch-icon.png`. `favicon.ico` and `favicon-48x48.png` are rasterised from `favicon.svg` by `node scripts/favicon.mjs`; after editing the SVG, run it and commit all three files. The e2e check `favicon` asserts the files and the link order on every page, so add the same links to any new page.

## Analytics

`analytics.js` loads Google Analytics 4 on every page (each page's `<head>` has `<script src="/analytics.js" defer>` after the stylesheet). `GA_ID` at its top is the property's measurement ID (`G-CGBBLYCXMM`), and it only loads on `duskora.ai`, so local previews and test runs never send visits to the live property. Besides page views it sends `sign_up_click` (the `data-signup` and pricing `data-cta` buttons, with `link_url`, `page_path` and `plan`) and `beta_request_submitted` (a successful `/beta/` request, with `code_host` only, never the name, email or use case). It uses Google Consent Mode v2: every signal (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`) defaults to denied before gtag.js loads, so no GA cookies are set until the visitor clicks Accept in the cookie banner that `analytics.js` adds to the page. The choice is stored in `localStorage` (`duskora-consent`), and the "Cookie settings" button it adds to the footer's Legal links reopens the banner. Neither appears off `duskora.ai`. The privacy page's "Cookies and analytics" section (`#cookies`) describes this, so update it with any change. The e2e check `analytics` covers it; add the same script tag to any new page.

## llms.txt

`llms.txt` at the site root summarises Duskora.ai for AI search tools in the [llms.txt](https://llmstxt.org) format. Use only facts the site already states: each link note is the linked page's meta description, and the e2e check `llms.txt only states facts the site already states` enforces this. Its Pricing section repeats `PRICES.usd` (monthly) from `index.html`, so update them together: the e2e check `llms.txt prices match PRICES.usd monthly` fails if they drift.

## Platform screenshots

The four images in the "Platform" section (`screenshots/*.png`) are real app screens framed in a laptop on a dusk-coloured background. `scripts/shots.mjs` regenerates them:

1. Put the demo workspace's page paths for each shot in `scripts/shots.config.json` (use demo data only — no customer repos, names or tokens). Each shot can `click` Playwright selectors to open or collapse sections and `scrollTo` one to bring it to the top. `replaceText` swaps exact text, such as the signed-in user's email, before every capture, and `mask` covers anything else that shouldn't be shown.
2. `pnpm shots:login` opens a browser window; sign in to the demo workspace and press Enter. The session is saved to `.auth/` (git-ignored).
3. `pnpm shots` captures each page into `screenshots/raw/` (git-ignored) and writes the framed 2400×1500 PNGs over `screenshots/<name>.png`.

Already have screenshots? Drop 16:10 PNGs named `plan.png`, `build-pr.png`, `review.png` and `qa-approval.png` into `screenshots/raw/` and run `pnpm shots:frame`. The images show at roughly 500px wide on the page, so the config captures at a 1152×720 viewport to keep the app text as large as possible.

Next to each PNG, `shots:frame` also writes WebP and AVIF copies at 600w and 1200w (`screenshots/<name>-600.webp`, `<name>-1200.webp`, `<name>-600.avif`, `<name>-1200.avif`). The Platform section serves them with `<picture>`/`srcset` and `sizes`, so 1x screens get the 600w file and 2x screens the 1200w one. The 2400×1500 PNG is only the fallback for browsers without WebP or AVIF support. The variants are encoded with the `sharp` dev dependency (installed by `pnpm install`). To rebuild only the variants from the framed PNGs already in `screenshots/`, run `node scripts/shots.mjs variants`. Commit the PNG and all four variants together.

## Blog

`/blog/` lists the posts and each post lives in `blog/<slug>/index.html`. `blog/welcome-to-duskora/` is the template to copy. To publish a post:

1. Copy `blog/welcome-to-duskora/` to `blog/<slug>/`. Update the title, meta description, canonical, `og:*`/`twitter:*` tags (keep `og:type` as `article`), `article:published_time`, the `BlogPosting` JSON-LD, the date and read time (about 230 words a minute), the share links' encoded URL and the copy-link `data-url`.
2. Keep at least one `.post-cta` box linking to `/beta/` with `data-signup`, so clicks are counted as `sign_up_click` in Analytics.
3. On `blog/index.html`, make the new post the `.featured` card, add it to the top of `.post-list` and the `blogPost` JSON-LD.
4. Add an `<item>` to the top of `blog/feed.xml` (RSS) and update `lastBuildDate`.
5. Add the URL to `sitemap.xml`, and a link to `llms.txt` whose note is the post's meta description word for word.
6. Add the post to `POSTS` in `e2e/blog.spec.ts` and to the page lists in the other specs (search for `/blog/welcome-to-duskora/`).

### Onboarding walkthrough screenshots and video

`blog/getting-started-with-duskora/` shows the real app's sign-up and setup flow. `scripts/onboarding/` regenerates its stills and screen recording against a local Duskora checkout, with no real GitHub or model accounts:

1. In the Duskora checkout, start Postgres and apply the migrations to an empty database (its README → Local development), and run the web app twice: `pnpm dev:web` (dev sign-in, port 5173) and a Cognito-mode copy on port 5175 for the sign-up screen (`VITE_AUTH_MODE=cognito VITE_COGNITO_AUTHORITY=… VITE_COGNITO_CLIENT_ID=… VITE_COGNITO_DOMAIN=… VITE_COGNITO_GOOGLE=true pnpm --filter @df/web exec vite --port 5175`; any placeholder values work, since nothing signs in there).
2. Instead of `pnpm dev:api`, start `scripts/onboarding/demo-api.mts` from `apps/api` (`pnpm exec tsx --env-file=../../.env <path to demo-api.mts>`). It is the real API with demo stand-ins: "Connect GitHub" returns at once with a demo `acme-labs` installation, any model key validates, and no agent containers start. Instead, a ticket moved into Plan plays a scripted run through Plan, Build, Review and QA to Approval, and approving it plays the deploy.
3. `node scripts/onboarding/capture.mjs` walks through sign-up to a shipped ticket, recording Chrome's screencast frames and a timeline (chapters, where the camera should look, and when to take each still) to `blog/getting-started-with-duskora/raw/` (git-ignored).
4. `node scripts/onboarding/compose.mjs` renders the finished video from those frames: the app framed in a window on the site's dusk background, eased zooms toward each step, chapter captions, crossfades over page loads, sped-up waits, and intro and outro cards. The post's stills come from the same frames and camera, without the captions. `compose.mjs stills` renders only the stills and `compose.mjs preview 12 30` single frames at those seconds, both much quicker than the full video (about five minutes). It needs `ffmpeg`.
5. `node scripts/onboarding/encode.mjs` writes the WebP/AVIF/PNG images, the 1440×900 MP4 and its poster next to the post. Commit those.

To change where the camera looks or what each caption says, edit the `chapter()` and `look()` calls in `capture.mjs` and capture again.

Reset the database before each capture: the walkthrough expects a brand-new user.

When sharing a post on social media, add UTM parameters to the link (for example `?utm_source=linkedin&utm_medium=social&utm_campaign=welcome`) so Analytics shows which channel the visit came from.
