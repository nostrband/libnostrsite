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
import NDK, { NDKEvent, NostrEvent } from "@nostr-dev-kit/ndk";
import { slugify } from "./ghost/helpers/slugify";
import {
  GlobalNostrSite,
  Store,
  fetchEvent,
  fetchOutboxRelays,
  isAudioUrl,
  isImageUrl,
  isVideoUrl,
} from ".";
import { toRGBString } from "./color";
import { dbi } from "./nostrsite/store/db";
import { load as loadHtml } from "cheerio";
import { getOembedUrl } from "./nostrsite/parser/oembed-providers";

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

export async function renderCurrentPage(path = "") {
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
  dbi.deleteEvents(oldSiteIds);

  // got cached one
  if (cachedSite) return cachedSite;
  else return undefined;
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
      fetchEvent,
      getOembedUrl,
    };
  if (!s.dbCache) {
    s.dbCache = {
      putCache: dbi.putCache.bind(dbi),
      getCache: dbi.getCache.bind(dbi),
    };
  }

  return s;
}
