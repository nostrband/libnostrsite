import {
  DEFAULT_PARTIALS,
  DEFAULT_PARTIALS_DIR_NAME,
} from "../partials/default-partials";
import { AssetFetcher } from "../types/asset-fetcher";
import { Theme } from "../types/theme";

export class DefaultAssetFetcher implements AssetFetcher {
  private themes: Theme[] = [];
  private cache = new Map<string, string>();

  constructor() {
    console.log("new asset fetcher");
  }

  public addTheme(theme: Theme) {
    // already there
    if (this.themes.find((t) => t.id === theme.id)) return;
    this.themes.unshift(theme);
  }

  public async load() {
    // prefetch partials
    const promises: Promise<void>[] = [];
    for (const theme of this.themes) {
      for (const e of theme.entries) {
        if (!e.path.endsWith(".hbs")) continue;
        if (this.cache.get(e.url)) continue;
        promises.push(
          fetch(e.url)
            .then((d) => d.text())
            .then((d) => {
              console.log("prefetched", e.url);
              this.cache.set(e.url, d);
            })
        );
      }
    }
  }

  public resolve(file: string): string {
    if (!file.startsWith("/"))
      throw new Error("Only absolute asset files supported");

    const dir = file.split("/")[1];
    if (dir === DEFAULT_PARTIALS_DIR_NAME) return file;

    // cut 2 slashes and query string
    const path = file.substring(dir.length + 2).split('?')[0];
    const theme = this.themes.find((t) => t.id === dir);
    console.debug("fetch from theme", dir, path, file, theme);

    if (theme) {
      if (theme.local) return file;

      const entry = theme.entries.find((e) => e.path === path);
      if (!entry) {
        console.error("Not found", file, path, theme.entries);
        throw new Error("Not found " + file);
      }

      // const name = entry.url.split("/").pop()!;
      // const ext = path.split(".").pop();
      // console.log("asset ext", entry.url, name, ext);

      // return as is if it has extension
      // if (!ext || name.includes(".")) {
      return entry.url;
      // }

      // return `${entry.url}.${ext}`;
    }

    return file;
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
    return fetch(url)
      .then((d) => d.text())
      .then((r) => {
        this.cache.set(url, r);
        return r;
      });
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
