import { NDKEvent } from "@nostr-dev-kit/ndk";
import { SiteAddr } from "./site-addr";
import { Store, Theme } from ".";

export interface ServiceWorkerCaches {
  themeCache: Cache;
  blossomCache: Cache;
  mediaCache: Cache;
}

export type RenderMode =
  | "iife" // client-side rendering in a tab
  | "preview" // client-side rendering in a tab for theme preview
  | "sw" // client-side rendering in a service worker
  | "ssr" // server-side rendering
  | "tab"; // client-side renderer in a tab for plugins

export type RenderOptions = {
  addr: SiteAddr;
  mode?: RenderMode;
  origin?: string; // for iife/sw pass the origin from globalThis
  ssrIndexScriptUrl?: string; // default /index.js
  maxObjects?: number;
  noDefaultPlugins?: boolean;
  site?: NDKEvent;
  theme?: Theme;
  store?: Store;
};

// IMPORTANT: any changes here aside from additions will result
// in incompatibilities on all sites with auto-update config
export interface Renderer {
  start(opions: RenderOptions): Promise<void>;
  started(): boolean;
  getAddr(): SiteAddr;
  setCaches(caches: ServiceWorkerCaches): void;
  destroy(): Promise<void>;
  render(path: string): Promise<{ result: string; context: any }>;
  renderPartial(template: string, self: any, data: any): Promise<string>;
  onUpdate(): Promise<void>;
  getSiteMap(): Promise<string[]>;
  isRss(path: string): boolean;
  hasRss(path: string): boolean;
}
