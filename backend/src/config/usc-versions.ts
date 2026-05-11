export const USC_VERSIONS = ["USC 3.0", "USC 4.0", "USC 4.2"] as const;

export type UscVersion = (typeof USC_VERSIONS)[number];

export function isUscVersion(value: unknown): value is UscVersion {
  return (
    typeof value === "string" &&
    (USC_VERSIONS as readonly string[]).includes(value)
  );
}
