# Pull request previews

Every pull request opened from a branch of this repo is deployed to its own URL,
`https://pr-<number>.preview.duskora.ai/`, by `.github/workflows/preview.yml`:

- **Opened, reopened or pushed to:** the site is synced to `pr-<number>/` in the previews bucket, and a comment on the pull request links to the preview and to each page the pull request changes. Each push updates the same comment.
- **Closed or merged:** the prefix is deleted and the comment says so.

CloudFront doesn't cache previews, so a push shows up on the next page load. Previews send `X-Robots-Tag: noindex`, and `analytics.js` only loads on `duskora.ai`, so they are never indexed and never send visits to Google Analytics. Pull requests from forks and from Dependabot get no preview, because GitHub gives them no OIDC token.

## What this stack creates

`main.tf` (Terraform, AWS, `eu-west-2` plus the certificate in `us-east-1`):

- A private S3 bucket holding every preview, one prefix per pull request.
- A CloudFront distribution on `*.preview.duskora.ai`, with its ACM certificate and the wildcard Route 53 records in the existing `duskora.ai` zone. A viewer-request function (`route.js`) maps `pr-42.preview.duskora.ai/blog/` to `pr-42/blog/index.html`, redirects `/terms` to `/terms/` as GitHub Pages does, and refuses other hosts. Missing pages get the site's `404.html`.
- The IAM role the workflow assumes through GitHub's OIDC provider. Only `pull_request` jobs in `duskora-ai/website` can assume it, and it can only list, read, write and delete objects in the previews bucket.

It reads the `duskora.ai` zone and the GitHub OIDC provider that the Duskora infrastructure already created (`envs/shared` and `envs/dev`). Production stays on GitHub Pages and is not touched.

## Setting it up (once)

1. With credentials for the Duskora AWS account, from this folder:

   ```bash
   terraform init -backend-config="bucket=duskora-terraform-state-<account-id>"
   ```

   ```bash
   terraform apply
   ```

   The first apply waits for the certificate to validate, which usually takes a few minutes.

2. Copy the three outputs into the repository variables (Settings → Secrets and variables → Actions → Variables): `WEBSITE_PREVIEW_ROLE_ARN`, `WEBSITE_PREVIEW_BUCKET` and `WEBSITE_PREVIEW_DOMAIN`. Until they are set, the preview jobs are skipped instead of failing.

3. Push to any open pull request, or open a new one: the preview comment appears when the deploy finishes.

The role's trust uses GitHub's immutable OIDC subject (`duskora-ai@<org id>/website@<repo id>`), as the Duskora repos do. If the deploy fails with "Not authorized to perform sts:AssumeRoleWithWebIdentity", check the subject format with `gh api repos/duskora-ai/website/actions/oidc/customization/sub` and set `github_repo` to match.

CI checks this stack with `terraform fmt -check` and `terraform validate` (the `terraform` job in `ci.yml`). Applying it stays manual.
