import NDK from "@nostr-dev-kit/ndk";
import { Store } from ".";
import { Renderer } from "./renderer";
import { NostrParser } from "..";

// IMPORTANT: any changes here (except for additions) will result
// in incompatibility on all sites with auto-update config
export interface GlobalNostrSite {
  startPwa(): Promise<void>;
  startTab(): Promise<void>;
  startSW(options: { index: string; precacheEntries?: string[] }): void;
  renderCurrentPage(path?: string): Promise<void>;
  newRenderer(): Renderer;
  tabReady?: Promise<void>;
  ndk?: NDK;
  store?: Store;
  parser?: NostrParser;
  nostrTools: {
    nip19: any;
  };
}
