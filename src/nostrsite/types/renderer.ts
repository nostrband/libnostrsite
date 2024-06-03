import { SiteAddr } from "./site-addr";

export interface ServiceWorkerCaches {
  themeCache: Cache;
  blossomCache: Cache;
  mediaCache: Cache;
}
// IMPORTANT: any changes here aside from additions will result
// in incompatibilities on all sites with auto-update config
export interface Renderer {
  getAddr(): SiteAddr;
  setCaches(caches: ServiceWorkerCaches): void;
  start(opions: { loadAll?: boolean; ssr?: boolean }): Promise<void>;
  destroy(): Promise<void>;
  render(path: string): Promise<{ result: string; context: any }>;
  onUpdate(): Promise<void>;
}
