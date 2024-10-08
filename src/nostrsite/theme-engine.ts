import path from "path-browserify";
// @ts-ignore
import BrowserHbs from "browser-hbs";

import { Site } from "./types/site";

import { initHelpers } from "./modules/helpers";
import { MetaData } from "./modules/metadata";
import localUtils from "../ghost/frontend/services/theme-engine/handlebars/utils";
import { NostrSiteUrlUtils } from "./modules/urlutils";
import { ImageUtils } from "./modules/images";
import { urlHelpers } from "./modules/config-url-helpers";
import { Theme } from "./types/theme";
import { UrlService } from "./modules/urlservice";
import { Context } from "./types/context";
import { Templater } from "./types/templater";
import { DefaultTemplater } from "./modules/default-templater";
import { Store } from "./types/store";
import { AssetFetcher } from "./types/asset-fetcher";
import { DefaultAssetFetcher } from "./modules/default-asset-fetcher";
import {
  DEFAULT_PARTIALS,
  DEFAULT_PARTIALS_DIR_NAME,
} from "./partials/default-partials";
import merge from "lodash-es/merge";
import { Profile, RenderOptions, getUrlMediaMime, profileId } from ".";
import { templates } from "../ghost/frontend/services/theme-engine/handlebars/template";
import { DateTime } from "luxon";

export class ThemeEngine {
  private readonly hbs;
  private readonly options: RenderOptions;

  private urlUtils?: NostrSiteUrlUtils;
  private store: Store;
  private settings?: Site;
  private theme?: Theme;
  private templater?: Templater;
  private assetFetcher?: AssetFetcher;

  private urlService?: UrlService;
  private metaData?: MetaData;

  private config: any = {};
  private custom: any = {};

  constructor(store: Store, options: RenderOptions) {
    this.store = store;
    this.options = options;

    this.hbs = new BrowserHbs();
    console.debug("hbs", this.hbs);

    // FIXME read from localStorage.debug='hbs:N'
    this.hbs.handlebars.logger.level = 0;
  }

  private renderTemplate(template: string, data: any) {
    const filename = path.join(this.theme!.dir, template);

    this.setLocalOptions(data);

    return new Promise<string>((ok, err) =>
      this.hbs.render(
        filename,
        {
          ...data,
          cache: true,
        },
        (e: any, d: string) => {
          if (e) err(e);
          else ok(d);
        }
      )
    );
  }

  public renderPartial(template: string, self: any, locals: any) {
    const options = this.hbs.getTemplateOptions();
    const localTemplateOptions = this.hbs.getLocalTemplateOptions(locals);
    // attach options etc to 'locals'
    locals = merge(locals, localTemplateOptions, options);

    console.log("renderPartial", { template, self, locals });
    return templates.execute(template, self, locals, this.hbs);
  }

  public getMetaDataUrl(data: any, absolute?: boolean) {
    return this.metaData!.getMetaDataUrl(data, absolute);
  }

