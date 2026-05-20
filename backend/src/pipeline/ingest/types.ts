export interface ScorpionPage {
  path: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  canonical: string;
  // Scorpion's logical template grouping from #SiteMapListTable column 4
  // (e.g. "Home", "Parent", "System", "System - No Banner", "System - Blog").
  // Pages with the same value will share one WordPress page template.
  // Empty string for rows where the column is missing.
  template: string;
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
