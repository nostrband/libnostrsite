export const KIND_PROFILE = 0;
export const KIND_CONTACTS = 3;
export const KIND_RELAYS = 10002;
export const KIND_PINNED_TO_SITE = 30516;
export const KIND_SITE = 30512;
export const KIND_THEME = 30514;
export const KIND_SITE_SUBMIT = 30517;
export const KIND_SITE_FILE = 30518;
export const KIND_PACKAGE = 1036;
export const KIND_NOTE = 1;
export const KIND_LONG_NOTE = 30023;
export const KIND_LIVE_EVENT = 30311;
export const KIND_MUSIC = 31337;
export const SUPPORTED_KINDS = [KIND_NOTE, KIND_LONG_NOTE, KIND_MUSIC];
export const JQUERY = "https://code.jquery.com/jquery-3.5.1.min.js";
export const DEFAULT_MAX_LIMIT = 20;

export const MAX_OBJECTS_SSR = 3000;
export const MAX_OBJECTS_SW = 1000;
export const MAX_OBJECTS_IIFE = 50;
export const MAX_OBJECTS_PREVIEW = 50;
export const MAX_OBJECTS_TAB = 1000;

export const DEFAULT_POSTS_PER_PAGE = 8;
export const POSTS_PER_RSS = 20;

export const OUTBOX_RELAYS = [
  "wss://purplepag.es/",
  "wss://user.kindpag.es/",
  "wss://relay.nos.social/",
];

export const FALLBACK_OUTBOX_RELAYS = ["wss://relay.nostr.band/all"];

export const SITE_RELAY = "wss://relay.npubpro.com/";

export const BLACKLISTED_RELAYS = ["wss://brb.io/"];

export const GOOD_RELAYS = [
  "wss://relay.damus.io/",
  "wss://relay.nostr.band/",
  "wss://nos.lol/",
  "wss://nostr.wine/",
  "wss://nostr.land/",
  "wss://relay.primal.net/",
  "wss://relay.oxtr.dev/",
];

export const JS_JQUERY = "https://code.jquery.com/jquery-3.5.1.min.js";
export const JS_VENOBOX =
  "https://cdn.jsdelivr.net/npm/venobox@2.1.8/dist/venobox.min.js";
export const CSS_VENOBOX =
  "https://cdn.jsdelivr.net/npm/venobox@2.1.8/dist/venobox.min.css";
export const JS_ZAPTHREADS = "https://cdn.npubpro.com/zapthreads.iife.0.6.2.js";
export const JS_ZAPTHREADS_PLUGIN = "https://cdn.npubpro.com/nostr-site-zapthreads.1.0.2.js";
export const JS_NOSTR_LOGIN =
  "https://unpkg.com/nostr-login@1.7.1/dist/unpkg.js";
export const JS_SEARCH =
  "https://unpkg.com/nostr-site-search@1.0.12/dist/index.js";
export const JS_ZAP = "https://cdn.npubpro.com/nostr-zap.0.22.2.js";
export const JS_EMBEDS = "https://cdn.npubpro.com/embeds.iife.1.0.4.js";
export const JS_CONTENT_CTA =
  "https://cdn.npubpro.com/content-cta.iife.1.0.22.js";
export const JS_MAPTALKS = "https://cdn.npubpro.com/maptalks.min.js";
export const CSS_MAPTALKS = "https://cdn.npubpro.com/maptalks.css";

export const BLOSSOM_FALLBACKS = [
  "https://blossom.npubpro.com",
  "https://cdn.hzrd149.com",
];

export const PRECACHE_ENTRIES = [
  // these are static and don't need revision info
  JS_JQUERY,
  JS_VENOBOX,
  CSS_VENOBOX,
  JS_ZAPTHREADS,
  JS_NOSTR_LOGIN,
  JS_SEARCH,
  JS_ZAP,
  JS_EMBEDS,
  JS_CONTENT_CTA,
];
