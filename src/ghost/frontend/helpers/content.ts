// # Content Helper
// Usage: `{{content}}`, `{{content words="20"}}`, `{{content characters="256"}}`
//
// Turns content html into a safestring so that the user doesn't have to
// escape it or tell handlebars to leave it alone with a triple-brace.
//
// Shows default or custom CTA when trying to see content without access
//
// Enables tag-safe truncation of content by characters or words.
//
// Dev flag feature: In case of restricted content access for member-only posts, shows CTA box

// @ts-ignore
import downsize from "downsize-cjs";
import merge from "lodash-es/merge";
import isUndefined from "lodash-es/isUndefined";
import { getRenderer } from "../services/renderer";
import { templates } from "../services/theme-engine/handlebars/template";
import { OUTBOX_RELAYS } from "../../..";

const hexToRgb = (hex: string) => {
  hex = hex.replace(/^#/, "");

  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }

  const bigint = parseInt(hex, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return { r, g, b };
};
const getBrightness = ({ r, g, b }: { r: number; g: number; b: number }) => {
  return (r * 299 + g * 587 + b * 114) / 1000;
};

const getContrastingTextColor = (hex: string) => {
  const rgb = hexToRgb(hex);
  const brightness = getBrightness(rgb);
  return brightness < 128 ? "#fff" : "#000";
};

function restrictedCta(options: any) {
  const { hbs } = getRenderer(options);
  const createFrame = hbs.handlebars.createFrame;

  options = options || {};
  options.data = options.data || {};

  // @ts-ignore
  const self: any = this;

  merge(self, {
    // @deprecated in Ghost 5.16.1 - not documented & removed from core templates
    accentColor: options.data.site && options.data.site.accent_color,
  });

  const data = createFrame(options.data);
  return templates.execute("content-cta", self, { data }, hbs);
}

export default function content(options: any = {}) {
  const { SafeString } = getRenderer(options);

  const site = options.data.site;

  // @ts-ignore
  const self: any = this;

  const hash = options.hash || {};
  const truncateOptions: any = {};
  let runTruncate = false;

  for (const key of ["words", "characters"]) {
    if (Object.prototype.hasOwnProperty.call(hash, key)) {
      runTruncate = true;
      truncateOptions[key] = parseInt(hash[key], 10);
    }
  }

  if (self.html === null) {
    self.html = "";
  }

  if (!isUndefined(self.access) && !self.access) {
    // NOTE: returns SafeString already
    return restrictedCta.apply(self, options);
  }

  let html = self.html;
  if (runTruncate)
    html = downsize(self.html, truncateOptions);

  html = `<np-content id="${self.id}">${html}</np-content>`;

  // some contributor relays to fetch their replies
  const relays = [
    ...new Set([
      ...OUTBOX_RELAYS,
      ...site.contributor_inbox_relays,
      ...site.contributor_relays,
    ]),
  ];
  if (relays.length > 10) relays.length = 10;

  if (site.config.get("no_default_plugins") !== "true") {
    // FIXME replace w/ HBS template to avoid code injection
    html += `<np-content-cta
      data-cta-list="zap,open-with"
      data-cta-main="zap"
      data-button-color="${site.accent_color}"
      data-text-button-color="${getContrastingTextColor(
        site.accent_color
      )}"
    ></np-content-cta>
    <div
      style="display: none"
      id="zap-button"
      data-anon="true"
      data-npub="${self.npub}"
      data-note-id="${self.noteId}"
      data-relays="${relays.join(",")}"
      data-button-color="${site.accent_color}"
    ></div>
    `;

    html += `<zap-threads 
  mode="chat"
  anchor="${self.id}"
  relays="${relays.join(",")}"
  ></zap-threads>`;
  }

  return new SafeString(html);
}
