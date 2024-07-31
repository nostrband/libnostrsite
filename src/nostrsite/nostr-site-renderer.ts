import NDK, { NDKEvent, NDKFilter, NostrEvent } from "@nostr-dev-kit/ndk";

// @ts-ignore FIXME ADD TYPES
import BrowserHbs from "browser-hbs";

// FIXME get rid of it when we start loading settings from the nostr event
// @ts-ignore
import loader from "../ghost/shared/config/loader";

import { Site } from "./types/site";
import { ThemeEngine } from "./theme-engine";
import { Theme } from "./types/theme";
import { NostrStore } from "./store/nostr-store";
import {
  JQUERY,
  KIND_PACKAGE,
  KIND_SITE,
  OUTBOX_RELAYS,
  SITE_RELAY,
} from "./consts";
import { NostrParser } from "./parser/parser";
// import { theme, theme1, theme2, theme3 } from "../sample-themes";
import { SiteAddr } from "./types/site-addr";
import { RenderOptions, Renderer, ServiceWorkerCaches } from "./types/renderer";
import { fetchEvents, isBlossomUrl } from "./utils";
import { dbi } from "./store/db";
import { AssetFetcher, Store } from ".";
import { DefaultAssetFetcher } from "./modules/default-asset-fetcher";
import { fetchNostrSite, getCachedSite } from "..";

export class NostrSiteRenderer implements Renderer {
  private addr: SiteAddr;
  public settings?: Site;
  public theme?: Theme;
  private options?: RenderOptions;
  public ndk?: NDK;
  private assetFetcher: AssetFetcher;
  private engine?: ThemeEngine;
  private caches?: ServiceWorkerCaches;
  public store?: Store;
  private parser?: NostrParser;
  private config?: any;
  private hasStarted: boolean = false;
  private preloaded = new Set<string>();

  constructor(
    opt: {
      assetFetcher?: AssetFetcher;
    } = {}
  ) {
    this.assetFetcher = opt.assetFetcher || new DefaultAssetFetcher();

    // empty at the start
    this.addr = {
      identifier: "",
      pubkey: "",
      relays: [],
    };
  }

  public getAddr() {
    return this.addr;
  }

  public started() {
    return this.hasStarted;
  }

  public getThemeAssets(): string[] {
    if (!this.theme) return [];
    return this.theme.entries.map((e) => e.url);
  }

  private async connect() {
    // initially we connect to the relays from site addr,
    // buy also to outbox relays to find the relay lists of
    // the site admin in case addr.relays aren't responding

    // outbox relays
    const relays = [SITE_RELAY, ...OUTBOX_RELAYS];

    // addr relays
    if (this.addr.relays) relays.push(...this.addr.relays);

    this.ndk = new NDK({
      explicitRelayUrls: relays,
    });

    // let caller decide whether they'd block on it or not
    return this.ndk.connect();
  }

  private useCache() {
    return this.options!.mode !== "ssr" && this.options!.mode !== "preview";
  }

  private async fetchSite() {
    // cached sites
    if (this.useCache()) {
      const cachedSite = await getCachedSite(this.addr);
      if (cachedSite) return new NDKEvent(this.ndk, cachedSite);
    }

    const site = await fetchNostrSite(this.addr, this.ndk);
    if (this.useCache() && site) dbi.addEvents([site]);
    return new NDKEvent(this.ndk, site);
  }

  private async fetchTheme() {
    const extIds = this.settings!.extensions.map((x) => x.event_id);
    const exts: NostrEvent[] = [];
    if (this.useCache()) {
      const cachedExtEvents = await dbi.listKindEvents(KIND_PACKAGE, 10);

      exts.push(...cachedExtEvents.filter((t) => extIds.includes(t.id)));
      console.log("cache themes", exts);

      // drop old cached exts
      const oldCachedExtIds = cachedExtEvents
        .filter((x) => !exts.find((e) => e.id === x.id))
        .map((x) => x.id);
      dbi.deleteEvents(oldCachedExtIds);

      // get non-cached ext ids to fetch from relays
      const nonCachedIds = extIds.filter(
        (id) => !exts.find((x) => x.id === id)
      );
      extIds.length = 0;
      extIds.push(...nonCachedIds);
    }

    // got non-cached themes?
    if (extIds.length) {
      const filter: NDKFilter = {
        // @ts-ignore
        kinds: [KIND_PACKAGE],
        ids: extIds,
      };
      console.log("fetch themes", filter);
      const events = await fetchEvents(
        this.ndk!,
        filter,
        [
          SITE_RELAY,
          ...this.settings!.extensions.map((x) => x.relay),
          ...this.addr.relays,
        ],
        2000
      );
      if (!events || !events.size) throw new Error("Theme not found");

      // put to cache
      if (this.useCache()) dbi.addEvents([...events]);

      exts.push(...[...events].map((e) => e.rawEvent()));
    }

    // filter themes from exts
    const themeEvents = [...exts].filter((e) =>
      e.tags.find((t) => t.length >= 2 && t[0] === "l" && t[1] === "theme")
    );
    if (!themeEvents.length) throw new Error("No theme assigned");

    // themes must be sorted by their order in the list of extensions
    themeEvents.sort((a, b) => {
      const ai = this.settings!.extensions.findIndex(
        (x) => x.event_id === a.id
      );
      const bi = this.settings!.extensions.findIndex(
        (x) => x.event_id === b.id
      );
      return ai - bi;
    });
    console.log("got themes", themeEvents);

    if (themeEvents.length === 0) {
      throw new Error("No themes");
    }

    const theme = await this.parser!.parseTheme(
      new NDKEvent(this.ndk, themeEvents[0])
    );
    console.log("parsed theme", theme);

    this.setTheme(theme);
  }

