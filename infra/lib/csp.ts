/**
 * Content-Security-Policy for public pages, sent by CloudFront. The browser suite
 * loads the site under this exact policy, so a violation fails the tests rather
 * than a deployment. The inline allowances cover the one-line no-js class swap and
 * the style attributes that position map pins and fill the collection bar.
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');
