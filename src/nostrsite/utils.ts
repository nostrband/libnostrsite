import NDK, { NDKRelaySet } from "@nostr-dev-kit/ndk";
import { KIND_CONTACTS, KIND_RELAYS, OUTBOX_RELAYS } from ".";

export function isBlossomUrl(u: string) {
  try {
    const url = new URL(u);
    const pathExt = url.pathname.split(".");
    const segments = pathExt[0].split("/");
    // path must be /sha256-hex(.ext)?
    const isNot = pathExt.length > 2 || segments.length > 2 || segments[1].length != 64;
    return !isNot;  
  } catch {
    return false;
  }
}

export interface PromiseQueueCb {
  cb: (...args: any[]) => Promise<void>
  args: any[]
}

export class PromiseQueue {
  queue: PromiseQueueCb[] = []

  constructor() {}

  appender(cb: (...cbArgs: any[]) => Promise<void>): (...apArgs: any[]) => void {
    return (...args) => {
      this.queue.push({ cb, args })
      if (this.queue.length === 1) this.execute()
    }
  }

  async execute() {
    // the next cb in the queue
    const { cb, args } = this.queue[0]

    // execute the next cb
    await cb(...args)

    // mark the last cb as done
    this.queue.shift()

    // have the next one? proceed
    if (this.queue.length > 0) this.execute()
  }
}

export async function fetchOutboxRelays(ndk: NDK, pubkeys: string[]) {
  const events = await ndk.fetchEvents(
    {
      // @ts-ignore
      kinds: [KIND_CONTACTS, KIND_RELAYS],
      authors: pubkeys,
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls(OUTBOX_RELAYS, ndk)
  );

  const writeRelays = [];

  for (const e of events) {
    if (e.kind === KIND_RELAYS) {
      writeRelays.push(
        ...e.tags
          .filter(
            (t) =>
              t.length >= 2 &&
              t[0] === "r" &&
              (t.length === 2 || t[2] === "write")
          )
          .map((t) => t[1])
      );
    } else {
      try {
        const relays = JSON.parse(e.content);
        for (const url in relays) {
          if (relays[url].write) writeRelays.push(url);
        }
      } catch {}
    }
  }

  return [...new Set(writeRelays)];
} 
