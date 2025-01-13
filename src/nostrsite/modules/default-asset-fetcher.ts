import { fetchBlossom } from "..";
import {
  DEFAULT_PARTIALS,
  DEFAULT_PARTIALS_DIR_NAME,
} from "../partials/default-partials";
import { DEFAULT_TEMPLATES } from "../templates/default-templates";
import { AssetFetcher } from "../types/asset-fetcher";
import { Theme } from "../types/theme";

export class DefaultAssetFetcher implements AssetFetcher {
  private themes: Theme[] = [];
  private cache = new Map<string, string>();
  private onCache?: (url: string) => Promise<string | undefined>;

  constructor() {
    console.log("new asset fetcher");
  }

  public setOnFetchFromCache(cb: (url: string) => Promise<string>) {
    this.onCache = cb;
  }

  public addTheme(theme: Theme) {
    // already there
    if (this.themes.find((t) => t.id === theme.id)) return;
    this.themes.unshift(theme);
  }

  public async load() {
    // prefetch partials
    const promises: Promise<string>[] = [];
    for (const theme of this.themes) {
      for (const e of theme.entries) {
        if (!e.path.endsWith(".hbs")) continue;
        if (this.cache.get(e.url)) continue;
        promises.push(this.fetchCachedExt(e.url));
      }
    }
  }

  public resolve(file: string): string {
    if (!file.startsWith("/"))
      throw new Error("Only absolute asset files supported");

    const dir = file.split("/")[1];
    if (dir === DEFAULT_PARTIALS_DIR_NAME) return file;

    // cut 2 slashes and query string
    const path = file.substring(dir.length + 2).split("?")[0];
    const theme = this.themes.find((t) => t.id === dir);
    // console.debug("fetch from theme", dir, path, file, theme);

    if (theme) {
      if (theme.local) return file;

      const entry = theme.entries.find((e) => e.path === path);
      if (entry) return entry.url;

      if (path in DEFAULT_TEMPLATES) return path;

      console.error("Not found", file, path, theme.entries);
      throw new Error("Not found " + file);
    }

    return file;
  }

  private async fetchCachedExt(url: string) {
    if (!url.includes("/")) {
      // default templates
      console.log("default template", url);
      return DEFAULT_TEMPLATES[url];
    }

    if (this.onCache) {
      const r = await this.onCache(url);
      if (r !== undefined) {
        console.debug("fetched from external cache", url);
        this.cache.set(url, r);
        return r;
      }
    }

    const r = await fetchBlossom(url);
    const d = await r.text();
    this.cache.set(url, d);
    return d;
    // const u = new URL(url);

    // // try several servers - fallbacks have discovery
    // // enabled and might find the file even if it's
    // // never been uploaded to them
    // const urls = [
    //   url,
    //   ...BLOSSOM_FALLBACKS.map((s) => s + u.pathname + u.search),
    // ];

    // for (const su of urls) {
    //   try {
    //     const r = await fetch(su);
    //     if (r.status !== 200) throw new Error("Failed to fetch "+su);
    //     const d = await r.text();
    //     console.debug("fetched from network", url, su, r.status);
    //     this.cache.set(url, d);
    //     return d;
    //   } catch (e) {
    //     console.warn("failed to fetched from network", su, e);
    //   }
    // }

    // throw new Error("Failed to fetch asset " + url);
  }

  private async fetchCached(url: string) {
    if (url.startsWith(`/${DEFAULT_PARTIALS_DIR_NAME}/`)) {
      const name = url.split("/")[2];
      if (name in DEFAULT_PARTIALS) return DEFAULT_PARTIALS[name];
      console.warn("Default partial not found", url);
      throw new Error("Default partial not found");
    }

    const c = this.cache.get(url);
    if (c) {
      console.debug("fetch cached", url);
      return c;
    }

    // fetch then put to cache then return
    return this.fetchCachedExt(url);
  }

  public async fetch(file: string) {
    const url = this.resolve(file);
    return this.fetchCached(url).then((d) => {
      console.debug("fetched", { file, url, d });
      return d;
    });
  }

  public fetchHbs(
    file: string,
    _: string,
    cb: (e: any | null, data?: string) => void
  ) {
    this.fetch(file)
      .then((d) => cb(null, d))
      .catch((e) => cb(e));
  }
}
