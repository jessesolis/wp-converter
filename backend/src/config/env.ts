import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

export const env = {
  port: Number(optional("PORT", "3001")),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  tempDir: optional("TEMP_DIR", ""),
};
