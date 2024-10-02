// # Ghost Head Helper
// Usage: `{{ghost_head}}`
//
// Outputs scripts and other assets at the top of a Ghost theme

// BAD REQUIRE
// @TODO fix this require
// import cardAssetService from "../services/card-assets";

import { getRenderer } from "../services/renderer";
import findLastIndex from "lodash-es/findLastIndex";
import includes from "lodash-es/includes";
import { CSS_MAPTALKS, CSS_VENOBOX, JQUERY } from "../../../nostrsite/consts";
import { nip19 } from "nostr-tools";
import { PLAY_FEATURE_BUTTON_PREFIX } from "../../..";

function getMime(url: string) {
  const path = new URL(url).pathname;
  const ext = path.split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "ico":
      return "image/vnd.microsoft.icon";
    case "jpg":
      return "image/jpeg";
    case "jpeg":
      return "image/jpeg";
  }
  return "";
}

//import templateStyles from "./tpl/styles";
// import {
//   getFrontendAppConfig,
//   getDataAttributes,
// } from "../utils/frontend-apps";

// const {
//   // get: getMetaData,
//   getAssetUrl,
// } = metaData;

// function writeMetaTag(property: string, content: string, type?: string) {
//   type = type || property.substring(0, 7) === "twitter" ? "name" : "property";
//   return "<meta " + type + '="' + property + '" content="' + content + '">';
// }

// function getMembersHelper(data) {
//   // Do not load Portal if both Memberships and Tips & Donations are disabled
//   if (
//     !settingsCache.get("members_enabled") &&
//     !(settingsCache.get("donations_enabled") && labs.isSet("tipsAndDonations"))
//   ) {
//     return "";
//   }

//   const { scriptUrl } = getFrontendAppConfig("portal");

//   const colorString =
//     _.has(data, "site._preview") && data.site.accent_color
//       ? data.site.accent_color
//       : "";
//   const attributes = {
//     i18n: labs.isSet("i18n"),
//     ghost: urlUtils.getSiteUrl(),
//     key: frontendKey,
//     api: urlUtils.urlFor("api", { type: "content" }, true),
//   };
//   if (colorString) {
//     attributes["accent-color"] = colorString;
//   }
//   const dataAttributes = getDataAttributes(attributes);

//   let membersHelper = `<script defer src="${scriptUrl}" ${dataAttributes} crossorigin="anonymous"></script>`;
//   membersHelper += `<style id="gh-members-styles">${templateStyles}</style>`;
//   if (settingsCache.get("paid_members_enabled")) {
//     // disable fraud detection for e2e tests to reduce waiting time
//     const isFraudSignalsEnabled =
//       process.env.NODE_ENV === "testing-browser"
//         ? "?advancedFraudSignals=false"
//         : "";

//     membersHelper += `<script async src="https://js.stripe.com/v3/${isFraudSignalsEnabled}"></script>`;
//   }
//   return membersHelper;
// }

// function getSearchHelper() {
//   const adminUrl = urlUtils.getAdminUrl() || urlUtils.getSiteUrl();
//   const { scriptUrl, stylesUrl } = getFrontendAppConfig("sodoSearch");

//   if (!scriptUrl) {
//     return "";
//   }

//   const attrs = {
//     key: frontendKey,
//     styles: stylesUrl,
//     "sodo-search": adminUrl,
//   };
//   const dataAttrs = getDataAttributes(attrs);
//   let helper = `<script defer src="${scriptUrl}" ${dataAttrs} crossorigin="anonymous"></script>`;

//   return helper;
// }

// function getAnnouncementBarHelper(data) {
//   const preview = data?.site?._preview;
//   const isFilled =
//     settingsCache.get("announcement_content") &&
//     settingsCache.get("announcement_visibility").length;

//   if (!isFilled && !preview) {
//     return "";
//   }

