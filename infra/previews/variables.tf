variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "dns_zone" {
  description = "Public Route 53 zone (created by the Duskora infrastructure's envs/shared)."
  type        = string
  default     = "duskora.ai"
}

variable "preview_domain" {
  description = "Previews are served at pr-<number>.<preview_domain> (inside dns_zone)."
  type        = string
  default     = "preview.duskora.ai"
}

variable "github_repo" {
  description = "The website repo as it appears in the OIDC sub claim: owner/repo, or owner@<id>/repo@<id> when the repo uses GitHub's immutable subject (GET /repos/duskora-ai/website/actions/oidc/customization/sub). The Duskora repos use the immutable form."
  type        = string
  default     = "duskora-ai@345367161/website@1427509892"
}
