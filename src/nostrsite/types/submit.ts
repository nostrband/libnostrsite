import { NostrEvent } from "@nostr-dev-kit/ndk";

export interface Submit {
  event: NostrEvent;

  // target
  eventAddress: string;
  pubkey: string;
  kind: number;
  relay: string;
  hashtags: string[];
}