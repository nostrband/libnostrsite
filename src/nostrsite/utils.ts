import NDK, {
  NDKEvent,
  NDKFilter,
  NDKRelaySet,
  NostrEvent,
} from "@nostr-dev-kit/ndk";
import {
  BLACKLISTED_RELAYS,
  BLOSSOM_FALLBACKS,
  FALLBACK_OUTBOX_RELAYS,
  FALLBACK_RELAYS,
  GOOD_RELAYS,
  KIND_CONTACTS,
  KIND_FILE_METADATA,
  KIND_RELAYS,
  KIND_SITE,
  KIND_SITE_FILE,
  OUTBOX_RELAYS,
  Site,
  StoreObject,
  eventId,
  tv,
} from ".";
import { isPost, isTag, isUser } from "../ghost/frontend/utils/checks";
import { isEqual, toNumber } from "lodash-es";
import { parseAddr } from "..";

export function isBlossomUrl(u: string) {
  try {
    const url = new URL(u);
    const pathExt = url.pathname.split(".");
    const segments = pathExt[0].split("/");
    // path must be /sha256-hex(.ext)?
    const isNot =
      pathExt.length > 2 || segments.length > 2 || segments[1].length != 64;
    return !isNot;
  } catch {
    return false;
  }
}

export function findImeta(event: NostrEvent, u: string) {
  return event.tags
    .filter((t) => t.length > 1 && t[0] === "imeta")
    .find((t) => t.find((v) => v === `url ${u}`));
}

export function findMimeType(event: NostrEvent, u: string) {
  if (event.kind === KIND_FILE_METADATA) {
    return tv(event, "m");
  } else {
    return findImeta(event, u)
      ?.find((v) => v.startsWith("m "))
      ?.slice(2);
  }
}

export function isImageUrl(u: string, event?: NostrEvent) {
  try {
    const url = new URL(u);
    const ext = url.pathname.split(".").pop();
    switch (ext?.toLowerCase()) {
      case "png":
      case "svg":
      case "jpg":
      case "jpeg":
      case "gif":
      case "tif":
      case "tiff":
      case "webp":
        return true;
    }

    // no '.' in the last part of path?
    if (ext?.includes("/") && event) {
      const mime = findMimeType(event, u);
      return mime && mime.startsWith("image/");
    }
  } catch {}
  return false;
}

export function isVideoUrl(u: string, event?: NostrEvent) {
  try {
    const url = new URL(u);
    const ext = url.pathname.split(".").pop();
    switch (ext?.toLowerCase()) {
      case "mp4":
      case "avi":
      case "mpeg":
      case "mkv":
      case "mov":
      case "webm":
      case "ogv":
        return true;
    }

    if (ext?.includes("/") && event) {
      const mime = findMimeType(event, u);
      return mime && mime.startsWith("video/");
    }
  } catch {}
  return false;
}

export function isAudioUrl(u: string, event?: NostrEvent) {
  try {
    const url = new URL(u);
    const ext = url.pathname.split(".").pop();
    switch (ext?.toLowerCase()) {
      case "mp3":
      case "aac":
      case "ogg":
      case "wav":
      case "weba":
      case "m3u":
      case "m3u8":
        return true;
    }

    if (ext?.includes("/") && event) {
      const mime = findMimeType(event, u);
      return mime && mime.startsWith("audio/");
    }
  } catch {}
  return false;
}

export interface PromiseQueueCb {
  cb: (...args: any[]) => Promise<void>;
  args: any[];
}

export class PromiseQueue {
  queue: PromiseQueueCb[] = [];

  constructor() {}

  appender(
    cb: (...cbArgs: any[]) => Promise<void>
  ): (...apArgs: any[]) => void {
    return (...args) => {
      this.queue.push({ cb, args });
      if (this.queue.length === 1) this.execute();
    };
  }

  async execute() {
    // the next cb in the queue
    const { cb, args } = this.queue[0];

    // execute the next cb
    await cb(...args);

    // mark the last cb as done
    this.queue.shift();

    // have the next one? proceed
    if (this.queue.length > 0) this.execute();
  }
}

export function parseRelayEvents(events: Set<NDKEvent>) {
  const pubkeyRelays = new Map<
    string,
    {
      writeRelays: string[];
      readRelays: string[];
    }
  >();

  for (const e of events) {
    const pr = pubkeyRelays.get(e.pubkey) || {
      writeRelays: [],
      readRelays: [],
    };
    if (e.kind === KIND_RELAYS) {
      const filter = (mark: string) => {
        return e.tags
          .filter(
            (t) =>
              t.length >= 2 && t[0] === "r" && (t.length === 2 || t[2] === mark)
          )
          .map((t) => t[1]);
      };
      pr.writeRelays.push(...filter("write"));
      pr.readRelays.push(...filter("read"));
    } else {
      try {
        const relays = JSON.parse(e.content);
        for (const url in relays) {
          if (relays[url].write) pr.writeRelays.push(url);
          if (relays[url].read) pr.readRelays.push(url);
        }
      } catch {}
    }
    pubkeyRelays.set(e.pubkey, pr);
  }

  return pubkeyRelays;
}

