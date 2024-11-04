import { NDKEvent, NostrEvent } from "@nostr-dev-kit/ndk";
import { Site } from "../types/site";
import { eventId, profileId, tag, tags, tv } from "./utils";
import { nip19 } from "nostr-tools";
import { Post } from "../types/post";
import { Marked, marked } from "marked";
// import moment from "moment-timezone";
import {
  KIND_LONG_NOTE,
  KIND_NOTE,
  KIND_PACKAGE,
  KIND_SITE,
  SUPPORTED_KINDS,
} from "../consts";
import { Profile } from "../types/profile";
import { Author } from "../types/author";
import { Theme } from "../types/theme";
import { DateTime } from "luxon";
// @ts-ignore
import downsize from "downsize-cjs";
import { SiteAddr } from "../types/site-addr";
import { slugify } from "../../ghost/helpers/slugify";
import { load as loadHtml } from "cheerio";
import { dbi } from "../store/db";
import { Store, isAudioUrl, isImageUrl, isVideoUrl } from "..";
import markedPlaintify from "marked-plaintify";
import { decodeGeoHash } from "../geohash";
import { parseATag } from "../..";
import { Submit } from "../types/submit";

const NJUMP_DOMAIN = "njump.me";

// we want to show video preview in place of feature_image,
// for that we inject this empty feature_image and then
// in the tab replace these <img> elements with <video> elements
// with all styles copied and <play> button overlaid. but
// we also clear this feature_image thing on a post page bcs
// there is no need for preview there - a player is embedded
// in the post page.
export const PLAY_FEATURE_BUTTON_PREFIX = "data:image/gif+np-feature-video:";
// smallest possible transparent gif: https://stackoverflow.com/a/9967193
const PLAY_FEATURE_BUTTON =
  PLAY_FEATURE_BUTTON_PREFIX +
  "<video_url>;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function fromUNIX(ts: number | undefined) {
  return DateTime.fromMillis((ts || 0) * 1000).toISO() || "";
}

export class NostrParser {
  readonly origin?: string;
  // private site?: Site;
  private config?: Map<string, string>;
  private useCache?: boolean;

  constructor(origin?: string, useCache?: boolean) {
    this.origin = origin;
    this.useCache = useCache;
  }

  public setSite(site: Site) {
    // this.site = site;
    this.config = site.config;
  }

