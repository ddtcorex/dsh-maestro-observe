const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9-_]+/g,
  /\b(ghp|gho|github_pat)_[A-Za-z0-9_]+/g,
  /\bxox[bpa]-[A-Za-z0-9-]+/g,
  /bearer\s+[A-Za-z0-9._~+/-]+/gi,
  /api[_-]?key\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]
export const DETAIL_MAX_CHARS = 500
export function redactDetail(input: unknown, maxChars: number = DETAIL_MAX_CHARS): string | undefined {
  if (typeof input !== 'string' || input.length === 0) return undefined
  const cap = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DETAIL_MAX_CHARS
  let out = input
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]')
  return out.length > cap ? out.slice(0, cap) : out
}