export function prepareRelays(
  pubkeyRelays: Map<
    string,
    {
      writeRelays: string[];
      readRelays: string[];
    }
  >,
  maxRelaysPerPubkey: number,
  addFallback = false
) {
  const prepare = (relays: string[], maxRelaysPerPubkey: number) => {
    // normalize
    const normal = relays
      // normalize urls
      .map((r) => {
        try {
          const u = new URL(r);
          if (u.protocol !== "wss:" && u.protocol !== "ws:") return undefined;
          if (u.hostname.endsWith(".onion")) return undefined;
          if (u.hostname === "localhost") return undefined;
          if (u.hostname === "127.0.0.1") return undefined;
          return u.href;
        } catch {}
      })
      // only valid ones
      .filter((u) => !!u)
      // remove bad relays and outbox
      .filter(
        (r) => !BLACKLISTED_RELAYS.includes(r!) && !OUTBOX_RELAYS.includes(r!)
      ) as string[];

    // dedup
    const uniq = [...new Set(normal)];

    // prioritize good relays
    const good = uniq.sort((a, b) => {
      const ga = GOOD_RELAYS.includes(a);
      const gb = GOOD_RELAYS.includes(b);
      if (ga == gb) return 0;
      return ga ? -1 : 1;
    });

    if (good.length > maxRelaysPerPubkey) good.length = maxRelaysPerPubkey;

    if (addFallback) good.push(...FALLBACK_RELAYS);

    return good;
  };

  // sanitize and prioritize per pubkey
  for (const rs of pubkeyRelays.values()) {
    rs.readRelays = prepare(rs.readRelays, maxRelaysPerPubkey);
    rs.writeRelays = prepare(rs.writeRelays, maxRelaysPerPubkey);

    // NOTE: some people mistakenly mark all relays as write/read
    if (!rs.readRelays.length) rs.readRelays = rs.writeRelays;
    if (!rs.writeRelays.length) rs.writeRelays = rs.readRelays;
  }

  // merge and dedup all write/read relays
  return {
    write: [
      ...new Set([...pubkeyRelays.values()].map((pr) => pr.writeRelays).flat()),
    ],
    read: [
      ...new Set([...pubkeyRelays.values()].map((pr) => pr.readRelays).flat()),
    ],
  };
}

export async function fetchRelays(
  ndk: NDK,
  pubkeys: string[],
  maxRelaysPerPubkey: number = 10,
  addFallback = false
) {
  const events = await fetchEvents(
    ndk,
    {
      // @ts-ignore
      kinds: [KIND_CONTACTS, KIND_RELAYS],
      authors: pubkeys,
    },
    OUTBOX_RELAYS,
    2000
  );
  const pubkeyRelays = parseRelayEvents(events);

  console.log("relays", events, pubkeyRelays);
  const emptyPubkeys = [...pubkeyRelays.entries()]
    .map(([pubkey, relays]) => {
      if (!relays.readRelays.length && !relays.writeRelays.length)
        return pubkey;
    })
    .filter((p) => !!p) as string[];

  if (emptyPubkeys.length) {
    // all right let's add nostr.band and higher timeout
    const moreEvents = await fetchEvents(
      ndk,
      {
        // @ts-ignore
        kinds: [KIND_CONTACTS, KIND_RELAYS],
        authors: emptyPubkeys,
      },
      [...FALLBACK_OUTBOX_RELAYS, ...OUTBOX_RELAYS],
      5000
    );
    for (const e of [...moreEvents]) events.add(e);

    const morePubkeyRelays = parseRelayEvents(events);
    for (const [p, rs] of morePubkeyRelays.entries()) pubkeyRelays.set(p, rs);
  }

  const relays = prepareRelays(pubkeyRelays, maxRelaysPerPubkey, addFallback);
  return {
    ...relays,
    // return all events too to let client cache them
    events: [...events],
  };
}

export async function fetchOutboxRelays(ndk: NDK, pubkeys: string[]) {
  return (await fetchRelays(ndk, pubkeys)).write;
}

export async function fetchInboxRelays(ndk: NDK, pubkeys: string[]) {
  return (await fetchRelays(ndk, pubkeys)).read;
}

export async function fetchEvents(
  ndk: NDK,
  filters: NDKFilter | NDKFilter[],
  relays: string[],
  timeoutMs: number = 1000
): Promise<Set<NDKEvent>> {
  if (!filters || (Array.isArray(filters) && !filters.length))
    throw new Error("Empty filters");
  relays = [...new Set(relays.filter((r) => !BLACKLISTED_RELAYS.includes(r)))];

  // don't go crazy here! just put higher-priority relays to
  // the front of this array
  if (relays.length > 20) relays.length = 20;

  let eose = false;
  const events = new Map<string, NDKEvent>();
  const sub = ndk.subscribe(
    filters,
    {
      groupable: false,
    },
    NDKRelaySet.fromRelayUrls(relays, ndk),
    false // autoStart
  );

  const start = Date.now();
  return new Promise<Set<NDKEvent>>((ok) => {
    const onEose = async () => {
      if (timeout) clearTimeout(timeout);
      if (eose) return;
      eose = true;
      sub.stop();
      console.log(
        "fetched in",
        Date.now() - start,
        "ms from",
        relays,
        "by",
        filters,
        "events",
        [...events.values()]
      );
      ok(new Set(events.values()));
    };

    const timeout = setTimeout(() => {
      console.warn(Date.now(), "fetch timeout");
      onEose();
    }, timeoutMs);

    sub.on("eose", onEose);
    sub.on("event", async (e) => {
      if (eose) return;
      const id = eventId(e);
      const ex = events.get(id);
      if (!ex || ex.created_at! < e.created_at) {
        events.set(id, e);
      }
    });

    sub.start();
  });
}