  public parseSite(addr: SiteAddr, event: NDKEvent): Site {
    if (!event) throw new Error("Site not found");

    const naddr = nip19.naddrEncode({
      identifier: addr.identifier,
      kind: KIND_SITE,
      pubkey: addr.pubkey,
      relays: addr.relays,
    });

    const ref = tv(event, "r");
    const url = ref ? new URL(ref) : null;

    const settings: Site = {
      id: eventId(event),
      naddr,
      event: event.rawEvent(),

      name: tv(event, "name") || "",
      admin_pubkey: tv(event, "u") || event.pubkey,
      admin_relays: addr.relays,

      url: url ? url.pathname : "/",
      origin: this.origin || (url ? url.origin : ""),

      contributor_pubkeys: tags(event, "p").map((t) => t[1]),
      contributor_relays: [],
      contributor_inbox_relays: [],

      include_tags: tags(event, "include", 3)
        .filter((t) => t.length < 5 || !t[4])
        .map((t) => ({
          tag: t[1],
          value: t[2],
        })),
      include_kinds: tags(event, "kind")
        .filter((t) => t.length < 4 || !t[3])
        .map((t) => t[1]),
      include_all: !!tags(event, "include", 2).find((t) => t[1] === "*"),
      include_manual: !!tags(event, "include", 2).find((t) => t[1] === "?"),
      include_relays: tags(event, "relay").map((t) => t[1]),

      // ["include", "<single-letter-tag>", "<tag-value>", "<pubkey>"*, "marker"*]
      homepage_tags: tags(event, "include", 5)
        .filter((t) => t[4] === "homepage")
        .map((t) => ({
          tag: t[1],
          value: t[2],
        })),
      // ["kind", "kind>", "<pubkey>"*, "marker"*]
      homepage_kinds: tags(event, "kind", 4)
        .filter((t) => t[3] === "homepage")
        .map((t) => t[1]),

      engine: tv(event, "z") || undefined,

      title: tv(event, "title"),
      timezone: "UTC",
      description: tv(event, "summary"),
      logo: tv(event, "logo"),
      icon: tv(event, "icon"),
      accent_color: tv(event, "color"),
      cover_image: tv(event, "image"),
      facebook: null,
      twitter: null,
      lang: tv(event, "lang"),

      codeinjection_head: null,
      codeinjection_foot: null,
      navigation: tags(event, "nav", 3).map((t) => ({
        label: t[2],
        url: t[1],
      })),
      secondary_navigation: [],
      meta_title: tv(event, "meta_title"),
      meta_description: tv(event, "meta_description"),
      og_image: tv(event, "og_image"),
      og_title: tv(event, "og_title"),
      og_description: tv(event, "og_description"),
      twitter_image: tv(event, "twitter_image"),
      twitter_title: tv(event, "twitter_title"),
      twitter_description: tv(event, "twitter_description"),
      members_support_address: null,

      extensions: tags(event, "x", 5).map((x) => ({
        event_id: x[1],
        relay: x[2],
        package_hash: x[3],
        petname: x[4],
      })),

      google_site_verification: "",

      config: new Map(),
      custom: new Map(),
      pluginSettings: new Map(),
    };

    // admin is the only contributor?
    if (
      !settings.contributor_pubkeys.length ||
      (settings.contributor_pubkeys.length === 1 &&
        settings.contributor_pubkeys[0] === settings.admin_pubkey)
    ) {
      settings.contributor_pubkeys = [settings.admin_pubkey];
      // addr only required to contain site relays,
      // should fetch outbox relays of admin for this
      // settings.contributor_relays = addr.relays;
    }

    if (settings.include_relays && settings.include_relays.length > 0)
      settings.contributor_relays = settings.include_relays;

    // DEPRECATED, still reading from there for bw-compat
    for (const c of tags(event, "config", 3)) {
      settings.config.set(c[1], c[2]);
    }

    // DEPRECATED, still reading from there for bw-compat
    for (const c of tags(event, "custom", 3)) {
      settings.custom.set(c[1], c[2]);
    }

    // new way
    for (const c of tags(event, "settings", 4)) {
      if (c[1] === "core") {
        settings.config.set(c[2], c[3]);
      } else if (c[1] === "theme") {
        settings.custom.set(c[2], c[3]);
      } else {
        const ps = settings.pluginSettings.get(c[1]) || new Map();
        ps.set(c[2], c?.[3] || "");
        settings.pluginSettings.set(c[1], ps);
      }
    }

    if (!settings.url!.endsWith("/")) settings.url += "/";

    settings.comments_enabled =
      settings.config.get("comments_enabled") === "true";
    settings.recommendations_enabled =
      settings.config.get("recommendations_enabled") === "true";

    settings.codeinjection_head =
      settings.config.get("codeinjection_head") || null;
    settings.codeinjection_foot =
      settings.config.get("codeinjection_foot") || null;

    settings.google_site_verification =
      settings.config.get("google_site_verification") || "";

    return settings;
  }

