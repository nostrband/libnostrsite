import NDK, {
  NDKEvent,
  NDKFilter,
  NDKNip07Signer,
  NDKRelaySet,
  NostrEvent,
} from "@nostr-dev-kit/ndk";

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
  DEFAULT_POSTS_PER_PAGE,
  JQUERY,
  KIND_PACKAGE,
  KIND_SITE,
  MAX_OBJECTS_SSR,
  OUTBOX_RELAYS,
  POSTS_PER_RSS,
  SITE_RELAY,
} from "./consts";
import { NostrParser, PLAY_FEATURE_BUTTON_PREFIX } from "./parser/parser";
// import { theme, theme1, theme2, theme3 } from "../sample-themes";
import { SiteAddr } from "./types/site-addr";
import {
  RenderMode,
  RenderOptions,
  Renderer,
  ServiceWorkerCaches,
} from "./types/renderer";
import {
  ensureNumber,
  fetchEvent,
  fetchEvents,
  fetchOutboxRelays,
  fetchRelays,
  isBlossomUrl,
  isEqualContentSettings,
} from "./utils";
import { dbi } from "./store/db";
import {
  AssetFetcher,
  Author,
  Context,
  Post,
  Profile,
  Route,
  Router,
  Store,
  Tag,
} from ".";
import { DefaultAssetFetcher } from "./modules/default-asset-fetcher";
import { fetchNostrSite, getCachedSite } from "..";
import { nip19 } from "nostr-tools";
import { DefaultRouter } from "./modules/default-router";

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
  private router?: Router;
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

  public getSite(): Site {
    if (!this.settings) throw new Error("No site");
    return this.settings;
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
    // launch fetching from server in the background,
    // then check cache and return from cache immediately,
    // but then if new version is fetched from the server
    // it will be written to cache and next page load will
    // read from there!
    const promise = new Promise<NDKEvent>(async (ok) => {
      console.log("fetching site", this.addr);
      const site = await fetchNostrSite(this.addr, this.ndk);
      console.log("fetched site", site);
      if (this.useCache() && site) await dbi.addEvents([site]);
      ok(new NDKEvent(this.ndk, site));
    }).catch((e) => console.log("Failed to fetch site", this.addr, e));

    // cached sites
    if (this.useCache()) {
      const cachedSite = await getCachedSite(this.addr);
      if (cachedSite) return new NDKEvent(this.ndk, cachedSite);
    }

    return promise;
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
      await dbi.deleteEvents(oldCachedExtIds);

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
      if (this.useCache()) await dbi.addEvents([...events]);

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
      // NOTE: do not try to apply style in onload,
      // it will cause stylesheet reload when we replace the html
      // with the rendered page
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = as;
      link.href = url;
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

  private async createStore(mode: RenderMode | undefined, settings: Site) {
    const store = new NostrStore(mode, this.ndk!, settings, this.parser!);
    // fetch relays and place back to settings, etc
    await store.prepareSettings();
    return store;
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
      options.store || (await this.createStore(options.mode, settings));

    // templating
    this.engine = new ThemeEngine(this.store, options);

    // set or fetch theme
    if (options.theme) this.setTheme(options.theme);
    else await this.fetchTheme();

    // we need it for the store
    this.router = new DefaultRouter(this.settings);

    // now we have everything needed to init the engine
    await this.engine.init(
      settings,
      [this.theme!],
      this.config,
      undefined,
      this.assetFetcher
    );

    // after the engine is initialized,
    // prepare using the engine (assign urls etc)
    await this.store.prepare(this.engine.getMetaDataUrl.bind(this.engine));

    // cache theme assets
    if (this.caches && this.caches.themeCache) {
      await this.precacheTheme(this.caches.themeCache);
    }

    // load the store if not provided externally
    if (!options.store)
      await (this.store as NostrStore).load(options.maxObjects);

    // do it in parallel to save some latency
    // await Promise.all([
    //   // externally-supplied theme doesn't need to be fetched
    //   options.theme ? Promise.resolve(null) : this.fetchTheme(),
    //   // externally-supplied store doesn't need to be loaded
    //   options.store
    //     ? Promise.resolve(null)
    //     : (this.store as NostrStore).load(options.maxObjects),
    // ]);

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

  private getPageLimit(contexts: string[]) {
    return contexts.includes("rss")
      ? POSTS_PER_RSS
      : ensureNumber(this.settings!.config.get("posts_per_page")) ||
          DEFAULT_POSTS_PER_PAGE;
  }

  private async loadContextData(route: Route): Promise<Context> {
    const limit = this.getPageLimit(route.context);

    const data: Context = {
      context: route.context,
      mediaUrls: [],
      hasRss: route.hasRss,
      path: route.path,
      pathBase: route.pathBase,
      pathHtml: route.pathHtml,
      param: route.param,
      param2: route.param2,
    };

    // home, kind feeds
    if (route.context.includes("index")) {
      const isKindFeed = route.context.includes("kind");

      let hashtags = undefined;
      let kinds = undefined;

      if (isKindFeed) {
        // kinds feed
        kinds = route.context
          .filter((c) => c.startsWith("kind:"))
          .map((c) => parseInt(c.split("kind:")[1]));
      } else {
        // home feed
        hashtags = this.settings!.homepage_tags
          ? this.settings!.homepage_tags.filter((t) => t.tag === "t").map((t) =>
              t.value.toLocaleLowerCase()
            )
          : undefined;
        kinds = this.settings!.homepage_kinds
          ? this.settings!.homepage_kinds.map((k) => parseInt(k))
          : undefined;
      }

      const pageNum = route.context.includes("paged")
        ? parseInt(route.param!)
        : undefined;

      const list = await this.store!.list({
        type: "posts",
        kinds,
        hashtags,
        page: pageNum,
        limit,
      });
      data.posts = list.posts;
      data.pagination = list.pagination;
    } else if (route.context.includes("post")) {
      const slugId = route.param!;
      data.object = await this.store!.get(slugId, "posts");
      data.post = data.object as Post;
      if (
        data.post &&
        data.post.feature_image?.startsWith(PLAY_FEATURE_BUTTON_PREFIX)
      ) {
        data.post = { ...data.post, feature_image: null };
      }
      data.page = {
        show_title_and_feature_image: data.post
          ? data.post.show_title_and_feature_image
          : true,
      };
    } else if (route.context.includes("tag")) {
      const slugId = route.param!;
      data.object = await this.store!.get(slugId, "tags");
      data.tag = data.object as Tag;
      if (data.tag) {
        const pageNum = route.context.includes("paged")
          ? parseInt(route.param2!)
          : undefined;
        const list = await this.store!.list({
          type: "posts",
          tag: data.tag.id,
          page: pageNum,
        });
        data.posts = list.posts;
        data.pagination = list.pagination;
      }
    } else if (route.context.includes("author")) {
      const slugId = route.param!;
      data.object = await this.store!.get(slugId, "authors");
      data.author = data.object as Author;
      if (data.author) {
        const pageNum = route.context.includes("paged")
          ? parseInt(route.param2!)
          : undefined;
        const list = await this.store!.list({
          type: "posts",
          author: data.author.id,
          page: pageNum,
        });
        data.posts = list.posts;
        data.pagination = list.pagination;
      }
    } else {
      // FIXME find a static page matching the path
      console.log("bad path");
    }

    // FIXME assets from other objects?
    if (data.posts) {
      // @ts-ignore
      data.mediaUrls.push(
        ...data.posts.map((p) => p.feature_image || "").filter((i) => !!i)
      );
    }
    if (data.post) data.mediaUrls.push(...data.post.images);

    if (
      !route.context.includes("error") &&
      !route.context.includes("home") &&
      !route.context.find((c) => c.startsWith("kind:")) &&
      !route.context.includes("paged") &&
      !data.object
    ) {
      console.log("object not found", { route });
      data.context = ["error"];
    }

    data.allowRss = this.options!.mode === "ssr";

    return data;
  }

  public async render(path: string) {
    const route = this.router!.route(path);
    console.log("route", route);

    // NOTE: context.context might differ from route.context
    // due to 404 Not Found errors etc
    let context = await this.loadContextData(route);

    // if routed object not found, or we don't have a full page of data,
    // try forcing the store to load more stuff
    if (
      context.context.includes("error") ||
      (context.pagination && context.posts!.length < context.pagination.limit)
    ) {
      // force store to fetch data for this route
      await this.store!.update(context);

      // now that hopefully store has tried to load some data
      // for this route, we will try again
      context = await this.loadContextData(route);

      // force next page attempt if number of posts === limit,
      // since we've just loaded something new, makes sense to try
      // the next page too
      if (context.pagination && context.posts) {
        if (
          !context.pagination.next &&
          context.posts.length === context.pagination.limit
        )
          context.pagination.next = context.pagination.page + 1;
      }
    }

    // start fetching media while we're rendering
    this.precacheUrls(context.mediaUrls);

    // render
    const result = await this.engine!.render(context);

    return { result, context };
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
        const newSite = this.parser?.parseSite(this.addr, e);
        console.log("sw got updated site, restarting", newSite);
        if (!newSite) return;

        if (this.useCache()) {
          // drop everything (except for profiles) if content
          // settings have changed
          if (!isEqualContentSettings(newSite, this.settings!)) {
            console.log("sw new content settings, reset cache");
            await dbi.deleteEvents();
          }
          // add new site
          await dbi.addEvents([e]);
        }
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
      const add = async () => {
        let u = urls.shift();
        if (!u) return;
        // FIXME consider it later
        // const r = await fetchBlossom(u);
        // if (r.url && r.url !== u) {
        //   console.log("fixed blossom url", u, "=>", r.url);
        //   u = r.url;
        // }

        const req = new Request(u!, {
          cache: "force-cache",
        });
        active++;
        // console.log(Date.now(), "sw cache", active, u);
        cache.match(req).then((found) => {
          if (found) {
            // console.log(Date.now(), "sw already cached", u);
            return proceed();
          }

          // fetch
          cache
            .add(req)
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
    if (!this.store) throw new Error("No store");

    limit = limit || MAX_OBJECTS_SSR;

    const map: string[] = [];
    const base = this.settings!.url || "/";
    const prefix = base.substring(0, base.length - 1);
    const put = (p: string) => {
      const path = `${prefix}${p}`;
      map.push(path);
    };
    put("/");

    const posts = await this.store.list({ type: "posts", limit });
    console.warn("posts", posts.pagination);

    // FIXME shouldn't this live in router?
    const pageLimit = this.getPageLimit(["home"]);

    // home pages
    for (let i = 2; i <= posts.pagination.total / pageLimit; i++)
      put(`/page/${i}`);

    // notes pages
    const notes = await this.store.list({
      type: "posts",
      kinds: [1],
      limit: pageLimit,
    });
    console.warn("notes", notes.pagination);
    if (notes.pagination.total) {
      put("/notes/");
      for (let i = 2; i <= notes.pagination.pages; i++) put(`/notes/page/${i}`);
    }

    // posts pages
    const longPosts = await this.store.list({
      type: "posts",
      kinds: [30023],
      limit: pageLimit,
    });
    console.warn("longPosts", longPosts.pagination);
    if (longPosts.pagination.total) {
      put("/posts/");
      for (let i = 2; i <= longPosts.pagination.pages; i++)
        put(`/posts/page/${i}`);
    }

    // authors
    for (const a of (await this.store.list({ type: "authors", limit: 10 }))
      .authors!) {
      put(a.url);

      // author pages
      const r = await this.store.list({
        type: "posts",
        author: a.id,
        limit: pageLimit,
      });
      console.warn("author", a.id, r.pagination);
      for (let i = 2; i <= r.pagination.pages; i++) put(`${a.url}page/${i}`);
    }

    // tags
    for (const t of (await this.store.list({ type: "tags", limit: 100 }))
      .tags!) {
      put(t.url);

      // tag pages
      const r = await this.store.list({
        type: "posts",
        tag: t.id,
        limit: pageLimit,
      });
      console.warn("tag", t.id, r.pagination);
      for (let i = 2; i <= r.pagination.pages; i++) put(`${t.url}page/${i}`);
    }

    // all posts
    for (const p of posts.posts!) {
      put(p.url);
    }

    return map;
  }

  public hasRss(path: string) {
    return !!this.router!.route(path).hasRss;
  }

  public isRss(path: string) {
    return !!this.router!.route(path).context.includes("rss");
  }

  public prepareRelays(options?: any) {
    const relays = [
      ...this.settings!.contributor_relays,
      ...this.settings!.contributor_inbox_relays,
    ];
    if (options) {
      if (options.relays) relays.push(...options.relays);
      if (options.outboxRelays) relays.push(...OUTBOX_RELAYS);
    }

    return relays;
  }

  public async fetchEvents(
    filters: NDKFilter | NDKFilter[],
    options?: {
      relays?: string[];
      timeoutMs?: number;
    }
  ) {
    return fetchEvents(
      this.ndk!,
      filters,
      this.prepareRelays(options),
      options ? options.timeoutMs : undefined
    );
  }

  public async fetchEvent(
    filters: NDKFilter | NDKFilter[],
    options?: {
      relays?: string[];
      timeoutMs?: number;
      outboxRelays?: boolean;
    }
  ) {
    return fetchEvent(
      this.ndk!,
      filters,
      this.prepareRelays(options),
      options ? options.timeoutMs : undefined
    );
  }

  public async fetchProfiles(pubkeys: string[], relayHints: string[] = []) {
    await (this.store as NostrStore).fetchProfiles(pubkeys, relayHints);

    const profiles: Profile[] = [];
    for (const p of pubkeys) {
      const profile = await this.store!.get(nip19.npubEncode(p), "profiles");
      if (profile) profiles.push(profile as Profile);
    }

    return profiles;
  }

  public async publishEvent(
    event: NostrEvent,
    options?: { relays?: string[] }
  ) {
    const e = new NDKEvent(this.ndk!, event);
    console.log("signing", event, e);
    const sig = await e.sign(new NDKNip07Signer());
    console.log("signed", e, sig);
    const relays = this.prepareRelays({
      relays: options ? options.relays : undefined,
      outboxRelays: [0, 3, 10002].includes(event.kind!),
    });
    const r = await e.publish(NDKRelaySet.fromRelayUrls(relays, this.ndk!));
    console.log("published", e, r);
    return e.rawEvent();
  }

  public async fetchRelays(pubkeys: string[]) {
    return fetchRelays(this.ndk!, pubkeys);
  }

  public async fetchOutboxRelays(pubkeys: string[]) {
    return fetchOutboxRelays(this.ndk!, pubkeys);
  }
}
