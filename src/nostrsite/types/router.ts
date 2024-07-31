
export interface Route {
  path: string;
  pathHtml: string; // path excluding /rss/ suffix
  context: string[];
  param?: string; // slugId, pageNumber
  hasRss?: boolean;
}

export interface Router {
  route(path: string): Route;
}

