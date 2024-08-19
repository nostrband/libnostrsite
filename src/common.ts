import { setHtml } from "./html";
import { nip19 } from "nostr-tools";
import {
  KIND_PROFILE,
  KIND_SITE,
  OUTBOX_RELAYS,
  SITE_RELAY,
} from "./nostrsite/consts";
import { NostrSiteRenderer } from "./nostrsite/nostr-site-renderer";
import { SiteAddr } from "./nostrsite/types/site-addr";
import NDK, { NDKEvent, NDKFilter, NostrEvent } from "@nostr-dev-kit/ndk";
import { slugify } from "./ghost/helpers/slugify";
import {
  GlobalNostrSite,
  PLAY_FEATURE_BUTTON_PREFIX,
  PluginEndpoint,
  PluginInterface,
  RenderMode,
  Store,
  User,
  fetchEvent,
  fetchEvents,
  fetchOutboxRelays,
  isAudioUrl,
  isImageUrl,
  isVideoUrl,
} from ".";
import { toRGBString } from "./color";
import { dbi } from "./nostrsite/store/db";
import { load as loadHtml } from "cheerio";
import { getOembedUrl } from "./nostrsite/parser/oembed-providers";
import * as luxon from "luxon";

export function parseAddr(naddr: string): SiteAddr {
  const { type, data } = nip19.decode(naddr);
  if (type !== "naddr" || data.kind !== KIND_SITE || !data.pubkey.trim()) {
    console.log("Bad addr: ", type, data);
    throw new Error("Bad addr");
  }

  return {
    identifier: data.identifier,
    pubkey: data.pubkey,
    relays: data.relays || [],
  };
}

export async function getMetaAddr(): Promise<SiteAddr | undefined> {
  // <link rel="manifest" href="manifest.json" />
  const metas = document.getElementsByTagName("meta");
  for (const meta of metas) {
    const name = meta.getAttribute("name") || meta.getAttribute("property");
    if (name !== "nostr:site") continue;

    const content = meta.getAttribute("content");
    if (!content || !content.startsWith("naddr1")) {
      console.log("Bad meta nostr:site value: ", content);
      continue;
    }

    try {
      return parseAddr(content);
    } catch (e) {
      console.log("Bad meta nostr:site addr: ", content);
      continue;
    }
  }

  return undefined;
}

export async function renderCurrentPage(
  path = "",
  options?: { mode: RenderMode }
) {
  // read-only thing, but SW should re-fetch
  // it and update HBS object if something changes
  const addr = await getMetaAddr();
  console.log("addr", addr);
  if (!addr) throw new Error("No nostr site addr");

  const start = Date.now();
  const renderer = new NostrSiteRenderer();
  await renderer.start({
    addr,
    origin: window.location.origin,
    mode: options?.mode || "iife",
  });
  const t1 = Date.now();
  console.log("renderer created in ", t1 - start);

  // render using hbs and replace document.html
  path = path || document.location.pathname;
  const { result } = await renderer.render(path);
  //  console.log("result html size", result.length, setHtml);
  const t2 = Date.now();
  console.log("renderer rendered ", path, " in ", t2 - t1);
  await setHtml(result);
  const t3 = Date.now();
  console.log("renderer setHtml in ", t3 - t2);
}

