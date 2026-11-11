# Pull request previews for the website: each PR is served at https://pr-<number>.<preview_domain>/
# from its own prefix (pr-<number>/) in one private S3 bucket, behind one CloudFront distribution.
# .github/workflows/preview.yml uploads on every push and deletes the prefix when the PR closes.
#
# Applied by hand (see README.md in this folder). It only reads the duskora.ai zone and the
# GitHub OIDC provider that the Duskora infrastructure already created.

terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The Duskora Terraform state bucket (its bootstrap stack):
  #   terraform init -backend-config="bucket=duskora-terraform-state-<account-id>"
  backend "s3" {
    key          = "website/previews/terraform.tfstate"
    region       = "eu-west-2"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "duskora"
      Environment = "website-previews"
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront only accepts ACM certificates issued in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "duskora"
      Environment = "website-previews"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name           = "duskora-website-previews"
  oidc_url       = "token.actions.githubusercontent.com"
  wildcard       = "*.${var.preview_domain}"
  host_pattern   = "^(pr-[0-9]+)\\.${replace(var.preview_domain, ".", "\\.")}$"
  error_page_key = "_errors/404.html"
}

# ─── Bucket ──────────────────────────────────────────────────────────────────

# Previews are throwaway copies of the site, so `terraform destroy` may empty the bucket.
resource "aws_s3_bucket" "previews" {
  bucket        = "${local.name}-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "previews" {
  bucket                  = aws_s3_bucket.previews.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "previews" {
  bucket = aws_s3_bucket.previews.id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# ─── CloudFront ──────────────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "previews" {
  name                              = local.name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Maps pr-42.<preview_domain>/blog/ to the object pr-42/blog/index.html, and redirects folder URLs
# without a trailing slash (/terms) to /terms/ as GitHub Pages does. Any other host is refused.
resource "aws_cloudfront_function" "route" {
  name    = "${local.name}-route"
  runtime = "cloudfront-js-2.0"
  comment = "Route pr-<number> hosts to their prefix in the previews bucket"
  publish = true
  code    = templatefile("${path.module}/route.js", { host_pattern = local.host_pattern })
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Previews must never be indexed, and get the same baseline security headers as the app.
resource "aws_cloudfront_response_headers_policy" "previews" {
  name    = "${local.name}-headers"
  comment = "noindex and security headers for website previews"

  custom_headers_config {
    items {
      header   = "X-Robots-Tag"
      value    = "noindex, nofollow"
      override = true
    }
  }

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      override                   = true
    }
  }
}

resource "aws_cloudfront_distribution" "previews" {
  enabled         = true
  comment         = "Duskora website pull request previews"
  price_class     = "PriceClass_100"
  http_version    = "http2and3"
  is_ipv6_enabled = true
  aliases         = [local.wildcard]

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.previews.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.previews.id
  }

  # No caching: every push shows up on the next page load, without invalidations.
  default_cache_behavior {
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.previews.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.route.arn
    }
  }

  # A missing object comes back from S3 as 403 (CloudFront can't list the bucket). Serve the
  # site's own 404 page instead; the workflow copies it to this key on every deploy.
  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/${local.error_page_key}"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 404
    response_page_path = "/${local.error_page_key}"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.previews.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.previews.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.previews.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "previews" {
  bucket = aws_s3_bucket.previews.id
  policy = data.aws_iam_policy_document.bucket.json
}

# ─── Certificate and DNS ─────────────────────────────────────────────────────

data "aws_route53_zone" "public" {
  name = var.dns_zone
}

resource "aws_acm_certificate" "previews" {
  provider          = aws.us_east_1
  domain_name       = local.wildcard
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.previews.domain_validation_options : o.domain_name => o
  }
  zone_id         = data.aws_route53_zone.public.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "previews" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.previews.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

resource "aws_route53_record" "wildcard" {
  for_each = toset(["A", "AAAA"])
  zone_id  = data.aws_route53_zone.public.zone_id
  name     = local.wildcard
  type     = each.key
  alias {
    name                   = aws_cloudfront_distribution.previews.domain_name
    zone_id                = aws_cloudfront_distribution.previews.hosted_zone_id
    evaluate_target_health = false
  }
}

# ─── The role the preview workflow assumes ───────────────────────────────────

data "aws_iam_openid_connect_provider" "github" {
  url = "https://${local.oidc_url}"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Only pull request jobs in the website repo. GitHub gives no OIDC token to pull requests
    # from forks, so only branches pushed to this repo (by people with write access) get previews.
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_url}:sub"
      values   = ["repo:${var.github_repo}:pull_request"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${local.name}-deploy"
  description          = "Uploads and deletes website pull request previews (GitHub Actions, duskora-ai/website)"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  max_session_duration = 3600
}

# Objects in the previews bucket and nothing else: no other bucket, no CloudFront, no IAM.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "ListPreviews"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.previews.arn]
  }
  statement {
    sid       = "WritePreviews"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.previews.arn}/*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "previews-bucket"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
