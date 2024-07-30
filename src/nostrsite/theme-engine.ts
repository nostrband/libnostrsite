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
import { Post } from "./types/post";
import { Tag } from "./types/tag";
import { Author } from "./types/author";
import { Theme } from "./types/theme";
import { UrlService } from "./modules/urlservice";
import { Context } from "./types/context";
import { Templater } from "./types/templater";
import { DefaultTemplater } from "./modules/default-templater";
import { Store } from "./types/store";
import { Route, Router } from "./types/router";
import { DefaultRouter } from "./modules/default-router";
import { AssetFetcher } from "./types/asset-fetcher";
import { DefaultAssetFetcher } from "./modules/default-asset-fetcher";
import {
  DEFAULT_PARTIALS,
  DEFAULT_PARTIALS_DIR_NAME,
} from "./partials/default-partials";
import merge from "lodash-es/merge";
import toNumber from "lodash-es/toNumber";
import { PLAY_FEATURE_BUTTON_PREFIX, RenderOptions } from ".";
import { templates } from "../ghost/frontend/services/theme-engine/handlebars/template";
import { DateTime } from "luxon";

const DEFAULT_POSTS_PER_PAGE = 6;

function ensureNumber(v: any | undefined): number | undefined {
  if (v === undefined) return undefined;
  return toNumber(v);
}

export class ThemeEngine {
  private readonly hbs;
  private readonly options: RenderOptions;

  private urlUtils?: NostrSiteUrlUtils;
  private store: Store;
  private settings?: Site;
  private theme?: Theme;
  private router?: Router;
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
    router?: Router,
    templater?: Templater,
    assetFetcher?: AssetFetcher
  ) {
    this.settings = settings;
    this.theme = themes[0];
    if (!this.theme) throw new Error("No themes provided");

    this.router = router || new DefaultRouter(this.settings);
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
      this.custom[k] = v;
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

    this.hbs.updateTemplateOptions({
      data: {
        site: this.settings,
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
      //      url: this.urlUtils!.urlFor("home", { trailingSlash: false }, true),
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

  private async loadContextData(route: Route): Promise<Context> {
    const limit =
      ensureNumber(this.config.posts_per_page) || DEFAULT_POSTS_PER_PAGE;

    const data: Context = {
      context: route.context,
      mediaUrls: [],
    };

    if (route.context.includes("home")) {
      const list = await this.store.list({ type: "posts", limit });
      data.posts = list.posts;
      data.pagination = list.pagination;
    } else if (route.context.includes("paged")) {
      const pageNum = parseInt(route.param!);
      const list = await this.store.list({
        type: "posts",
        page: pageNum,
        limit,
      });
      data.posts = list.posts;
      data.pagination = list.pagination;
    } else if (route.context.includes("post")) {
      const slugId = route.param!;
      data.object = await this.store.get(slugId, "posts");
      data.post = data.object as Post;
      if (
        data.post &&
        data.post.feature_image?.startsWith(PLAY_FEATURE_BUTTON_PREFIX)
      ) {
        data.post = { ...data.post, feature_image: null };
      }
      data.page = {
        show_title_and_feature_image: data.post
          ? data.post.show_title_and_feature_image
          : true,
      };
    } else if (route.context.includes("tag")) {
      const slugId = route.param!;
      data.object = await this.store.get(slugId, "tags");
      data.tag = data.object as Tag;
      if (data.tag) {
        const list = await this.store.list({ type: "posts", tag: data.tag.id });
        data.posts = list.posts;
        data.pagination = list.pagination;
      }
    } else if (route.context.includes("author")) {
      const slugId = route.param!;
      data.object = await this.store.get(slugId, "authors");
      data.author = data.object as Author;
      if (data.author) {
        const list = await this.store.list({
          type: "posts",
          author: data.author.id,
        });
        data.posts = list.posts;
        data.pagination = list.pagination;
      }
    } else {
      // FIXME find a static page matching the path
      console.log("bad path");
    }

    // FIXME assets from other objects?
    if (data.posts) {
      // @ts-ignore
      data.mediaUrls.push(
        ...data.posts.map((p) => p.feature_image || "").filter((i) => !!i)
      );
    }
    if (data.post) data.mediaUrls.push(...data.post.images);

    if (
      !route.context.includes("error") &&
      !route.context.includes("home") &&
      !route.context.includes("paged") &&
      !data.object
    ) {
      console.log("object not found", { route });
      data.context = ["error"];
    }

    return data;
  }

  public async render(
    path: string
  ): Promise<{ result: string; context: Context }> {
    const start = Date.now();
    console.log("render", path);

    // parse the url into "Ghost context" and param
    const route = this.router!.route(path);

    // NOTE: context.context might differ from route.context
    // due to 404 Not Found errors etc
    const context = await this.loadContextData(route);

    const template = this.templater!.template(context);

    console.log("context data", { route, context, template });

    const result = await this.renderTemplate(template, context);

    console.log("rendered", path, "in", Date.now() - start, "ms");

    return { result, context };
  }

  public async getSiteMap(limit?: number) {
    limit = limit || 1000;

    const map: string[] = [];
    const base = this.settings!.url || "/";
    const prefix = base.substring(0, base.length - 1);
    const put = (p: string) => {
      const path = `${prefix}${p}`;
      map.push(path);
    };
    put("/");

    const posts = (await this.store.list({ type: "posts", limit })).posts;

    // FIXME shouldn't this live in router?
    // OTOH, object.url is filled in parser, so it's already a mess...
    const pageLimit =
      ensureNumber(this.config.posts_per_page) || DEFAULT_POSTS_PER_PAGE;
    for (let i = 1; i <= posts!.length / pageLimit; i++) put(`/page/${i}`);

    for (const p of posts!) {
      put(p.url);
    }
    for (const t of (await this.store.list({ type: "tags", limit: 100 }))
      .tags!) {
      put(t.url);
    }
    for (const a of (await this.store.list({ type: "authors", limit: 10 }))
      .authors!) {
      put(a.url);
    }

    return map;
  }

  public async getRss(limit: number = 20) {
    if (!this.settings) return "";
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

    const posts = (await this.store.list({ type: "posts", limit })).posts;
    let rss = `<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
      <channel>
        <title>${this.settings!.title}</title>
        <description>${this.settings!.description}</description>
        <link>${url}</link>
        <atom:link href="${url}feed.xml" rel="self" type="application/rss+xml"/>
        <pubDate>${pubDate(posts?.[0].published_at)}</pubDate>
    `;
    const image = this.settings!.logo || this.settings!.icon;
    if (image) {
      rss += `
      <image>
        <title>${this.settings!.title}</title>
        <link>${url}</link>
        <url>${image}</url>
      </image>`;
    }

    for (const p of posts!) {
      const item = `
      <item>
      <title>${p.title}</title>
      <description>${p.excerpt}</description>
      <pubDate>${pubDate(p.published_at)}</pubDate>
      <link>${link(p.url)}</link>
      <comments>${link(p.url)}</comments>
      <guid isPermaLink=\"false\">${p.id}</guid>
      <category>${p.primary_tag ? p.primary_tag.name : ""}</category>
      <noteId>${p.id}</noteId>
      <npub>${p.npub}</npub>
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