  public async parseTheme(e: NDKEvent) {
    if (e.kind !== KIND_PACKAGE) throw new Error("Bad kind: " + e.kind);
    const id = eventId(e);
    const theme: Theme = {
      id,

      name: tv(e, "title") || id,

      dir: `/${id}/`,

      config: {},
      custom: {},

      entries: tags(e, "f", 4).map((f) => ({
        hash: f[1],
        path: f[2],
        url: f[3],
      })),

      templates: tags(e, "f", 4)
        .filter((f) => !f[2].includes("/") && f[2].endsWith(".hbs"))
        .map((f) => f[2].split(".hbs")[0]),

      partials: tags(e, "f", 4)
        .filter((f) => f[2].startsWith("partials/") && f[2].endsWith(".hbs"))
        .map((f) => f[2].split("partials/")[1]),
    };

    for (const e of theme.entries) {
      const name = e.path.includes("/")
        ? e.path.split("/").pop() || ""
        : e.path;
      if (!name) {
        console.warn("Bad theme asset path", e);
        continue;
      }
      const ext = name.split(".").pop();
      if (ext && ext !== name) e.url = `${e.url}.${ext}`;
    }

    const packageJsonUrl = theme.entries.find(
      (f) => f.path === "package.json"
    )!.url;
    const cachedPackageJson = this.useCache
      ? await dbi.getCache(packageJsonUrl)
      : undefined;
    const packageJson =
      cachedPackageJson || (await fetch(packageJsonUrl).then((r) => r.json()));
    if (this.useCache && !cachedPackageJson && packageJson) {
      await dbi.putCache(packageJsonUrl, packageJson);
    }

    console.log("packageJson", packageJson);
    if (packageJson.config) {
      if (packageJson.config.custom) {
        for (const name in packageJson.config.custom) {
          theme.custom[name] = packageJson.config.custom[name]["default"];
        }
      }
      theme.config = packageJson.config;
    }
    console.log("parsed theme", theme);
    return theme;
  }

  public async parseSubmitEvent(e: NDKEvent) {
    const submit: Submit = {
      event: e.rawEvent(),
      eventAddress: "",
      relay: "",
      pubkey: tv(e, "p") || "",
      kind: parseInt(tv(e, "k") || "0"),
      hashtags: tags(e, "t", 2).map((t) => t[1]),
    };
    if (!SUPPORTED_KINDS.includes(submit.kind) || !submit.pubkey)
      return undefined;

    try {
      const e_tag = tag(e, "e");
      if (e_tag && e_tag.length >= 2) {
        submit.eventAddress = nip19.noteEncode(e_tag[1]);
        if (e_tag.length >= 3) submit.relay = e_tag[2];
      } else {
        const a_tag = tag(e, "a");
        if (a_tag && a_tag.length >= 2) {
          const addr = parseATag(a_tag[1]);
          submit.eventAddress = nip19.naddrEncode({
            identifier: addr!.identifier,
            kind: addr!.kind,
            pubkey: addr!.pubkey,
          });
          if (a_tag.length >= 3) submit.relay = a_tag[2];
        }
      }
    } catch (err) {
      console.log("Bad submit event ref", e, err);
      return undefined;
    }
    if (!submit.eventAddress) return undefined;
    return submit;
  }

  public async parseEvent(e: NDKEvent, store?: Store) {
    switch (e.kind) {
      case KIND_NOTE:
        return await this.parseNote(e, store);
      default:
        return await this.parseEventDefault(e);
      // case KIND_MUSIC:
      //   return await this.parseMusic(e);
      // case KIND_LIVE_EVENT:
      //   return await this.parseLiveEvent(e);

      // default:
      //   console.warn("unsupported kind", e);
    }
    return undefined;
  }

