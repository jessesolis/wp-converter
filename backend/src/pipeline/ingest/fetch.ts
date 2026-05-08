import { IngestFetchError } from "./errors";

const USER_AGENT =
  "ScorpionWPConverter/0.1 (+https://scorpion.co; conversion-tool)";
const TIMEOUT_MS = 30_000;

export async function fetchWpConverterHtml(siteUrl: string): Promise<string> {
  const url = new URL("/wp-converter/", siteUrl).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    throw new IngestFetchError(siteUrl, null, err);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new IngestFetchError(siteUrl, response.status);
  }

  return response.text();
}
