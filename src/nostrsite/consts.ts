export const KIND_PROFILE = 0;
export const KIND_CONTACTS = 3;
export const KIND_RELAYS = 10002;
export const KIND_SITE = 30512;
export const KIND_THEME = 30514;
export const KIND_PACKAGE = 1036;
export const KIND_NOTE = 1;
export const KIND_LONG_NOTE = 30023;
export const SUPPORTED_KINDS = [KIND_NOTE, KIND_LONG_NOTE];
export const JQUERY = "https://code.jquery.com/jquery-3.5.1.min.js";
export const DEFAULT_MAX_LIMIT = 20;

export const OUTBOX_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.nos.social",
];

export const FALLBACK_OUTBOX_RELAYS = [
  "wss://relay.nostr.band/all"
];

export const SITE_RELAY = "wss://relay.npubpro.com";

export const BLACKLISTED_RELAYS = [
  "wss://brb.io"
];

export const JS_JQUERY = "https://code.jquery.com/jquery-3.5.1.min.js";
export const JS_VENOBOX = "https://cdn.jsdelivr.net/npm/venobox@2.1.8/dist/venobox.min.js";
export const CSS_VENOBOX = "https://cdn.jsdelivr.net/npm/venobox@2.1.8/dist/venobox.min.css";
//export const JS_ZAPTHREADS = "https://unpkg.com/zapthreads@0.5.2/dist/zapthreads.iife.js";
export const JS_ZAPTHREADS = "https://cdn.npubpro.com/zapthreads.iife.0.5.3.js";
export const JS_NOSTR_LOGIN = "https://unpkg.com/nostr-login@1.5.2/dist/unpkg.js";
export const JS_SEARCH = "https://unpkg.com/nostr-site-search@1.0.9/dist/index.js";
export const JS_ZAP = "https://cdn.npubpro.com/nostr-zap.0.22.0.js";
export const JS_EMBEDS = "https://cdn.npubpro.com/embeds.iife.1.0.0.js";

export const PRECACHE_ENTRIES = [
  // these are static and don't need revision info
  JS_JQUERY,
  JS_VENOBOX,
  CSS_VENOBOX,
  JS_ZAPTHREADS,
  JS_NOSTR_LOGIN,
  JS_SEARCH,
  JS_ZAP
];