export async function fetchEvent(
  ndk: NDK,
  filters: NDKFilter | NDKFilter[],
  relays: string[],
  timeoutMs: number = 1000
): Promise<NDKEvent | undefined> {
  // ensure proper limit
  if (Array.isArray(filters)) filters.forEach((f) => (f.limit = 1));
  else filters.limit = 1;

  const events = await fetchEvents(ndk, filters, relays, timeoutMs);
  if (events.size) return events.values().next().value;
  return undefined;
}

export function getRelativeUrlPrefix(o: StoreObject) {
  if (isPost(o)) return "post/";
  else if (isTag(o)) return "tag/";
  else if (isUser(o)) return "author/";
  else throw new Error("Unknown data type");
}

export function getUrlMediaMime(u: string) {
  try {
    const url = new URL(u);
    const ext = url.pathname.split(".").pop();
    switch (ext?.toLowerCase()) {
      case "mp4":
        return "video/mp4";
      case "avi":
        return "video/x-msvideo";
      case "mpeg":
        return "video/mpeg";
      case "mkv":
        return "video/x-matroska";
      case "mov":
        return "video/quicktime";
      case "webm":
        return "video/webm";
      case "ogv":
        return "video/ogg";

      case "png":
        return "image/png";
      case "svg":
        return "image/svg+xml";
      case "jpg":
        return "image/jpeg";
      case "jpeg":
        return "image/jpeg";
      case "gif":
        return "image/gif";
      case "tif":
        return "image/tiff";
      case "tiff":
        return "image/tiff";
      case "webp":
        return "image/webp";

      case "mp3":
        return "audio/mpeg";
      case "aac":
        return "audio/aac";
      case "ogg":
        return "audio/ogg";
      case "oga":
        return "audio/ogg";
      case "wav":
        return "audio/wav";
      case "weba":
        return "audio/webm";
    }
  } catch {}
  return "";
}

export function isEqualContentSettings(a: Site, b: Site) {
  return (
    isEqual(a.contributor_pubkeys, b.contributor_pubkeys) &&
    isEqual(a.include_all, b.include_all) &&
    isEqual(a.include_kinds, b.include_kinds) &&
    isEqual(a.include_manual, b.include_manual) &&
    isEqual(a.include_relays, b.include_relays) &&
    isEqual(a.include_tags, b.include_tags)
  );
}

export function ensureNumber(v: any | undefined): number | undefined {
  if (v === undefined) return undefined;
  return toNumber(v);
}

export function normalizeRelayUrl(r: string) {
  try {
    return new URL(r).href;
  } catch {
    return undefined;
  }
}
export function hintsToRelays(relayHints: string[]): string[] {
  return [
    ...new Set(
      relayHints
        .map((r) => normalizeRelayUrl(r))
        .filter((r) => !!r && !BLACKLISTED_RELAYS.includes(r)) as string[]
    ),
  ];
}

export async function fetchBlossom(url: string) {
  const u = new URL(url);
  const hash = u.pathname.split("/")[1];

  // empty file
  if (
    hash === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  )
    return new Response("", { status: 200 });

  // try several servers - fallbacks have discovery
  // enabled and might find the file even if it's
  // never been uploaded to them
  const urls = [
    url,
    ...BLOSSOM_FALLBACKS.map((s) => s + u.pathname + u.search),
  ];

  for (const su of urls) {
    try {
      const controller = new AbortController();
      const signal = controller.signal;
      const to = setTimeout(() => {
        controller.abort();
        console.log("blossom fetch timeout", su);
      }, 3000);
      const r = await fetch(su, { signal });
      clearTimeout(to);
      if (r.status !== 200) throw new Error("Failed to fetch " + su);
      // FIXME check hash of payload!
      console.debug("fetched from network", url, su, r.status);
      return r;
    } catch (e) {
      console.warn("failed to fetched from network", su, e);
    }
  }

  throw new Error("Failed to fetch asset " + url);
}

export async function fetchSiteFile(
  ndk: NDK,
  naddr: string,
  name: string,
  relays: string[]
) {
  const addr = parseAddr(naddr);
  const s_tag = `${KIND_SITE}:${addr.pubkey}:${addr.identifier}`;
  const d_tag = `${name}:${s_tag}`;
  return fetchEvent(
    ndk,
    {
      "#d": [d_tag],
      "#s": [s_tag],
      authors: [addr.pubkey],
      // @ts-ignore
      kinds: [KIND_SITE_FILE],
    },
    relays,
    1000
  );
}
