import { NostrEvent } from "@nostr-dev-kit/ndk";

export const SUBMIT_STATE_ADD = '';
export const SUBMIT_STATE_REMOVE = 'remove';

export interface Submit {
  event: NostrEvent;
  // "u" tag or event.pubkey
  authorPubkey: string;

  // target
  eventAddress: string;
  pubkey: string;
  kind: number;
  relay: string;
  hashtags: string[];
  state: string; // add/remove
}