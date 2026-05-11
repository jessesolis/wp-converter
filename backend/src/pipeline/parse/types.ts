export interface ExtractedZone {
  zoneId: string;
  index: number;
  innerHtml: string;
}

export interface PageContentZones {
  pageUrl: string;
  path: string;
  zones: ExtractedZone[];
  template: string;
}
