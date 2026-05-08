export interface ScorpionPage {
  path: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  canonical: string;
}

export interface IngestResult {
  siteUrl: string;
  pages: ScorpionPage[];
  contentZoneIds: Set<string>;
}
