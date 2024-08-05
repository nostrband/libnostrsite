import { NDKEvent } from "@nostr-dev-kit/ndk";
import { Site } from "../types/site";
import { eventId, profileId, tags, tv } from "./utils";
import { nip19 } from "nostr-tools";
import { Post } from "../types/post";
import { marked } from "marked";
// import moment from "moment-timezone";
import { KIND_LONG_NOTE, KIND_NOTE, KIND_PACKAGE, KIND_SITE } from "../consts";
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

      include_tags: tags(event, "include", 3).map((t) => ({
        tag: t[1],
        value: t[2],
      })),
      include_all: !!tags(event, "include", 2).find((t) => t[1] === "*"),
      include_manual: !!tags(event, "include", 2).find((t) => t[1] === "?"),
      include_kinds: tags(event, "kind").map((t) => t[1]),
      include_relays: tags(event, "relay").map((t) => t[1]),

      engine: tv(event, "z") || undefined,
      // themes: tags(event, "y").map((t) => t[1]),
      // plugins: tags(event, "z").map((t) => t[1]),

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

    for (const c of tags(event, "config", 3)) {
      settings.config.set(c[1], c[2]);
    }

    for (const c of tags(event, "custom", 3)) {
      settings.custom.set(c[1], c[2]);
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

  public async parseEvent(e: NDKEvent, store?: Store) {
    switch (e.kind) {
      case KIND_LONG_NOTE:
        return await this.parseLongNote(e, store);
      case KIND_NOTE:
        return await this.parseNote(e, store);

      default:
        console.warn("unsupported kind", e);
    }
    return undefined;
  }

  public async parseLongNote(e: NDKEvent, store?: Store) {
    if (e.kind !== KIND_LONG_NOTE) throw new Error("Bad kind: " + e.kind);

    const id = eventId(e);
    const html = await marked.parse(e.content);
    const post: Post = {
      type: "post",
      id,
      noteId: nip19.noteEncode(e.id),
      npub: nip19.npubEncode(e.pubkey),
      slug: slugify(tv(e, "slug") || tv(e, "d") || id),
      uuid: e.id,
      url: "",
      title: tv(e, "title"),
      html,
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
      excerpt: tv(e, "summary"), //  || (await marked.parse(downsize(e.content, { words: 50 })))
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
      links: this.parseTextLinks(e.content),
      nostrLinks: this.parseNostrLinks(e.content),
      event: e.rawEvent(),
      show_title_and_feature_image: true,
    };

    // oembed from built-in providers
    //    await this.fetchOembeds(post);

    // replace nostr npub/nprofile links in markdown
    // with rich "Username" links
    // FIXME if user pasted link as plaintext then this is fine,
    // otherwise if link is already [text](url) then
    // we'll replace it with url-inside-url
    if (store)
      post.markdown = await this.replaceNostrProfiles(
        store,
        post.nostrLinks,
        post.markdown!
      );

    post.markdown = await this.replaceNostrLinks(post, post.markdown!);

    // images from links
    post.images = this.parseImages(post);
    post.videos = this.parseVideos(post);

    if (!post.feature_image && post.images.length)
      post.feature_image = post.images[0];
    if (!post.feature_image && post.videos.length)
      post.feature_image = PLAY_FEATURE_BUTTON.replace(
        "<video_url>",
        encodeURIComponent(post.videos[0])
      );

    // replace media links and oembeds
    this.embedLinks(post);

    // FIXME config?
    post.og_description = post.links.find((u) => isVideoUrl(u)) || null;

    return post;
  }

  public async parseNote(e: NDKEvent, store?: Store) {
    if (e.kind !== KIND_NOTE) throw new Error("Bad kind: " + e.kind);

    const id = eventId(e);
    const post: Post = {
      type: "post",
      id,
      noteId: nip19.noteEncode(e.id),
      npub: nip19.npubEncode(e.pubkey),
      slug: slugify(tv(e, "slug") || id),
      uuid: e.id,
      url: "",
      title: "",
      html: null,
      comment_id: e.id,
      feature_image: "",
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
      excerpt: null,
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
      markdown: "",
      images: [],
      videos: [],
      audios: [],
      links: this.parseTextLinks(e.content),
      nostrLinks: this.parseNostrLinks(e.content),
      event: e.rawEvent(),
      show_title_and_feature_image: true,
    };

    // oembed from built-in providers
    //    await this.fetchOembeds(post);

    // parse media
    post.images = this.parseImages(post);
    post.videos = this.parseVideos(post);

    // set feature image
    if (!post.feature_image && post.images.length)
      post.feature_image = post.images[0];
    if (!post.feature_image && post.videos.length)
      post.feature_image = PLAY_FEATURE_BUTTON.replace(
        "<video_url>",
        encodeURIComponent(post.videos[0])
      );

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
    post.markdown = content;

    // replace nostr npub/nprofile links in markdown
    // with rich "Username" links
    if (store)
      post.markdown = await this.replaceNostrProfiles(
        store,
        post.nostrLinks,
        content
      );

    post.markdown = await this.replaceNostrLinks(post, post.markdown);

    // parse markdown to html
    post.html = await marked.parse(post.markdown);

    // FIXME remove when it's implemented on the client as plugin
    this.embedLinks(post);

    // now cut all links to create a title and excerpt
    let textContent = content;

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
    post.excerpt = downsize(textContent, { words: 50 });
    const headline = textContent.trim().split("\n")[0];
    post.title = downsize(headline, { words: 6 });
    if (!post.title || post.title !== headline) post.title += "…";

    // short content (title === content) => empty title?
    // if (content.trim() === post.title?.trim()) post.title = null;

    // podcasts
    // if (this.getConf("podcast_media_in_og_description") === "true") {
    post.og_description =
      post.links.find((u) => isVideoUrl(u) || isAudioUrl(u)) || null;
    // }

    return post;
  }

  // private replaceLinks(links: string[], s: string): string {
  //   for (const l of links) {
  //     s = s.replace(l, `[${l}](${l})`)
  //   }
  //   return s;
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

        const r = await store.list({
          type: "profiles",
          id: npub,
        });
        if (r.profiles!.length > 0) {
          const author = r.profiles![0];
          // console.log("replacing author", s, author);
          const name = author.profile?.display_name || author.profile?.name;
          if (!name) continue;

          if (plainText) {
            s = s.replace(l, `@${name}`);
          } else {
            s = s.replace(l, `[${name}](https://${NJUMP_DOMAIN}/${npub})`);
          }
        }
      } catch (e) {
        console.log("bad nostr link", l, e);
      }
    }

    return s;
  }

  private async replaceNostrLinks(post: Post, s: string) {
    for (const l of post.nostrLinks) {
      const id = l.split("nostr:")[1];
      s = s.replace(
        l,
        `[${id.substring(0, 10)}...${id.substring(
          id.length - 4
        )}](https://${NJUMP_DOMAIN}/${id})`
      );
    }
    return s;

    // console.log("replacing", s, post.nostrLinks);
    // for (const l of post.nostrLinks) {
    //   if (
    //     !l.startsWith("nostr:note1") &&
    //     !l.startsWith("nostr:nevent1") &&
    //     !l.startsWith("nostr:naddr1")
    //   )
    //     continue;

    //   try {
    //     let id = l.split("nostr:")[1];
    //     const { type, data } = nip19.decode(id);
    //     if (type === "nevent") {
    //       id = nip19.noteEncode(data.id);
    //     } else if (type === "naddr") {
    //       id = nip19.naddrEncode({
    //         identifier: data.identifier,
    //         kind: data.kind,
    //         pubkey: data.pubkey,
    //         // exclude relays
    //       });
    //     }

    //     const r = await store.list({
    //       type: "related",
    //       id,
    //     });
    //     if (r.related!.length > 0) {
    //       const post = r.related![0];
    //       console.log("replacing post", s, post);
    //       const name = post.primary_author?.name
    //         ? `@${post.primary_author?.name}: `
    //         : "";
    //       if (plainText) {
    //         const text = `\n> ${name}${post.excerpt?.replace("\n", "\n>")}...`;
    //         s = s.replace(l, text);
    //       } else {
    //         const millis = Date.parse(post.published_at!);
    //         const date = DateTime.fromMillis(millis).toFormat("LLL dd, yyyy");
    //         const text = `\n> ${name}${post.excerpt?.replace(
    //           "\n",
    //           "\n>"
    //         )}...\n[${date}](https://njump.me/${id})`;
    //         s = s.replace(l, text);
    //       }
    //     }
    //   } catch (e) {
    //     console.log("bad nostr link", l, e);
    //   }
    // }

    // return s;
  }

  private embedLinks(post: Post) {
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
    const allLinks = [
      ...post.links,
      ...post.nostrLinks.map(
        (l) => `https://${NJUMP_DOMAIN}/${l.split("nostr:")[1]}`
      ),
    ];

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

      const nodes = dom(`a[href="${url}"]`);
      nodes.each((_: number, el: any) => {
        const node = dom(el);
        let replace = false;
        if (code) {
          // links with an anchor (made using markdown [text](url) syntax)
          // aren't replaced, bcs anchor would be lost, which user definitely
          // didn't want
          replace = node.text() === url;
        } else {
          // web/nostr link
          try {
            const u = new URL(url);
            if (u.hostname === NJUMP_DOMAIN) {
              // nostr link
              const id = u.pathname.split("/")[1];
              // console.log("embed njump", id);
              if (
                id.startsWith("note1") ||
                id.startsWith("nevent1") ||
                id.startsWith("naddr1") ||
                id.startsWith("npub1") ||
                id.startsWith("nprofile1")
              ) {
                code = `<np-embed nostr='${id}'>${node.prop(
                  "outerHTML"
                )}</np-embed>`;
                // njump links are replaced unconditionally, bcs
                // we ourselves set profiles' anchors to usernames,
                // and so we can't distinguish btw markdown-provided
                // anchor or our own.
                // const a = node.text().split("...");
                replace = true; // a.length === 2 && id.startsWith(a[0]) && id.endsWith(a[1]);
              }
            } else {
              // web link
              code = `<np-embed url='${url}'>${node.prop(
                "outerHTML"
              )}</np-embed>`;
              replace = node.text() === url;
//              console.log("web link replace", replace, url, '"'+node+'"', code);
            }
          } catch (e) {
            console.log("Bad link", url, e);
          }
        }

        // console.log("embed url", replace, url, node.html(), node.text(), code);
        if (code && replace) node.replaceWith(code);

      });
    }

    // done
    post.html = dom("body").html();
  }

  private getConf(name: string): string | undefined {
    if (!this.config) return "";
    return this.config.get(name);
  }

  public parseHashtags(e: NDKEvent): string[] {
    return tags(e, "t").map((tv) => tv[1]);
  }

  public parseProfile(e: NDKEvent): Profile {
    const id = profileId(e);
    return {
      id,
      slug: id,
      pubkey: e.pubkey,
      profile: JSON.parse(e.content),
      event: e,
    };
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

  private parseMarkdownImages(markdown: string | undefined): string[] {
    if (!markdown) return [];

    const IMAGE_MD_RX = /!\[(.*)\]\((.+)\)/g;
    return [
      ...new Set(
        [...markdown.matchAll(IMAGE_MD_RX)]
          .filter((m) => m?.[2])
          .map((m) => m[2])
      ),
    ];
  }

  private parseTextLinks(text: string): string[] {
    if (!text) return [];
    const RX =
      /\b((https?|ftp|file):\/\/|(www|ftp)\.)[-A-Z0-9+&@#\/%?=~_|$!:,.;]*[A-Z0-9+&@#\/%=~_|$]/gi;
    // the one below doesn't cut the trailing dot "."
    //      /(?:(?:https?):\/\/)(?:([-A-Z0-9+&@#/%=~_|$?!:,.]*)|[-A-Z0-9+&@#/%=~_|$?!:,.])*(?:([-A-Z0-9+&@#/%=~_|$?!:,.]*)|[A-Z0-9+&@#/%=~_|$])/gi;
    return [...new Set([...text.matchAll(RX)].map((m) => m[0]))];
  }

  public parseNostrLinks(text: string): string[] {
    if (!text) return [];
    const RX = /nostr:[a-z0-9]+/gi;
    return [...new Set([...text.matchAll(RX)].map((m) => m[0]))];
  }

  private parseImages(post: Post): string[] {
    const images: string[] = [];
    if (post.feature_image) images.push(post.feature_image);

    // collect images from markdown
    images.push(...this.parseMarkdownImages(post.markdown));

    // extract from string content
    const urls = this.parseTextLinks(post.event.content);
    images.push(...urls.filter((u) => isImageUrl(u)));

    // for (const l of post.links) {
    //   const oe = this.oembeds.get(l);
    //   if (oe && oe.thumbnail_url) images.push(oe.thumbnail_url);
    // }

    // unique
    return [...new Set(images)];
  }

  private parseVideos(post: Post): string[] {
    const videos: string[] = [];

    // extract from string content
    const urls = this.parseTextLinks(post.event.content);
    videos.push(...urls.filter((u) => isVideoUrl(u)));

    // unique
    return [...new Set(videos)];
  }
}