  public async init(
    settings: Site,
    themes: Theme[],
    cfg: any,
    templater?: Templater,
    assetFetcher?: AssetFetcher
  ) {
    this.settings = settings;
    this.theme = themes[0];
    if (!this.theme) throw new Error("No themes provided");

    this.templater = templater || new DefaultTemplater(this.theme);
    this.assetFetcher = assetFetcher || new DefaultAssetFetcher();
    this.urlUtils = new NostrSiteUrlUtils(cfg);
    this.urlService = new UrlService(
      this.store,
      this.urlUtils,
      this.settings.origin,
      this.settings.url || ""
    );
    this.metaData = new MetaData(
      this.theme.dir,
      this.assetFetcher,
      this.urlUtils,
      this.urlService
    );

    // init fetcher and assign to hbs
    for (const theme of themes) this.assetFetcher.addTheme(theme);

    this.assetFetcher.load();

    this.hbs.fetcher = this.assetFetcher.fetchHbs.bind(this.assetFetcher);

    const partialsDir: any = {};

    // only include defaults if the theme doesn't provide them
    partialsDir[`/${DEFAULT_PARTIALS_DIR_NAME}/`] = Object.keys(
      DEFAULT_PARTIALS
    ).filter((p) => !this.theme!.partials.includes(p));

    // theme partials
    partialsDir[path.join(this.theme.dir, "partials/")] = this.theme.partials;

    // start hbs
    this.hbs.init({
      partialsDir,
      restrictLayoutsTo: this.theme.dir,
      viewsDir: this.theme.dir,
      cache: true,
    });

    // pre-cache partial templates
    console.log("caching hbs partials");
    await new Promise((ok) => this.hbs.cachePartials(ok));

    // setup helpers
    initHelpers(this.hbs);

    urlHelpers.bindAll(cfg);

    this.config = {
      ...this.theme.config,
    };
    for (const [k, v] of settings.config.entries()) {
      this.config[k] = v;
    }
    console.log("config", this.config);

    this.custom = {
      ...this.theme.custom,
    };
    for (const [k, v] of settings.custom.entries()) {
      const bool =
        k in this.theme.custom && typeof this.theme.custom[k] === "boolean";
      this.custom[k] = bool ? v === "true" : v;
    }
    console.log("custom", this.custom);

    const renderer = {
      SafeString: this.hbs.SafeString,
      escapeExpression: this.hbs.handlebars.Utils.escapeExpression,
      hbs: this.hbs,
      renderOptions: this.options,
      localUtils,
      config: cfg,
      store: this.store,
      metaData: this.metaData,
      imageUtils: new ImageUtils(this.urlUtils),
      urlUtils: this.urlUtils,
      urlService: this.urlService,
      prepareContextResource(_: any) {
        // NOOP now, it's all unneeded
        // (Array.isArray(data) ? data : [data]).forEach((resource) => {
        //   // feature_image_caption contains HTML, making it a SafeString spares theme devs from triple-curlies
        //   // if (resource.feature_image_caption) {
        //   //   resource.feature_image_caption = new this.hbs.SafeString(
        //   //     resource.feature_image_caption
        //   //   );
        //   // }
        //   // some properties are extracted to local template data to force one way of using it
        //   // delete resource.show_title_and_feature_image;
        // });
      },
    };

    // all templates expect an absolute url w/o trailing slash
    let url = this.settings.origin + this.settings.url;
    while (url.endsWith("/")) url = url.substring(0, url.length - 1);
    console.log("site url", url, this.settings.origin, this.settings.url);

    // init template context
    this.hbs.updateTemplateOptions({
      data: {
        site: {
          ...this.settings,
          url,
        },
        labs: {},
        config: this.config,
        custom: this.custom,
        renderer,
      },
    });
  }

  private setLocalOptions(locals: any) {
    const localTemplateOptions = this.hbs.getLocalTemplateOptions(locals);

    // adjust @site.url for http/https based on the incoming request
    const siteData = {
      // we use relative url here!
      // url: this.urlUtils!.urlFor("home", { trailingSlash: false }, true),
    };

    // @TODO: it would be nicer if this was proper middleware somehow...
    // inject preview info, if any
    const previewData = {};

    // update site data with any preview values from the request
    Object.assign(siteData, previewData);

    // inject member info here
    // const member = req.member ? {
    //     uuid: req.member.uuid,
    //     email: req.member.email,
    //     name: req.member.name,
    //     firstname: req.member.name && req.member.name.split(' ')[0],
    //     avatar_image: req.member.avatar_image,
    //     subscriptions: req.member.subscriptions && req.member.subscriptions.map((sub) => {
    //         return Object.assign({}, sub, {
    //             default_payment_card_last4: sub.default_payment_card_last4 || '****'
    //         });
    //     }),
    //     paid: req.member.status !== 'free',
    //     status: req.member.status
    // } : null;
    const member = null;

    // take page
    const page = locals.page;
    delete locals.page;

    console.log("locals", { locals, localTemplateOptions });
    this.hbs.updateLocalTemplateOptions(
      locals,
      merge({}, localTemplateOptions, {
        data: {
          member: member,
          site: siteData,
          page,
        },
      })
    );
  }

  public async render(context: Context): Promise<string> {
    const start = Date.now();
    console.log("render", { ...context });

    let result = "";
    if (context.allowRss && context.context.includes("rss") && context.posts) {
      // rss
      result = await this.renderRss(context);
    } else {
      // html
      const template = this.templater!.template(context);

      console.log("context data", { context, template });

      result = await this.renderTemplate(template, context);
    }
    console.log("rendered", path, "in", Date.now() - start, "ms");

    return result;
  }

