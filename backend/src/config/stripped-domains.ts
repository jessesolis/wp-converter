// Third-party domains whose CSS / JS / inline references are stripped
// from the converted WordPress build.
//
// Matches are suffix-based: "audioeye.com" matches "audioeye.com",
// "wsmcdn.audioeye.com", "wsv3cdn.audioeye.com", etc. Add new entries
// here and the rest of the strip pipeline picks them up automatically —
// no other code changes needed.
//
// Use this list for third-party services that are tied to the original
// Scorpion license (and therefore can't run on the converted site).
// Don't list scorpion.co / scorpioncdn.com here — same-host filtering
// already keeps Scorpion-owned utilities in the build.
export const STRIPPED_DOMAINS: readonly string[] = ["audioeye.com"];

export function hostMatchesStrippedDomain(host: string): boolean {
  const h = host.toLowerCase();
  return STRIPPED_DOMAINS.some((d) => h === d || h.endsWith("." + d));
}

// Returns true if `url` (absolute or relative) points at a stripped
// domain. Falls back to substring match for relative paths or malformed
// URLs so protocol-relative forms (`//host/path`) and bare hostnames
// still match.
export function urlMatchesStrippedDomain(url: string): boolean {
  if (!url) return false;
  try {
    return hostMatchesStrippedDomain(new URL(url).hostname);
  } catch {
    const lower = url.toLowerCase();
    return STRIPPED_DOMAINS.some((d) => lower.includes(d));
  }
}

// Returns true if `text` (the body of an inline <script> or <style>,
// or arbitrary file content) mentions any stripped domain. Used to
// decide whether to drop an inline block wholesale.
export function contentReferencesStrippedDomain(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return STRIPPED_DOMAINS.some((d) => t.includes(d));
}