export async function fetchNostrSite(
  addr: SiteAddr,
  ndk?: NDK
): Promise<NostrEvent | undefined> {
  const tempNdk = !ndk;
  if (!ndk) {
    ndk = new NDK({
      explicitRelayUrls: [SITE_RELAY],
    });
    ndk.connect();
  }
  // helper
  const fetchFromRelays = async (relayUrls: string[]) => {
    console.log("fetching site from relays", relayUrls);
    return await fetchEvent(
      ndk!,
      {
        // @ts-ignore
        kinds: [KIND_SITE],
        authors: [addr.pubkey],
        "#d": [addr.identifier],
      },
      relayUrls,
      3000
    );
  };

  const relays = [SITE_RELAY];
  if (addr.relays) relays.push(...addr.relays);

  // fetch site object
  let site = await fetchFromRelays(relays);

  // not found on expected relays? look through the
  // admin outbox relays.
  if (!site) {
    console.warn("site not found on addr relays", addr.relays);

    const outboxRelays = await fetchOutboxRelays(ndk, [addr.pubkey]);
    console.log("site admin outbox relays", outboxRelays);
    if (!outboxRelays.length) {
      console.log("Failed to find outbox relays for", addr.pubkey);
    } else {
      site = await fetchFromRelays(outboxRelays);

      // replace the site relays
      if (site) addr.relays = outboxRelays;
    }
  }

  // we no longer need it
  if (tempNdk) {
    for (const r of ndk.pool.relays.values()) {
      r.disconnect();
    }
  }

  return site ? site.rawEvent() : undefined;
}

export async function fetchProfile(ndk: NDK, pubkey: string) {
  return await fetchEvent(
    ndk,
    {
      kinds: [KIND_PROFILE],
      authors: [pubkey],
    },
    OUTBOX_RELAYS
  );
}

export async function prepareSite(
  ndk: NDK,
  adminPubkey: string,
  options: {
    contributorPubkeys?: string[];
    kinds?: number[];
    hashtags?: string[];
    theme?: { id: string; hash: string; relay: string; name: string };
  }
) {
  const contributorPubkey =
    options.contributorPubkeys && options.contributorPubkeys.length
      ? options.contributorPubkeys[0]
      : adminPubkey;

  const profile = await fetchProfile(ndk, contributorPubkey);
  if (!profile) throw new Error("Failed to fetch profile");

  const meta = JSON.parse(profile.content);
  console.log(Date.now(), "meta", meta);

  const name = meta.name || meta.display_name;
  console.log("name", name.toLowerCase());

  const slug = getProfileSlug(profile);

  const siteEvent: NostrEvent = {
    pubkey: adminPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_SITE,
    content: "",
    tags: [
      ["d", slug],
      ["name", name || "Nostr site"],
      ["title", meta.display_name || meta.name || "Nostr site"],
      ["summary", meta.about || ""],
      ["icon", meta.picture || ""],
      ["image", meta.banner || ""],
      ["p", contributorPubkey],
      ["z", "pro.npub.v1"],
      ["logo", meta.picture || ""],
      // ["lang", "en"],
      // ["meta_title", ""],
      // ["meta_description", ""],
      // ["og_title", ""],
      // ["og_description", ""],
      // ["og_image", ""],
      // ["twitter_image", ""],
      // ["twitter_title", ""],
      // ["twitter_description", ""],

      // ["config", "hashtags", ""],

      ["nav", "/", "Home"],
    ],
  };

  const kinds = [...(options.kinds || [])];
  if (!kinds.length) kinds.push(1);
  siteEvent.tags.push(...kinds.map((k) => ["kind", "" + k]));

  const hashtags = [...(options.hashtags || [])];
  if (hashtags.length)
    siteEvent.tags.push(...hashtags.map((h) => ["include", "t", h]));
  else siteEvent.tags.push(["include", "*"]);

  if (options.theme)
    siteEvent.tags.push([
      "x",
      options.theme.id,
      options.theme.relay,
      options.theme.hash,
      options.theme.name,
    ]);

  const color = toRGBString(contributorPubkey, {
    hue: [0, 360],
    sat: [50, 100],
    lit: [25, 75],
  });
  siteEvent.tags.push(["color", color]);

  return siteEvent;
}

