// Shared naming for per-zone postmeta. The page template emits a shortcode
// call referencing a zone by its sanitized id; the WXR builder writes the
// zone's HTML to a postmeta key derived from the same sanitized id. These
// MUST stay in lockstep — keep the logic here.

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// Replace anything outside [A-Za-z0-9_-] with `-` and collapse runs. Real
// Scorpion zone ids are already in that set; this is defence-in-depth so a
// weird character can never break the shortcode parser or produce an
// unreadable meta key.
export function sanitizeZoneId(id: string): string {
  if (SAFE_ID.test(id)) return id;
  return id
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function zoneMetaKey(zoneId: string): string {
  return `_scorpion_zone_${sanitizeZoneId(zoneId)}`;
}
