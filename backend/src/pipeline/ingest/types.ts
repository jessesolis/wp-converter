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
  // iconName → inner SVG markup (e.g. `<path d="…"/>`). Sourced from
  // `#SiteIconTable` on /wp-converter/. Empty if the site hasn't been
  // updated to expose the table yet — substitution becomes a no-op.
  iconMap: Map<string, string>;
}