  private preloadThemeAssets(theme: Theme) {
    // more info on preload/prefetch:
    // https://medium.com/reloading/preload-prefetch-and-priorities-in-chrome-776165961bbf
    const create = (url: string, as: string) => {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = as;
      link.href = url;
      // NOTE: do not try to apply style in onload,
      // it will cause stylesheet reload when we replace the html
      // with the rendered page
      console.log("preloading", url);
      document.head.appendChild(link);
    };
    for (const e of theme.entries) {
      if (this.preloaded.has(e.url)) continue;
      this.preloaded.add(e.url);

      if (e.url === JQUERY) {
        // skip, we're prefetching it in the ghost_head with
        // an integrity check
        continue;
      } else if (e.path === "gulpfile.js") {
        // this is an auxillary Ghost theme script never
        // included in the html
        continue;
      } else if (e.path.endsWith(".css")) {
        create(e.url, "style");
      } else if (e.path.endsWith(".js")) {
        create(e.url, "script");
      }
    }
  }

  public async destroy() {
    if (!this.ndk) return;
    if (this.store) this.store.destroy();
    for (const r of this.ndk.pool.relays.values()) {
      r.disconnect();
    }
  }

  private setTheme(theme: Theme) {
    this.theme = theme;
    if ("document" in globalThis) this.preloadThemeAssets(this.theme);
  }

  public async start(options: RenderOptions) {
    console.log("renderer options", options);
    this.addr = options.addr;
    this.options = options;

    const { origin } = options;

    // ndk connect to site relays
    // don't block and wait until all relays connect,
    // any relay can serve site event and we need it asap
    this.connect();

    // site event by the website admin
    const site = options.site || (await this.fetchSite());
    console.log("site", site);
    if (!site) throw new Error("Nostr site event not found");

    this.parser = new NostrParser(origin, this.useCache());

    // site settings from the database (settingsCache)
    const settings = this.parser.parseSite(this.addr, site);
    this.settings = settings;

    if (options.noDefaultPlugins)
      this.settings.config.set("no_default_plugins", "true");

    console.log("settings", settings);

    this.parser.setSite(settings);

    // FIXME remove this crap
    this.config = loader.loadNconf();
    this.config.url = new URL(
      settings.url || "/",
      origin || settings.origin || `http://localhost/`
    ).href;

    // event store
    this.store =
      options.store ||
      new NostrStore(options.mode, this.ndk!, settings, this.parser);

    // templating
    this.engine = new ThemeEngine(this.store, options);

    // theme override
    if (options.theme) this.setTheme(options.theme);

    // do it in parallel to save some latency
    await Promise.all([
      // externally-supplied theme doesn't need to be fetched
      options.theme ? Promise.resolve(null) : this.fetchTheme(),
      // externally-supplied store doesn't need to be loaded
      options.store
        ? Promise.resolve(null)
        : (this.store as NostrStore).load(options.maxObjects),
    ]);

    // now we have everything needed to init the engine
    await this.engine.init(
      settings,
      [this.theme!],
      this.config,
      undefined,
      undefined,
      this.assetFetcher
    );

    // after data is loaded and engine is initialized,
    // prepare using the engine (assign urls etc)
    await this.store.prepare(this.engine.getMetaDataUrl.bind(this.engine));

    // some defaults
    // if (!settings.cover_image && settings.contributor_pubkeys) {
    //   for (const pubkey of settings.contributor_pubkeys) {
    //     const profile = this.store.getProfile(pubkey);
    //     if (profile?.profile?.banner) {
    //       settings.cover_image = profile?.profile?.banner;
    //       break;
    //     }
    //   }
    // }
    // FIXME somehow derive from profile etc
    // if (!settings.accent_color) {
    //   settings.accent_color = "rgb(255, 0, 149)";
    // }
    // console.log("updated settings", settings);
    // this.settings = settings;

    // if (themes.length) this.theme = themes[0];

    // cache theme assets
    if (this.caches && this.caches.themeCache) {
      await this.precacheTheme(this.caches.themeCache);
    }

    // cache site images
    const siteMediaUrls: string[] = [];
    if (settings.icon) siteMediaUrls.push(settings.icon);
    if (settings.logo) siteMediaUrls.push(settings.logo);
    if (settings.cover_image) siteMediaUrls.push(settings.cover_image);
    this.precacheUrls(siteMediaUrls);

    // ready
    this.hasStarted = true;
  }

