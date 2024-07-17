import NDK, { NDKEvent, NDKFilter, NDKRelaySet } from "@nostr-dev-kit/ndk";
import {
  BLACKLISTED_RELAYS,
  FALLBACK_OUTBOX_RELAYS,
  KIND_CONTACTS,
  KIND_RELAYS,
  OUTBOX_RELAYS,
  StoreObject,
  eventId,
} from ".";
import { isPost, isTag, isUser } from "../ghost/frontend/utils/checks";

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

export async function fetchRelays(ndk: NDK, pubkeys: string[]) {

  const writeRelays: string[] = [];
  const readRelays: string[] = [];

  const parseRelays = (events: Set<NDKEvent>) => {
    for (const e of events) {
      if (e.kind === KIND_RELAYS) {
        const filter = (mark: string) => {
          return e.tags
            .filter(
              (t) =>
                t.length >= 2 && t[0] === "r" && (t.length === 2 || t[2] === mark)
            )
            .map((t) => t[1]);
        };
        writeRelays.push(...filter("write"));
        readRelays.push(...filter("read"));
      } else {
        try {
          const relays = JSON.parse(e.content);
          for (const url in relays) {
            if (relays[url].write) writeRelays.push(url);
            if (relays[url].read) readRelays.push(url);
          }
        } catch {}
      }
    }  
  }

  let events = await fetchEvents(
    ndk,
    {
      // @ts-ignore
      kinds: [KIND_CONTACTS, KIND_RELAYS],
      authors: pubkeys,
    },
    OUTBOX_RELAYS,
    2000
  );
  parseRelays(events);
  console.log("relays", events, readRelays, writeRelays);
  if (!readRelays.length && !writeRelays.length) {
    // all right let's add nostr.band and higher timeout
    events = await fetchEvents(
      ndk,
      {
        // @ts-ignore
        kinds: [KIND_CONTACTS, KIND_RELAYS],
        authors: pubkeys,
      },
      [...FALLBACK_OUTBOX_RELAYS, ...OUTBOX_RELAYS],
      5000
    );
    parseRelays(events);
  }

  // NOTE: some people mistakenly mark all relays as write/read
  return {
    write: [...new Set(writeRelays.length ? writeRelays : readRelays)],
    read: [...new Set(readRelays.length ? readRelays : writeRelays)],
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
  relays = [...new Set(relays.filter((r) => !BLACKLISTED_RELAYS.includes(r)))];

  // don't go crazy here! just put higher-priority relays to
  // the front of this array
  if (relays.length > 10) relays.length = 10;

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