  private parseEventDefault(e: NDKEvent) {
    const id = eventId(e);
    const post: Post = {
      type: "post",
      id,
      noteId: nip19.noteEncode(e.id),
      npub: nip19.npubEncode(e.pubkey),
      slug: slugify(tv(e, "slug") || tv(e, "d") || id),
      uuid: e.id,
      url: "",
      title: tv(e, "title"),
      html: null,
      comment_id: e.id,
      feature_image: tv(e, "image"),
      feature_image_alt: null,
      feature_image_caption: null,
      featured: false,
      visibility: "public",
      created_at: fromUNIX(e.created_at),
      updated_at: fromUNIX(e.created_at),
      published_at: fromUNIX(
        parseInt(tv(e, "published_at") || "" + e.created_at)
      ),
      custom_excerpt: null,
      codeinjection_head: null,
      codeinjection_foot: null,
      custom_template: null,
      canonical_url: null,
      excerpt: tv(e, "summary") || tv(e, "description"),
      reading_time: 0,
      access: true,
      og_image: null,
      og_title: null,
      og_description: null,
      twitter_image: null,
      twitter_title: null,
      twitter_description: null,
      meta_title: null,
      meta_description: null,
      email_subject: null,
      primary_tag: null,
      tags: [],
      primary_author: null,
      authors: [],
      markdown: e.content || "",
      images: [],
      videos: [],
      audios: [],
      links: this.parseLinks(e),
      nostrLinks: this.parseNostrLinks(e.content),
      event: e.rawEvent(),
      show_title_and_feature_image: true,
    };

    // only use alt for unknown kinds
    if (!post.excerpt && e.kind !== KIND_NOTE && e.kind !== KIND_LONG_NOTE) {
      post.excerpt = tv(e, "alt");
    }

    const geohash = tags(e, "g")
      .filter((t) => t.length >= 2)
      .map((t) => t[1])
      .reduce((p, c) => (c.length > p.length ? c : p), "");
    if (geohash) {
      try {
        post.geo = decodeGeoHash(geohash);
      } catch (err) {
        console.warn("Failed to parse geohash", geohash, err, e);
      }
    }

    // images from links
    post.images = this.parseImages(post);
    post.videos = this.parseVideos(post);
    post.audios = this.parseAudios(post);

    // init feature image
    if (!post.feature_image && post.images.length)
      post.feature_image = post.images[0];
    if (!post.feature_image && post.videos.length)
      post.feature_image = PLAY_FEATURE_BUTTON.replace(
        "<video_url>",
        encodeURIComponent(post.videos[0])
      );

    // init podcast media url
    post.og_description = post.audios?.[0] || post.videos?.[0] || "";

    return post;
  }

  // public async parseLongNote(e: NDKEvent) {
  //   if (e.kind !== KIND_LONG_NOTE) throw new Error("Bad kind: " + e.kind);

  //   const post = this.parseEventDefault(e);

  //   return post;
  // }

  public async parseNote(e: NDKEvent, store?: Store) {
    if (e.kind !== KIND_NOTE) throw new Error("Bad kind: " + e.kind);

    const post = this.parseEventDefault(e);

    // setting
    const includeFeatureImageInPost =
      this.getConf("include_feature_image") === "true";

    // only one image url at the start? cut it, we're
    // using it in feature_image, unless we're told to include it
    // for themes that don't (fully) show featured image
    let content = e.content;
    if (
      !includeFeatureImageInPost &&
      post.images.length === 1 &&
      (content.trim().startsWith(post.images[0]) ||
        content.trim().endsWith(post.images[0]))
    ) {
      content = content.replace(post.images[0], "");
    }

    // now format content w/o the feature_image
    // NOTE: kind1 isn't MD so people will use line breaks to format
    // their notes, this formatting is lost unless we manually
    // convert \n to <br> so that MD parser doesn't collapse consecutive
    // line breaks
    post.markdown = content.replace(new RegExp("\n", "gi"), "<br>");

    // now cut all links to create a title and excerpt
    let textContent = (await new Marked().use(markedPlaintify()).parse(content))
      // https://github.com/markedjs/marked/discussions/1737#discussioncomment-168391
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');

    // replace nostr npub/nprofile links in textContent
    // with @username texts
    if (store)
      textContent = await this.replaceNostrProfiles(
        store,
        post.nostrLinks,
        textContent,
        true
      );

    // clear the links that weren't replaced w/ text
    let emojiContent = "";
    for (const l of post.links) {
      if (isVideoUrl(l)) emojiContent = "🎥";
      else if (isAudioUrl(l)) emojiContent = "🎵";
      else if (isImageUrl(l)) emojiContent = "🖼️";

      textContent = textContent.replace(l, "");
    }
    if (!textContent) textContent = emojiContent;
    for (const l of post.nostrLinks) textContent = textContent.replace(l, "");

    const headline = textContent.trim().split("\n")[0];
    try {
      post.excerpt = downsize(textContent, { words: 50 });
      post.title = downsize(headline, { words: 6 });
    } catch (e) {
      console.error("downsize failed", e);
    }
    if (!post.title || post.title !== headline) post.title += "…";
    if (post.excerpt && post.excerpt !== textContent) post.excerpt += "…";

    return post;
  }

  // public async parseMusic(e: NDKEvent) {
  //   if (e.kind !== KIND_MUSIC) throw new Error("Bad kind: " + e.kind);

  //   const post = this.parseEventDefault(e);