export async function getTopHashtags(store: Store) {
  const list = await store.list({ type: "posts" });

  const hashtagCounts = new Map<string, number>();
  for (const p of list.posts!) {
    p.event.tags
      .filter((t: string[]) => t.length > 1 && t[0] === "t")
      .map((t: string[]) => t[1])
      .forEach((t) => {
        let c = hashtagCounts.get(t) || 0;
        c++;
        hashtagCounts.set(t, c);
      });
  }
  console.log("hashtag counts", hashtagCounts);

  return [...hashtagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((t) => t[0]);
}

export async function prepareSiteByContent(
  site: NostrEvent | NDKEvent,
  store: Store
) {
  let topTags = site.tags
    .filter((t) => t.length >= 3 && t[0] === "include" && t[1] === "t")
    .map((t) => t[2]);
  if (topTags.length <= 1) {
    const top = await getTopHashtags(store);
    if (top.length > 3) top.length = 3;

    console.log("top hashtags", top);

    topTags = top;
  }

  for (const t of topTags) {
    // navigation
    site.tags.push([
      "nav",
      `/tag/${t}`,
      t.charAt(0).toUpperCase() + t.slice(1),
    ]);

    // site hashtags for discovery
    site.tags.push(["t", t]);
  }
}

export function getProfileSlug(profile: NostrEvent | NDKEvent) {
  try {
    const meta = JSON.parse(profile.content);
    const name = meta.name || meta.display_name;
    return (
      slugify(name).trim() ||
      slugify(meta.nip05.split("@")[0]).trim() ||
      slugify(meta.lud16.split("@")[0]).trim()
    );
  } catch (e) {
    console.log("Bad profile content", profile.content);
    return "";
  }
}

export async function setPwaSiteAddr(addr: SiteAddr) {
  const naddr = nip19.naddrEncode({
    identifier: addr.identifier,
    pubkey: addr.pubkey,
    relays: addr.relays,
    kind: KIND_SITE,
  });
  await dbi.setSite(naddr, Date.now());
}

export async function getPwaSiteAddr() {
  const site = await dbi.getSite();
  if (!site) return undefined;
  return parseAddr(site.site_id);
}

export async function getCachedSite(
  addr: SiteAddr
): Promise<NostrEvent | undefined> {
  const sites = await dbi.listKindEvents(KIND_SITE, 10);

  // find cached site
  const cachedSite = sites.find(
    (s) => s.pubkey === addr.pubkey && s.d_tag === addr.identifier
  );
  console.log("cache site", cachedSite, sites);

  // drop old cached sites, if any
  const oldSiteIds = sites
    .filter((s) => s.id !== cachedSite?.id)
    .map((s) => s.id);
  await dbi.deleteEvents(oldSiteIds);

  // got cached one
  if (cachedSite) return cachedSite;
  else return undefined;
}

class PluginEndpointImpl implements PluginEndpoint {
  id: string;
  core: PluginInterfaceImpl;

  constructor(id: string, core: PluginInterfaceImpl) {
    this.id = id;
    this.core = core;
  }

  subscribe(event: string, cb: (data: any) => any) {
    this.core.subscribe(this.id, event, cb);
  }

  dispatch(event: string, data: any) {
    this.core.dispatch(this.id, event, data);
  }
}

interface PluginState {
  subs: Map<string, (data: any) => any>;
}

class PluginInterfaceImpl implements PluginInterface {
  plugins: Map<string, PluginState>;

  constructor() {
    this.plugins = new Map();
  }

  subscribe(id: string, event: string, cb: (data: any) => any) {
    this.plugins.get(id)!.subs.set(event, cb);
  }

  dispatch(senderId: string, event: string, data: any) {
    console.log("plugins dispatch", event, "by", senderId, "data", data);
    for (const [id, state] of this.plugins.entries()) {
      const cb = state.subs.get(event);

      // FIXME check plugin is allowed to receive this event
      if (cb) {
        console.log("plugins deliver", event, "to", id, "data", data);
        cb(data);
      }
    }
  }

  register(id: string) {
    if (this.plugins.has(id)) {
      console.warn("Plugin ", id, "already registered");
      return undefined;
    }

    // FIXME check that plugin was added by user

    const state: PluginState = {
      subs: new Map(),
    };
    this.plugins.set(id, state);

    return new PluginEndpointImpl(id, this);
  }
}

class UserInterface {
  $user?: User;
  core: PluginInterface;

  constructor(core: PluginInterface) {
    this.core = core;
    const ep = this.core.register("user-interface");
    ep!.subscribe("auth", (data) => {
      if (data.type === "logout") {
        this.$user = undefined;
      } else {
        this.$user = {
          pubkey: data.pubkey,
          npub: nip19.npubEncode(data.pubkey),
        };
      }
    });

    // how do we inject signup into "Like" flow?
    // - "like" plugin sends "action-like"?
    // - or does each plugin need to check if user is authed,
    // and if now send "need auth" first?
    // - well we don't know if like plugin needs auth or not,
    // it only knows for itself right?
    // - so it sends "need-auth" and waits for next "auth" event?
    // - how can it know if need-auth succeeded or not etc?
    // - so we're kind-of calling a dynamically-defined function
    // and should be able to wait for it's completion? then a) only
    // one if the subscribers should receive it? - no! dispatch event does
    // synchronous processing of all subs, b) should await for
    // all handlers? c) return value from them?

    // and then will itself receive that event and show "signup" modal and when it's
    // done sends "signup"
  }

  user() {
    return () => {
      return this.$user;
    };
  }
}

export function prepareGlobalNostrSite(tmpl: GlobalNostrSite) {
  const s: GlobalNostrSite = { ...tmpl };
  if (!s.renderCurrentPage) s.renderCurrentPage = renderCurrentPage;
  if (!s.nostrTools)
    s.nostrTools = {
      nip19,
    };
  if (!s.html)
    s.html = {
      loadHtml,
    };
  if (!s.utils)
    s.utils = {
      isVideoUrl,
      isAudioUrl,
      isImageUrl,
      getOembedUrl,
      luxon,
    };
  if (!s.dbCache) {
    s.dbCache = {
      putCache: dbi.putCache.bind(dbi),
      getCache: dbi.getCache.bind(dbi),
    };
  }
  // only init on the client inside a browser tab
  if (globalThis.document) {
    if (!s.plugins) {
      s.plugins = new PluginInterfaceImpl();
    }
    if (!s.user) {
      s.user = new UserInterface(s.plugins).user();
    }
  }

  return s;
}

export function startReplacingFeatureImagesWithVideoPreviews() {
  try {
    const images = document.querySelectorAll("img");
    for (const img of images) {
      const src = img.getAttribute("src");
      const srcset = img.getAttribute("srcset");
      if (!src && !srcset) continue;
      const data = src?.startsWith(PLAY_FEATURE_BUTTON_PREFIX) ? src : srcset;
      if (!data || !data.startsWith(PLAY_FEATURE_BUTTON_PREFIX)) continue;

      const url = decodeURIComponent(
        data.split(PLAY_FEATURE_BUTTON_PREFIX)[1].split(";")[0]
      );
      if (!url) continue;

      console.log("injecting video preview", url);

      let html = `
        <video src="${url}" 
          preload="meta" 
          style="width: 100%; height: 100%"
        ></video>
        <img 
          style='opacity: 0.4; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 50px; height: 50px; min-height: 50px; min-width: 50px' 
          src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAACXBIWXMAAAsTAAALEwEAmpwYAAACw0lEQVR4nO2aPWtUQRSGHxXdjaIkEBMLxWCjP0D8BZIQUAxW+UALK5tgSGNrG2OhKIitCGJho66aXiSKtmbzgYWJiJ9FBDWuemTgCGG5e/funJm9F8kLLyzs3jPz7pw5c86ZCxv4f9EFDAHTQAWoAl+ANaX7PKffud+cADopCErAGDAD/AKkRbpnHgGjaqvt6AAmgbcek2/EFWACKLdLxCCwFFBAPReBgZgC3NJfiSignjd15YOiF3jRRhGifA70hBLRp8stOXFB52DCbg2jkjOXgD2+Iso5uZOkuJlXiL5egMlLHa/6hFgpKPuzinDLN1+ACUsDLmY9NCc9jH8DRoA3bRJzLstqrHgKQQ+w88BqZCHLzTb+mKfh73V29gK3gD8RxYykCZnxNPqjgb3DwJNIQipp9YRPKi5abzTCJuCUp8tKCmvArqQBhwxGf9Ic23X/fA0o5ljSQJeM/05W7AfuBNo/F5MGqBgMOpdsFUeAp0Yh95IMLxgM/sYPm4EzwDvPcatJRj8bhDg3sWAHcEHDeCvjfkgytmZc5hA4ANy1hv0iCDmkXRWTEItriZ4XvujSfkAthGtZM94tHgLcM2eBj55jzoUOvz5CXPh9FiP8ThuNbs0oYB9wO9CBOBU6RckiZJvWEauxU5ROQ9IoTeqDk8DrgAJE87vEpNHhcWAhB4GHgQWI8kHa8o8aDHcECKfSAodjlLr/hLjc6TTwPqIA0VLX7blUTBjaNC8jCxDlOBlQzrnXKxky3swdx4ECTFgS6M6eo7SIawWYuNTxMh4oaeNYCsLZLBu8EboLdK3QixF9xjLYynltWARBT05uNquXTVEuQ2O2QWUdb8S+e++P7GpVnxDri5Km5MsBBbgrifG83oAoaVe84pkg1jSLHbaE1tBwtcFxbWPe13r607qXatznV1qeTmlRtDP4LDZAMfAXFbij5naP28kAAAAASUVORK5CYII="
        >
      `;

      // copy styles
      const div = document.createElement("div");
      div.innerHTML = html;

      const styles = window.getComputedStyle(img);
      let cssText = styles.cssText;
      if (!cssText) {
        cssText = Object.values(styles).reduce(
          (css, propertyName) =>
            `${css}${propertyName}:${styles.getPropertyValue(propertyName)};`
        );
      }
      // override position
      div.style.cssText = cssText + "; position: relative";
      // effects
      div.style.opacity = "1";
      div.style.visibility = "visible";
      img.parentNode!.insertBefore(div, img);
      img.remove();
    }
  } catch (e) {
    console.log("failed injecting video previews", e);
  }

  // repeat every 500 ms to make sure
  // posts loaded by pagination are handled too
  setTimeout(startReplacingFeatureImagesWithVideoPreviews, 500);
}

export async function scanRelays(
  ndk: NDK,
  filters: NDKFilter | NDKFilter[],
  relayUrls: string[],
  limit: number,
  options?: {
    since?: number;
    until?: number;
    batchSize?: number;
    timeout?: number;
    threads?: number;
    matcher?: (e: NDKEvent) => boolean;
    onBatch?: (events: NDKEvent[]) => Promise<void>;
  }
) {
  const now = Math.floor(Date.now() / 1000);
  const since = options && options.since ? options.since : 0;
  const until = options && options.until ? options.until : now;
  const timeout = options && options.timeout ? options.timeout : 1000;
  const batchSize = options && options.batchSize ? options.batchSize : 100;
  filters = Array.isArray(filters) ? filters : [filters];

  console.log("scan relays", relayUrls, since, until, timeout);

  interface Relay {
    url: string;
    buffer: NDKEvent[];
    until: number;
    prefetchPromise?: Promise<void>;
  }

  const relays: Relay[] = relayUrls.map((r) => ({
    url: r,
    until,
    buffer: [],
  }));

  const prefetchPromises = new Set();
  const fetch = async () => {
    const fetches = [];
    const prefetches = [];
    const promises = new Set();

    for (const r of relays) {
      // no need to fetch/prefetch?
      if (!r.until || r.buffer.length > 100) continue;

      // already prefetching
      if (r.prefetchPromise) {
        // if we're empty wait for prefetch
        if (!r.buffer.length) promises.add(r.prefetchPromise);
        continue;
      }

      const windowFilters = (filters as NDKFilter[]).map((f) => ({
        ...f,
        until: r.until,
        since,
      }));
      const fetcher = async () => {
        console.log(Date.now(), "scan relay", r.url, "until", r.until);
        const eventSet = await fetchEvents(
          ndk,
          windowFilters,
          [r.url],
          timeout
        );

        // make sure it fits 'since',
        // sort by date desc
        let buffer = [...eventSet].filter((e) => e.created_at! >= since);

        if (options && options.matcher)
          buffer = buffer.filter((e) => options.matcher!(e));

        // append filtered events
        r.buffer.push(...buffer);

        // ensure sort order
        r.buffer.sort((a, b) => b.created_at! - a.created_at!);

        // got something new? until = last event - 1
        if (buffer.length)
          r.until = r.buffer[r.buffer.length - 1].created_at! - 1;
        else r.until = 0; // eof

        console.log(
          Date.now(),
          "scan relay",
          r.url,
          "got",
          buffer.length,
          "buffered",
          r.buffer.length,
          "until",
          r.until,
          "skipped",
          eventSet.size - r.buffer.length
        );
      };

      if (!r.buffer.length) fetches.push(fetcher);
      else prefetches.push({ relay: r, fetcher });
    }

    // throttle to several relays only
    const MAX_BATCH_SIZE = options && options.threads ? options.threads : 5;
    while (fetches.length) {
      // promises might have been populated from prefetches
      if (promises.size < MAX_BATCH_SIZE) {
        const f = fetches.shift()!;
        const promise = f();
        promises.add(promise);
        promise.then(() => {
          promises.delete(promise);
          console.log(Date.now(), "scan done promise, left", promises.size);
        });
      }
      if (promises.size >= MAX_BATCH_SIZE) await Promise.race([...promises]);
    }
    if (promises.size) await Promise.all([...promises]);

    // start some prefetches in the background
    while (prefetchPromises.size < MAX_BATCH_SIZE && prefetches.length) {
      const f = prefetches.shift()!;
      console.log(Date.now(), "scan prefetch", f.relay.url);
      const promise = f.fetcher();
      prefetchPromises.add(promise);
      f.relay.prefetchPromise = promise;
      promise.then(() => {
        prefetchPromises.delete(promise);
        f.relay.prefetchPromise = undefined;
        console.log(
          Date.now(),
          "scan done prefetch, left",
          prefetchPromises.size
        );
      });
    }
  };

  const ids = new Set<string>();
  const events: NDKEvent[] = [];
  const next = () => {
    // find newest event among relays
    let e: NDKEvent | undefined;
    for (const r of relays) {
      if (!r.buffer.length) continue;
      if (!e || e.created_at! < r.buffer[0].created_at!) e = r.buffer[0];
    }

    // console.log("next", e);
    if (!e) return false;

    // add to map
    ids.add(e.id);
    events.push(e);

    // console.log(
    //   Date.now(),
    //   "scan next event",
    //   e.id,
    //   "relay",
    //   relays.find((r) => r.buffer.length && r.buffer[0].id === e!.id)?.url,
    //   "total",
    //   events.length
    // );

    // drop this event from all relays
    for (const r of relays) {
      while (r.buffer.length) {
        if (ids.has(r.buffer[0].id)) {
          // console.log(Date.now(), "scan dup", r.buffer[0].id, "on", r.url);
          r.buffer.shift();
        } else break;
      }
    }

    // got one
    return true;
  };

  const onBatch = async (last?: boolean) => {
    if (!options || !options.onBatch) return;
    if (!last && events.length < batchSize) return;

    const batch = events.splice(0, Math.min(batchSize, events.length));
    batch.sort((a, b) => b.created_at! - a.created_at!);
    await options.onBatch(batch);
  };

  while (ids.size < limit) {
    // make sure we fetch from each relay that has
    // empty buffer and isn't eof
    await fetch();
    // console.log("events", events.size);

    // take the next newest event and put to events map
    if (!next()) break;

    // deliver a batch 
    await onBatch();
  }

  // last one
  await onBatch(true);

  // return sorted newest events,
  // this will be empty if onBatch was specified
  return events.sort((a, b) => b.created_at! - a.created_at!);
}