//   const { scriptUrl } = getFrontendAppConfig("announcementBar");
//   const siteUrl = urlUtils.getSiteUrl();
//   const announcementUrl = new URL("members/api/announcement/", siteUrl);
//   const attrs = {
//     "announcement-bar": siteUrl,
//     "api-url": announcementUrl,
//   };

//   if (preview) {
//     const searchParam = new URLSearchParams(preview);
//     const announcement = searchParam.get("announcement");
//     const announcementBackground = searchParam.has("announcement_bg")
//       ? searchParam.get("announcement_bg")
//       : "";
//     const announcementVisibility = searchParam.has("announcement_vis");

//     if (!announcement || !announcementVisibility) {
//       return;
//     }
//     attrs.announcement = escapeExpression(announcement);
//     attrs["announcement-background"] = escapeExpression(announcementBackground);
//     attrs.preview = true;
//   }

//   const dataAttrs = getDataAttributes(attrs);
//   let helper = `<script defer src="${scriptUrl}" ${dataAttrs} crossorigin="anonymous"></script>`;

//   return helper;
// }

// function getWebmentionDiscoveryLink() {
//   try {
//     const siteUrl = urlUtils.getSiteUrl();
//     const webmentionUrl = new URL("webmentions/receive/", siteUrl);
//     return `<link href="${webmentionUrl.href}" rel="webmention">`;
//   } catch (err) {
//     console.warn(err);
//     return "";
//   }
// }

/**
 * **NOTE**
 * Express adds `_locals`, see https://github.com/expressjs/express/blob/4.15.4/lib/response.js#L962.
 * But `options.data.root.context` is available next to `root._locals.context`, because
 * Express creates a `renderOptions` object, see https://github.com/expressjs/express/blob/4.15.4/lib/application.js#L554
 * and merges all locals to the root of the object. Very confusing, because the data is available in different layers.
 *
 * Express forwards the data like this to the hbs engine:
 * {
 *   post: {},             - res.render('view', databaseResponse)
 *   context: ['post'],    - from res.locals
 *   safeVersion: '1.x',   - from res.locals
 *   _locals: {
 *     context: ['post'],
 *     safeVersion: '1.x'
 *   }
 * }
 *
 * hbs forwards the data to any hbs helper like this
 * {
 *   data: {
 *     site: {},
 *     labs: {},
 *     config: {},
 *     root: {
 *       post: {},
 *       context: ['post'],
 *       locals: {...}
 *     }
 *  }
 *
 * `site`, `labs` and `config` are the templateOptions, search for `hbs.updateTemplateOptions` in the code base.
 *  Also see how the root object gets created, https://github.com/wycats/handlebars.js/blob/v4.0.6/lib/handlebars/runtime.js#L259
 */
