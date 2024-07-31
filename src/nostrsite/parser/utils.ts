import { NDKEvent, NostrEvent } from "@nostr-dev-kit/ndk";
import { nip19 } from "nostr-tools";

export function tags(
  event: NDKEvent | NostrEvent,
  name: string,
  len: number = 2
): string[][] {
  return event.tags.filter((t) => t.length >= len && t[0] === name);
}

export function tag(event: NDKEvent | NostrEvent, name: string): string[] | null {
  return tags(event, name)?.[0];
}

export function tvs(event: NDKEvent | NostrEvent, name: string): string[] | null {
  return tag(event, name)?.slice(1) || null;
}

export function tv(event: NDKEvent | NostrEvent, name: string): string | null {
  return tvs(event, name)?.[0] || null;
}

export function eventAddr(e: NDKEvent | NostrEvent) {
  return {
    identifier: tv(e, "d") || "",
    pubkey: e.pubkey,
    kind: e.kind || 0,
  };
}

export function eventId(e: NDKEvent | NostrEvent) {
  if (
    e.kind === 0 ||
    e.kind === 3 ||
    // @ts-ignore
    (e.kind >= 10000 && e.kind < 20000) ||
    // @ts-ignore
    (e.kind >= 30000 && e.kind < 40000)
  ) {
    return nip19.naddrEncode(eventAddr(e));
  } else {
    return nip19.noteEncode(e.id!);
  }
}

export function profileId(e: NDKEvent | NostrEvent | string) {
  if (typeof e === "string")
    return nip19.npubEncode(e);
  else
    return nip19.npubEncode(e.pubkey);
}

