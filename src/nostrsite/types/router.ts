
export interface Route {
  path: string;
  pathBase: string; // path w/o /page/X/ suffix
  pathHtml: string; // path excluding /rss/ suffix
  context: string[];
  param?: string; // slugId, pageNumber
  param2?: string; // pageNumber for author/tag
  hasRss?: boolean;
}

export interface Router {
  route(path: string): Route;
}