  //   return post;
  // }

  // public async parseLiveEvent(e: NDKEvent) {
  //   if (e.kind !== KIND_LIVE_EVENT) throw new Error("Bad kind: " + e.kind);

  //   const post = this.parseEventDefault(e);

  //   return post;
  // }

  private async replaceNostrProfiles(
    store: Store,
    nostrLinks: string[],
    s: string,
    plainText?: boolean
  ) {
    // console.log("replacing", s, nostrLinks);

    for (const l of nostrLinks) {
      if (!l.startsWith("nostr:npub1") && !l.startsWith("nostr:nprofile1"))
        continue;

      try {
        let npub = l.split("nostr:")[1];
        const { type, data } = nip19.decode(npub);
        if (type === "nprofile") {
          npub = nip19.npubEncode(data.pubkey);
        }

        const author = (await store.get(npub, "authors", true)) as
          | Author
          | undefined;
        const profile = (await store.get(npub, "profiles", true)) as
          | Profile
          | undefined;

        if (profile) {
          // console.log("replacing author", s, author);
          const name = profile.profile?.display_name || profile.profile?.name;
          if (!name) continue;

          const rx = new RegExp(l, "g");
          if (plainText) {
            s = s.replace(rx, `@${name}`);
          } else if (author) {
            s = s.replace(rx, `[${name}](${author.url})`);
          } else {
            s = s.replace(rx, `[${name}](https://${NJUMP_DOMAIN}/${npub})`);
          }
        }
      } catch (e) {
        console.log("bad nostr link", l, e);
      }
    }

    return s;
  }

  private async replaceNostrLinks(post: Post, s: string) {
    // make sure all nostr: links are in [link](link) format
    // to be converted to <a> tags by md=>html
    for (const l of post.nostrLinks) {
      s = s.replace(new RegExp(l, "g"), `[${l}](${l})`);
    }

    // for (const l of post.nostrLinks) {
    //   const id = l.split("nostr:")[1];
    //   const linked = (await store.get(id, "posts", true)) as Post | undefined;
    //   // console.log("nostr link post", post.id, "link", id, linked);
    //   let url = `https://${NJUMP_DOMAIN}/${id}`;
    //   let anchor = `${id.substring(0, 10)}...${id.substring(id.length - 4)}`;
    //   if (linked) {
    //     url = linked.url;
    //     // NOTE: make sure anchor is same,
    //     // this will signal to 'embedLinks' below to replace
    //     // it with embed code
    //     anchor = url;
    //   }
    //   s = s.replace(new RegExp(l, "g"), `[${anchor}](${url})`);
    // }
    return s;
  }

  public async prepareHtml(post: Post, store: Store) {
    post.markdown = await this.replaceNostrProfiles(
      store,
      post.nostrLinks,
      post.markdown!
    );

    post.markdown = await this.replaceNostrLinks(post, post.markdown);

    post.html = await marked.parse(post.markdown, {
      // FIXME doesn't work!
      breaks: true, // convert \n to <br>
    });
    // console.log(`md '${post.markdown}' html '${post.html}'`);

    await this.embedLinks(store, post);
  }