  private async renderRss(context: Context) {
    if (!this.settings) return "";

    const posts = context.posts;

    const url = this.settings.origin + this.settings.url;
    const prefix = url.substring(0, url.length - 1);
    const link = (p: string) => {
      return `${prefix}${p}`;
    };

    const pubDate = (published_at: string | null | undefined) => {
      if (!published_at) return "";
      return DateTime.fromMillis(Date.parse(published_at))
        .setZone("GMT")
        .toFormat("ccc, dd LLL yyyy TTT")
        .replace("UTC", "GMT");
    };

    const escapeHTML = (str: string) => {
      return str.replace(/[&<>'"]/g, (tag: string) => {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        }[tag]!;
      });
    };

    const getName = async (pubkey: string) => {
      const npub = profileId(pubkey);
      const profile = (await this.store.get(npub, "profiles")) as
        | Profile
        | undefined;
      return profile && profile.profile
        ? profile.profile.display_name || profile.profile.name
        : npub;
    };

    const admin = await getName(this.settings.admin_pubkey);
    const feedUrl = prefix + context.path;
    const htmlUrl = prefix + context.pathHtml;
    let rss = `<rss
      xmlns:atom="http://www.w3.org/2005/Atom"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns:content="http://purl.org/rss/1.0/modules/content/"
      xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      version="2.0"
    >
      <channel>
        <title><![CDATA[${this.settings!.title || ""}]]></title>
        <description><![CDATA[${
          this.settings!.description || ""
        }]]></description>
        <link>${htmlUrl}</link>
        <atom:link href="${escapeHTML(feedUrl)}" rel="self" type="application/rss+xml"/>
        <itunes:new-feed-url>${feedUrl}</itunes:new-feed-url>
        <itunes:author><![CDATA[${admin}]]></itunes:author>
        <itunes:subtitle><![CDATA[${
          this.settings!.description || ""
        }]]></itunes:subtitle>
        <itunes:type>episodic</itunes:type>
        <itunes:owner>
          <itunes:name><![CDATA[${admin}]]></itunes:name>
          <itunes:email><![CDATA[${admin}]]></itunes:email>
        </itunes:owner>
            `;
    if (posts && posts.length > 0) {
      const date = pubDate(posts[0].published_at);
      rss += `
      <pubDate>${date}</pubDate>
      <lastBuildDate>${date}</lastBuildDate>
      `;
    }

    const image = this.settings!.logo || this.settings!.icon;
    if (image) {
      rss += `
      <itunes:image href="${escapeHTML(image)}" />
      <image>
        <title><![CDATA[${this.settings!.title || ""}]]></title>
        <link>${htmlUrl}</link>
        <url>${image}</url>
      </image>`;
    }

    for (const p of posts!) {
      let payload = undefined;
      let medium = "";
      if (p.videos.length) {
        payload = p.videos[0];
        medium = "video";
      } else if (p.audios.length) {
        payload = p.audios[0];
        medium = "audio";
      } else if (p.images.length) {
        payload = p.images[0];
        medium = "image";
      }

      const author = await getName(p.event.pubkey);

      const item = `
      <item>
      <title><![CDATA[${p.title || ""}]]></title>
      ${
        p.title !== p.excerpt
          ? `<description><![CDATA[${p.excerpt || ""}]]></description>
             <itunes:subtitle><![CDATA[${p.excerpt || ""}]]></itunes:subtitle>`
          : ""
      }
      <pubDate>${pubDate(p.published_at)}</pubDate>
      <link>${link(p.url)}</link>
      <comments>${link(p.url)}</comments>
      <guid isPermaLink=\"false\">${p.id}</guid>
      <category>${p.primary_tag ? p.primary_tag.name : ""}</category>
      ${
        payload
          ? `
        <media:content url="${escapeHTML(payload)}" medium="${medium}"/>
        <enclosure 
          url="${escapeHTML(payload)}" length="0" 
          type="${getUrlMediaMime(payload)}" 
        />`
          : ""
      }
      <noteId>${p.id}</noteId>
      <npub>${p.npub}</npub>
      <dc:creator><![CDATA[${author}]]></dc:creator>
      <content:encoded><![CDATA[${p.html || ""}]]></content:encoded>
      <itunes:author><![CDATA[${author}]]></itunes:author>
      <itunes:summary><![CDATA[${p.html || ""}]]></itunes:summary>
      ${
        payload && medium === "image" ? `<itunes:image href="${escapeHTML(payload)}"/>` : ""
      }
      </item>
      `;
      rss += item;
    }

    rss += `
      </channel>
      </rss>
    `;

    return rss;
  }
}
