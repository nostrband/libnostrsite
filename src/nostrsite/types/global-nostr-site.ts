import { Renderer } from "./renderer";
import { SiteAddr } from "./site-addr";

// IMPORTANT: any changes here (except for additions) will result
// in incompatibility on all sites with auto-update config
export interface GlobalNostrSite {
  startPwa(): Promise<void>;
  renderCurrentPage(): Promise<void>,
  newRenderer(addr: SiteAddr): Renderer,
  startSW(): void;
}