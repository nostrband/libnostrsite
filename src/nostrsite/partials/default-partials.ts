import { CANCEL_LINK_PARTIAL } from "./cancel_link";
import { CONTENT_CTA_PARTIAL } from "./content-cta";
import { EMBED_EVENT_PARTIAL } from "./embed-event";
import { EMBED_URL_PARTIAL } from "./embed-url";
import { NAVIGATION_PARTIAL } from "./navigation";
import { PAGINATION_PARTIAL } from "./pagination";
import { RECOMMENDATION_PARTIAL } from "./recommendations";

export const DEFAULT_PARTIALS_DIR_NAME = "default-partials";

export const DEFAULT_PARTIALS: any = {
  "cancel_link.hbs": CANCEL_LINK_PARTIAL,
  "content-cta.hbs": CONTENT_CTA_PARTIAL,
  "navigation.hbs": NAVIGATION_PARTIAL,
  "pagination.hbs": PAGINATION_PARTIAL,
  "recommendations.hbs": RECOMMENDATION_PARTIAL,
  "embed-url.hbs": EMBED_URL_PARTIAL,
  "embed-event.hbs": EMBED_EVENT_PARTIAL,
};
