# Set these as repository variables in duskora-ai/website (Settings → Secrets and variables →
# Actions → Variables) so .github/workflows/preview.yml can deploy.

output "WEBSITE_PREVIEW_ROLE_ARN" {
  value = aws_iam_role.deploy.arn
}

output "WEBSITE_PREVIEW_BUCKET" {
  value = aws_s3_bucket.previews.bucket
}

output "WEBSITE_PREVIEW_DOMAIN" {
  value = var.preview_domain
}
