// Mirror of backend/src/config/usc-versions.ts — keep in sync.
// No shared workspace today; this list will be served via API in a later pass.
export const USC_VERSIONS = ["USC 3.0", "USC 4.0", "USC 4.2"] as const;

export type UscVersion = (typeof USC_VERSIONS)[number];
