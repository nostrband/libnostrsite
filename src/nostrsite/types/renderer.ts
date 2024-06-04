import { SiteAddr } from "./site-addr";

export interface ServiceWorkerCaches {
  themeCache: Cache;
  blossomCache: Cache;
  mediaCache: Cache;
}

export type RenderMode =
  | "iife" // client-side rendering in a tab
  | "sw" // client-side rendering in a service worker
  | "ssr"; // server-side rendering

export type RenderOptions = {
  loadAll?: boolean;
  mode?: RenderMode;
  origin?: string; // for iife/sw pass the origin from globalThis
  ssrIndexScriptUrl?: string; // default /index.js
}

// IMPORTANT: any changes here aside from additions will result
// in incompatibilities on all sites with auto-update config
export interface Renderer {
  start(opions: RenderOptions): Promise<void>;
  started(): boolean;
  getAddr(): SiteAddr;
  setCaches(caches: ServiceWorkerCaches): void;
  destroy(): Promise<void>;
  render(path: string): Promise<{ result: string; context: any }>;
  onUpdate(): Promise<void>;
  getSiteMap(): Promise<string[]>;
}