  private async embedLinks(store: Store, post: Post) {
    // ok so we arrive to post.html from markdown or plaintext
    // with nostr-links replaced w/ njump.

    // the embedding of web/nostr links will be done on the
    // client by a plugin, but we need to prepare things for it:
    // - it shouldn't need to parse html again - it has direct access
    // to DOM so it could simply query from there
    // - we could make it universal and simple by wrapping/marking the
    // to-be-embedded links with some element/class

    // but also we need to convert the _media_ links to media html
    // right here so that search engine crawlers would appreciate
    // the presence of media and gave us a boost.

    // parse formatted html
    const dom = loadHtml(post.html!);

    // convert nostr links to njump links
    const allLinks = [...post.links, ...post.nostrLinks];

    // replace media links
    for (const url of allLinks) {
      let code = "";
      if (isVideoUrl(url)) {
        code = `<video controls src="${url}" style="width:100%;"></video>`;
      } else if (isAudioUrl(url)) {
        code = `<audio controls src="${url}"></audio>`;
      } else if (isImageUrl(url)) {
        code = `<a href="${url}" class="vbx-media" target="_blank"><img class="venobox" src="${url}" /></a>`;
      }

      // FIXME: if url contains stuff like "’" then marked might
      // run it through percent encode and href will contain "%E2%80%99",
      // and it's not clear how we have to reimplement it here...
      const nodes = dom(`a[href="${url}"]`);
      // console.log("nodes", `a[href="${url}"]`, nodes);
      const elements: any[] = [];
      nodes.each((_: number, el: any) => {
        elements.push(el);
      });
      for (const el of elements) {
        const node = dom(el);
        let replace = false;
        if (code) {
          // links with an anchor (made using markdown [text](url) syntax)
          // aren't replaced, bcs anchor would be lost, which user definitely
          // didn't want
          replace = node.text() === url;
        } else if (url.startsWith("nostr:")) {
          // nostr link
          const id = url.split("nostr:")[1];
          if (
            id.startsWith("note1") ||
            id.startsWith("nevent1") ||
            id.startsWith("naddr1") ||
            id.startsWith("npub1") ||
            id.startsWith("nprofile1")
          ) {
            const linked = (await store.get(id, "posts", true)) as
              | Post
              | undefined;

            // we're about to modify the text
            replace = node.text() === url;

            if (linked) {
              // make sure we're linking to our internal page
              node.attr("href", linked.url);
              // also make the title look nice
              if (linked.title) node.text(linked.title);
            } else {
              // make it a link to njump
              node.attr("href", `https://${NJUMP_DOMAIN}/${id}`);
            }

            code = `<np-embed nostr='${id}'>${node.prop(
              "outerHTML"
            )}</np-embed>`;
          }
        } else {
          // web link
          code = `<np-embed url='${url}'>${node.prop("outerHTML")}</np-embed>`;
          replace = node.text() === url;
          // console.log("web link replace", replace, url, '"'+node+'"', code);
        }

        // console.log("embed url", replace, url, node.html(), node.text(), code);
        if (code && replace) node.replaceWith(code);
      }
    }

    // done
    post.html = dom("body").html();

    // replace hashtags with links too
    const tags = [...post.tags];
    // sort desc by length
    tags.sort((a, b) => b.name.length - a.name.length);
    for (const t of tags) {
      // idk how to make it not this dumb to avoid double-replacing
      // hashtags, like #kino after #kinostr
      const rxs = [
        // FIXME \b doesn't consume anything and just indicates "non-word chars",
        // but it's ascii only, so probably won't work
        // for non-ascii hashtags?
        new RegExp(`(#${t.name})\\b`, "gi"),
      ];
      for (const rx of rxs) {
        // console.log("hashtag replace", t, rx, [...post.html!.matchAll(rx)]);
        post.html = post.html!.replace(rx, `<a href='${t.url}'>$&</a>`);
      }
    }
  }

  private getConf(name: string): string | undefined {
    if (!this.config) return "";
    return this.config.get(name);
  }

  public parseHashtags(e: NDKEvent | NostrEvent): string[] {
    return [...new Set(tags(e, "t").map((tv) => tv[1]))];
  }

  public parseProfile(e: NDKEvent): Profile {
    const id = profileId(e);
    let profile = undefined;
    try {
      profile = JSON.parse(e.content);
    } catch (er) {
      console.warn("bad profile", e, er);
    }
    return {
      id,
      slug: id,
      pubkey: e.pubkey,
      profile,
      event: e,
    };
  }

  public parsePins(e: NDKEvent): string[] {
    try {
      const ids = tags(e, "e").map((t) => nip19.noteEncode(t[1]));
      const addrs = tags(e, "a")
        .map((t) => parseATag(t[1]))
        .filter(Boolean)
        .map((v) => nip19.naddrEncode(v!));
      return [...ids, ...addrs];
    } catch (err) {
      console.log("bad pins list", e, err);
      return [];
    }
  }