// We use the name ghost_head to match the helper for consistency:
export default async function ghost_head(options: any) {
  // eslint-disable-line camelcase
  // debug('begin');

  const { escapeExpression, SafeString, urlUtils, renderOptions } =
    getRenderer(options);

  // FIXME if bad url - get that from root data and don't render the meta
  // if server error page do nothing
  if (options.data.root.statusCode >= 500) {
    return;
  }

  // function finaliseStructuredData(meta: any) {
  //   const head: any[] = [];

  //   _.each(meta.structuredData, function (content, property) {
  //     if (property === "article:tag") {
  //       _.each(meta.keywords, function (keyword) {
  //         if (keyword !== "") {
  //           keyword = escapeExpression(keyword);
  //           head.push(writeMetaTag(property, escapeExpression(keyword)));
  //         }
  //       });
  //       head.push("");
  //     } else if (content !== null && content !== undefined) {
  //       head.push(writeMetaTag(property, escapeExpression(content)));
  //     }
  //   });

  //   return head;
  // }

  console.log("ghost_head", options);
  const head = [];

  const site = options.data.site;
  const root = options.data.root;
  const object = root.object;
  const context = root.context;
  // const safeVersion = dataRoot._locals?.safeVersion;

  //   const useStructuredData = !config.isPrivacyDisabled("useStructuredData");
  //   const referrerPolicy = config.get("referrerPolicy")
  //     ? config.get("referrerPolicy")
  //     : "no-referrer-when-downgrade";
  //   const favicon = blogIcon.getIconUrl();
  //   const iconType = blogIcon.getIconType(favicon);

  // debug('preparation complete, begin fetch');

  try {
    /**
     * @TODO:
     *   - getMetaData(dataRoot, dataRoot) -> yes that looks confusing!
     *   - there is a very mixed usage of `data.context` vs. `root.context` vs `root._locals.context` vs. `this.context`
     *   - NOTE: getMetaData won't live here anymore soon, see https://github.com/TryGhost/Ghost/issues/8995
     *   - therefore we get rid of using `getMetaData(this, dataRoot)`
     *   - dataRoot has access to *ALL* locals, see function description
     *   - it should not break anything
     */
    // const meta = await getMetaData(dataRoot, dataRoot);
    // const frontendKey = await getFrontendKey();

    const metaTitle =
      object?.meta_title ||
      object?.title ||
      site.meta_title ||
      site.title ||
      site.og_title;

    const metaDesc = object
      ? object.meta_description || object.excerpt
      : site.meta_description || site.description || site.og_description;

    const metaImage = object?.feature_image || site.cover_image || site.icon;

    const origin = renderOptions?.origin || site.origin;
    const canonical = `${origin}${object?.url || "/"}`;

    if (metaTitle) {
      // <title> is usually printed by theme using {{meta_title}} helper
      head.push(`
      <meta property="og:title" content="${escapeExpression(metaTitle)}" />
      <meta name="twitter:title" content="${escapeExpression(metaTitle)}" />
    `);
    }
    if (metaDesc) {
      head.push(`
      <meta name="description" content="${escapeExpression(metaDesc)}" />
      <meta property="og:description" content="${escapeExpression(metaDesc)}" />
      <meta name="twitter:description" content="${escapeExpression(
        metaDesc
      )}" />
    `);
    }
    if (metaImage && !metaImage.includes(PLAY_FEATURE_BUTTON_PREFIX)) {
      head.push(`
      <meta property="og:image" content="${escapeExpression(metaImage)}" />
      <meta name="twitter:image" content="${escapeExpression(metaImage)}" />
      <meta name="twitter:image:alt" content="${escapeExpression(metaTitle)}" />
    `);
    }

    head.push(`<link rel="canonical" href="${canonical}" />`);
    head.push(`<link rel="og:url" href="${canonical}" />`);
    head.push(`<meta property="og:site_name" content="${site.title}" />`);
    head.push(
      `<meta name="twitter:card" content="${
        metaImage ? "summary_large_image" : "summary"
      }" />`
    );
    head.push(`<meta name="twitter:site" content="@nostrprotocol" />`);

    if (root.author) {
      head.push(`<meta property="og:type" content="profile" />`);
      head.push(
        `<meta property="og:profile:username" content="${root.author.name}" />`
      );
    } else {
      head.push(`<meta property="og:type" content="website" />`);
    }

    // after important meta is printed
    head.push(`
    <!-- 
    ***********************
     Powered by npub.pro 
    ***********************
    -->
    `);

    // site id for pwa code to function and for crawlers to see
    head.push(`<meta name="nostr:site" content="${site.naddr}" />`);
    if (root.author) {
      head.push(
        `<meta name="author" content="${root.author.name || root.author.id}" />`
      );
      head.push(`<meta name="nostr:author" content="${root.author.id}" />`);
      head.push(`<meta name="nostr:id" content="${root.author.id}" />`);
    } else if (object) {
      const npub = nip19.npubEncode(object.event?.pubkey || site.admin_pubkey);
      const author =
        object.primary_author?.name || object.primary_author?.id || "";
      if (author) head.push(`<meta name="author" content="${author}" />`);
      head.push(`<meta name="nostr:author" content="${npub}" />`);
      if (object.type !== "tag") {
        head.push(`<meta name="nostr:id" content="${object.id}" />`);
        head.push(`<meta name="nostr:event_id" content="${object.noteId}" />`);
      }
    }

    // manifest
    head.push(
      `<link rel="manifest" href="${site.url}/manifest.webmanifest" />`
    );

    // jquery is assumed by many themes
    head.push(`
    <script 
      src="${JQUERY}"
      integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="
      crossorigin="anonymous">
    </script>
  `);

    if (site.config.get("no_default_plugins") === "true") {
      console.log("default plugins turned off");
    } else {
      head.push(`
    <link rel="preload" as="style" href="${CSS_VENOBOX}" />
      `);
    }

    // debug('end fetch');
    if (site.icon) {
      head.push(`
    <link rel="icon" href="${site.icon}" type="${getMime(site.icon)}">
    <link rel="apple-touch-icon" href="${site.icon}">
    <meta name="theme-color" content="#ffffff">
      `);
    }

    const pagination = root.pagination;
    const paginationUrl = (page: number) => {
      if (page > 1) return urlUtils.createUrl(`${root.pathBase}page/${page}`);
      else return root.pathBase;
    };
    if (pagination?.prev) {
      head.push(
        '<link rel="prev" href="' +
          escapeExpression(paginationUrl(pagination?.prev)) +
          '">'
      );
    }
    if (pagination?.next) {
      head.push(
        '<link rel="next" href="' +
          escapeExpression(paginationUrl(pagination?.next)) +
          '">'
      );
    }

    if (site.codeinjection_head) {
      head.push(site.codeinjection_head);
    }
    if (site.google_site_verification) {
      if (site.google_site_verification.startsWith("<meta"))
        head.push(site.google_site_verification);
      else
        head.push(
          `<meta name="google-site-verification" content="${site.google_site_verification}" />`
        );
    }

    head.push(`
    <style>
      .np-oembed-video-link {
        display: inline-block;
        position: relative;
      }
      .np-oembed-video-link img {
        max-width: 100%;
      }
      .np-oembed-video-link:after {
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%,-50%);
        width: 96px;
        height: 96px;
        background: url('data:image/png;base64,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');
        background-size: cover;
        content: '';
      }
    </style>
    `);

    head.push(`
      <link rel="stylesheet" href="${CSS_MAPTALKS}">
    `);

    // head.push(
    //   `<link href="https://vjs.zencdn.net/8.16.1/video-js.css" rel="stylesheet" />`
    // );

    if (context) {
      // head is our main array that holds our meta data
      //   if (meta.metaDescription && meta.metaDescription.length > 0) {
      //     head.push(
      //       '<meta name="description" content="' +
      //         escapeExpression(meta.metaDescription) +
      //         '">'
      //     );
      //   }
      // no output in head if a publication icon is not set
      //   if (settingsCache.get("icon")) {
      //     head.push(
      //       '<link rel="icon" href="' +
      //         favicon +
      //         '" type="image/' +
      //         iconType +
      //         '">'
      //     );
      //   }
      //   head.push(
      //     '<link rel="canonical" href="' +
      //       escapeExpression(meta.canonicalUrl) +
      //       '">'
      //   );
      //   if (_.includes(context, "preview")) {
      //     head.push(writeMetaTag("robots", "noindex,nofollow", "name"));
      //     head.push(writeMetaTag("referrer", "same-origin", "name"));
      //   } else {
      //     head.push(writeMetaTag("referrer", referrerPolicy, "name"));
      //   }
      // show amp link in post when 1. we are not on the amp page and 2. amp is enabled
      //   if (
      //     _.includes(context, "post") &&
      //     !_.includes(context, "amp") &&
      //     settingsCache.get("amp")
      //   ) {
      //     head.push(
      //       '<link rel="amphtml" href="' + escapeExpression(meta.ampUrl) + '">'
      //     );
      //   }
      //   if (meta.previousUrl) {
      //     head.push(
      //       '<link rel="prev" href="' + escapeExpression(meta.previousUrl) + '">'
      //     );
      //   }
      //   if (meta.nextUrl) {
      //     head.push(
      //       '<link rel="next" href="' + escapeExpression(meta.nextUrl) + '">'
      //     );
      //   }
      //   if (!_.includes(context, "paged") && useStructuredData) {
      //     head.push("");
      //     head.push.apply(head, finaliseStructuredData(meta));
      //     head.push("");
      //     if (meta.schema) {
      //       head.push(
      //         '<script type="application/ld+json">\n' +
      //           JSON.stringify(meta.schema, null, "    ") +
      //           "\n    </script>\n"
      //       );
      //     }
      //   }
    }

    // head.push(
    //   '<meta name="generator" content="Ghost ' +
    //     escapeExpression(safeVersion) +
    //     '">'
    // );

    // rss
    if (root.hasRss) {
      head.push(
        `<link rel="alternate" type="application/rss+xml" title="${escapeExpression(
          object ? object.title : site.title
        )}" href="${escapeExpression(canonical + "rss/")}">`
      );
    } else {
      head.push(
        `<link rel="alternate" type="application/rss+xml" title="${escapeExpression(
          site.title
        )}" href="${escapeExpression(origin + "/rss/")}">`
      );
    }

    // no code injection for amp context!!!
    if (!includes(context, "amp")) {
      //   head.push(getMembersHelper(options.data, frontendKey));
      //   head.push(getSearchHelper(frontendKey));
      //   head.push(getAnnouncementBarHelper(options.data));
      //   try {
      //     head.push(getWebmentionDiscoveryLink());
      //   } catch (err) {
      //     console.warn(err);
      //   }
      // @TODO do this in a more "frameworky" way
      //   if (cardAssetService.hasFile("js")) {
      //     head.push(
      //       `<script defer src="${getAssetUrl("public/cards.min.js")}"></script>`
      //     );
      //   }
      //   if (cardAssetService.hasFile("css")) {
      //     head.push(
      //       `<link rel="stylesheet" type="text/css" href="${getAssetUrl(
      //         "public/cards.min.css"
      //       )}">`
      //     );
      //   }
      //   if (settingsCache.get("comments_enabled") !== "off") {
      //     head.push(
      //       `<script defer src="${getAssetUrl(
      //         "public/comment-counts.min.js"
      //       )}" data-ghost-comments-counts-api="${urlUtils.getSiteUrl(
      //         true
      //       )}members/api/comments/counts/"></script>`
      //     );
      //   }
      //   if (
      //     settingsCache.get("members_enabled") &&
      //     settingsCache.get("members_track_sources")
      //   ) {
      //     head.push(
      //       `<script defer src="${getAssetUrl(
      //         "public/member-attribution.min.js"
      //       )}"></script>`
      //     );
      //   }
    }

    // AMP template has style injected directly because there can only be one <style amp-custom> tag
    if (options.data.site.accent_color && !includes(context, "amp")) {
      const accentColor = escapeExpression(options.data.site.accent_color);
      const styleTag = `<style>:root {--ghost-accent-color: ${accentColor};}</style>`;
      const existingScriptIndex = findLastIndex(
        head,
        (str) => !!str.match(/<\/(style|script)>/)
      );

      if (existingScriptIndex !== -1) {
        head[existingScriptIndex] = head[existingScriptIndex] + styleTag;
      } else {
        head.push(styleTag);
      }
    }

    // debug('end');
    return new SafeString(head.join("\n    ").trim());
  } catch (error) {
    console.error(error);

    // Return what we have so far (currently nothing)
    return new SafeString(head.join("\n    ").trim());
  }
}

ghost_head.async = true;