  public async switchTheme(theme: Theme) {
    // this.theme = await this.parser!.parseTheme(
    //   new NDKEvent(this.ndk, themeEvent)
    // );
    // console.log("parsed theme", this.theme);

    this.setTheme(theme);

    // new engine for this theme
    this.engine = new ThemeEngine(this.store!, this.options!);

    // now we have everything needed to init the engine
    await this.engine.init(
      this.settings!,
      [this.theme!],
      this.config,
      undefined,
      undefined,
      this.assetFetcher
    );

    // after data is loaded and engine is initialized,
    // prepare using the engine (assign urls etc)
    await this.store!.prepare(this.engine.getMetaDataUrl.bind(this.engine));
  }

  private precacheUrls(urls: string[]) {
    if (!this.caches) return;

    const blossom = urls.filter((u) => isBlossomUrl(u));
    const media = urls.filter((u) => !isBlossomUrl(u));
    if (this.caches.blossomCache)
      this.precacheMedia(this.caches.blossomCache, blossom);
    if (this.caches.mediaCache)
      this.precacheMedia(this.caches.mediaCache, media);
  }

  public async render(path: string) {
    const allowRss = this.options!.mode === "ssr";
    const r = await this.engine!.render(path, allowRss);
    this.precacheUrls(r.context.mediaUrls);
    return r;
  }

  public async renderPartial(template: string, self: any, data: any) {
    return Promise.resolve(this.engine!.renderPartial(template, self, data));
  }

  public async onUpdate(): Promise<void> {
    const filter = {
      // @ts-ignore
      kinds: [KIND_SITE],
      authors: [this.addr.pubkey],
      "#d": [this.addr.identifier],
      since: this.settings!.event.created_at,
    };

    return new Promise((ok) => {
      const sub = this.ndk!.subscribe(filter);
      sub.on("event", async (e: NDKEvent) => {
        if (e.created_at! <= this.settings!.event.created_at) return;
        console.log("sw got updated site, restarting");
        if (this.useCache()) await dbi.addEvents([e]);
        sub.stop();
        ok();
      });
      sub.start();
      console.log("sw subscribed to updates of", this.addr);
    });
  }

  public setCaches(caches: ServiceWorkerCaches): void {
    this.caches = caches;

    this.assetFetcher.setOnFetchFromCache(async (url) => {
      if (!this.caches?.themeCache) return undefined;
      const r = await this.caches.themeCache.match(url);
      if (r === undefined) return r;
      return await r.text();
    });
  }

  private async cacheAll(cache: Cache, urls: string[], MAX_ACTIVE: number) {
    let active = 0;
    return new Promise<void>((ok) => {
      const proceed = () => {
        active--;
        if (urls.length > 0) add();
        else ok();
      };
      const add = () => {
        const u = urls.shift();
        const r = new Request(u!, {
          cache: "force-cache",
        });
        active++;
        // console.log(Date.now(), "sw cache", active, u);
        cache.match(r).then((found) => {
          if (found) {
            // console.log(Date.now(), "sw already cached", u);
            return proceed();
          }

          // fetch
          cache
            .add(r)
            .then(proceed)
            .catch(() => {
              // console.log("Failed to put to cache", u, e);
              proceed();
            });
        });
      };
      while (urls.length > 0 && active < MAX_ACTIVE) add();
    });
  }

  private async precacheTheme(cache: Cache) {
    const assets = this.getThemeAssets();
    console.log("sw caching theme assets", assets);
    await this.cacheAll(cache, assets, 5);
  }

  private async precacheMedia(cache: Cache, urls: string[]) {
    const assets = [...new Set(urls)];
    console.log("sw cache assets", assets, cache);
    // FIXME this pre-caching seems to make no sense, unless we
    // pre-cache the next page of images!
    //await this.cacheAll(cache, assets, 5);
  }

  public async getSiteMap(limit?: number) {
    return this.engine!.getSiteMap(limit);
  }

  public isRss(path: string) {
    return this.engine!.isRss(path);
  }

  public hasRss(path: string) {
    return this.engine!.hasRss(path);
  }
}