  public async parseAuthor(profile: Profile, store?: Store): Promise<Author> {
    const author: Author = {
      type: "author",
      id: profile.id,
      slug: profile.id,
      name:
        profile.profile?.display_name || profile.profile?.name || profile.id,
      email: null,
      profile_image: profile.profile?.picture || null,
      cover_image: profile.profile?.banner || null,
      bio: profile.profile?.about || null,
      website: profile.profile?.website || null,
      location: null,
      facebook: null,
      twitter: null,
      accessibility: null,
      status: "active",
      meta_title: null,
      meta_description: null,
      tour: null,
      last_seen: null,
      created_at: fromUNIX(profile.event.created_at),
      updated_at: fromUNIX(profile.event.created_at),
      permissions: [],
      roles: [],
      count: { posts: 0 },
      url: "",
      event: profile.event,
    };

    if (author.bio) {
      store;
      // this isn't working, bcs fetchNostrLinks doesn't look
      // at profile bio and thus we always try fetching related
      // stuff from network here one-by-one
      //
      // const nostrLinks = this.parseNostrLinks(author.bio);

      // if (store)
      //   author.bio = await this.replaceNostrProfiles(
      //     store,
      //     nostrLinks,
      //     author.bio,
      //     true
      //   );

      // NOTE: bio doesn't support html :( - I mean themes don't
      // support displaying bio as html

      // const links = this.parseTextLinks(author.bio);
      // author.bio = this.replaceLinks(links, author.bio);

      // // md to html
      // author.bio = await marked.parse(author.bio);
    }

    return author;
  }

  // private parseMarkdownImages(markdown: string | undefined): string[] {
  //   if (!markdown) return [];

  //   const IMAGE_MD_RX = /!\[(.*)\]\((.+)\)/g;
  //   return [
  //     ...new Set(
  //       [...markdown.matchAll(IMAGE_MD_RX)]
  //         .filter((m) => m?.[2])
  //         .map((m) => m[2])
  //     ),
  //   ];
  // }

  private parseLinks(e: NDKEvent | NostrEvent): string[] {
    const links: string[] = [];
    if (e.content) {
      const RX =
        /\b((https?|ftp|file):\/\/|(www|ftp)\.)[-A-Z0-9+&@#\/%\?=~_’|$!:,.;]*[A-Z0-9+&@#\/%=~_|$]/gi;
      // the one below doesn't cut the trailing dot "."
      //      /(?:(?:https?):\/\/)(?:([-A-Z0-9+&@#/%=~_|$?!:,.]*)|[-A-Z0-9+&@#/%=~_|$?!:,.])*(?:([-A-Z0-9+&@#/%=~_|$?!:,.]*)|[A-Z0-9+&@#/%=~_|$])/gi;
      links.push(...[...e.content.matchAll(RX)].map((m) => m[0]));
    }

    const tagUrls: string[] = e.tags
      .filter((t) => t.length > 1 && t[0] === "imeta")
      .map((t) => t.find((v) => v.startsWith("url ")))
      .filter((u) => !!u)
      .map((u) => u?.split("url ")[1].trim() as string)
      .filter((u) => !!u);
    links.push(...tagUrls);

    return [...new Set(links)];
  }

  public parseNostrLinks(text: string): string[] {
    if (!text) return [];
    const RX = /nostr:[a-z0-9]+/gi;
    return [...new Set([...text.matchAll(RX)].map((m) => m[0]))];
  }

  private parseImages(post: Post): string[] {
    const images: string[] = [];
    if (post.feature_image) images.push(post.feature_image);

    // extract from string content
    const urls = this.parseLinks(post.event);
    images.push(...urls.filter((u) => isImageUrl(u)));

    // unique
    return [...new Set(images)];
  }

  private parseVideos(post: Post): string[] {
    const videos: string[] = [];

    // extract from string content
    const urls = this.parseLinks(post.event);
    videos.push(...urls.filter((u) => isVideoUrl(u)));

    // unique
    return [...new Set(videos)];
  }

  private parseAudios(post: Post): string[] {
    const audios: string[] = [];

    // extract from string content
    const urls = this.parseLinks(post.event);
    audios.push(...urls.filter((u) => isAudioUrl(u)));

    // unique
    return [...new Set(audios)];
  }
}
