import { Renderer } from "./renderer";

// IMPORTANT: any changes here (except for additions) will result
// in incompatibility on all sites with auto-update config
export interface GlobalNostrSite {
  startPwa(): Promise<void>;
  renderCurrentPage(path?: string): Promise<void>,
  newRenderer(): Renderer,
  startSW(): void;
  nostrTools: {
    nip19: any;
  }
}