import { Context, normalizeId } from "..";
import { DEFAULT_MAX_LIMIT } from "../consts";
import { Author } from "../types/author";
import { Post } from "../types/post";
import { Profile } from "../types/profile";
import { Recommendation } from "../types/recommendation";
import {
  Store,
  StoreListRequest,
  StoreListResponse,
  StoreObject,
} from "../types/store";
import { Tag } from "../types/tag";

export class RamStore implements Store {
  protected posts: Post[] = [];
  protected tags: Tag[] = [];
  protected authors: Author[] = [];
  protected profiles: Profile[] = [];
  protected recommendations: Recommendation[] = [];
  protected related: Post[] = [];
  protected pins: string[] = [];

  constructor() {}

  public async prepare(_: (o: StoreObject) => string) {}
  public destroy() {}
  public async update(_: Context) {}

  protected async fetchObject(
    slugId: string,
    type?: string
  ): Promise<StoreObject | undefined> {
    throw new Error("Store fetch not implemented " + slugId + " type " + type);
  }

  protected async fetchRelated(
    _ids: string[],
    _relays: string[]
  ): Promise<void> {
    throw new Error("Store fetch related not implemented");
  }

  public async get(
    slugId: string,
    type?: string,
    sync?: boolean
  ): Promise<StoreObject | undefined> {
    try {
      [slugId] = normalizeId(slugId);
    } catch {}
    let object = this.getSync(slugId, type);
    if (!object && !sync) {
      await this.fetchObject(slugId, type);
      object = this.getSync(slugId, type);
    }
    return Promise.resolve(object);
  }

  public getUrl(id: string, type?: string) {
    console.log("geturl", id, type, this.getSync(id, type));
    if (type === "profiles") return "";
    return (this.getSync(id, type) as undefined | Post | Author | Tag)?.url;
  }

  private getSync(slugId: string, type?: string): StoreObject | undefined {
    if (!type) {
      return (
        this.posts.find((p) => p.id === slugId || p.slug === slugId) ||
        this.tags.find((p) => p.id === slugId || p.slug === slugId) ||
        this.authors.find((p) => p.id === slugId || p.slug === slugId) ||
        this.profiles.find((p) => p.id === slugId || p.slug === slugId) ||
        this.related.find((p) => p.id === slugId || p.slug === slugId)
      );
    }

    switch (type) {
      case "posts":
        return this.posts.find((p) => p.id === slugId || p.slug === slugId);
      case "related":
        return this.related.find((p) => p.id === slugId || p.slug === slugId);
      case "tags":
        return this.tags.find((p) => p.id === slugId || p.slug === slugId);
      case "authors":
        return this.authors.find((p) => p.id === slugId || p.slug === slugId);
      case "profiles":
        return this.profiles.find((p) => p.id === slugId);
      case "recommendations":
        return this.recommendations.find((p) => p.id === slugId);
      default:
        throw new Error("Bad type " + type);
    }
  }

  public async list(req: StoreListRequest): Promise<StoreListResponse> {
    const { type } = req;
    const slugId = req.id || req.slug || undefined;

    // ensure proper id format
    let idRelays: string[] = [];
    if (req.ids) {
      for (let i = 0; i < req.ids.length; i++) {
        const [id, relays] = normalizeId(req.ids[i]);
        req.ids[i] = id;
        idRelays.push(...relays);
      }
      idRelays = [...new Set(idRelays)];
    }

    if (type === "related" && req.ids) {
      // check input
      for (const id of req.ids)
        if (id.startsWith("npub")) throw new Error("Invalid related id");

      // fetch non-existent related ids
      const newIds = req.ids.filter(
        (id) =>
          !this.related.find((r) => r.id === id) &&
          !this.posts.find((r) => r.id === id)
      );
      if (newIds.length) await this.fetchRelated(newIds, idRelays);
    }

    // NOTE: it's a hack, a typical 'related' query,
    // we should implement this in a better way
    const relatedNoteId = req.filter?.match(/id\:\-([^\+]*)+/)?.[1];

    const results = [];
    if (slugId) {
      const r = await this.get(slugId, type);
      if (r) results.push(r);
    } else {
      const parseFilter = (prefix: string, toLower: boolean = false) => {
        const filter: string[] = [];
        if (!req.filter) return filter;

        const subFilter = req.filter
          .split("+")
          .find((s) => s.startsWith(prefix + ":"));
        if (!subFilter) return filter;

        const list = req.filter.split(":")[1];
        if (list.startsWith("[")) {
          filter.push(...list.substring(1, list.length - 1).split(","));
        } else {
          filter.push(list);
        }
        if (toLower) return filter.map((f) => f.toLocaleLowerCase());
        else return filter;
      };
      const parseFilterValue = (prefix: string) => {
        const filter = parseFilter(prefix);
        return filter.length ? filter[0] : "";
      }

      const featured = parseFilterValue("featured") === 'true';
      const slugs = parseFilter("slug");
      let tags = req.hashtags;
      if (!tags) tags = parseFilter("tag", true);
      const authors = parseFilter("author");
      const primary_tags = parseFilter("primary_tag", true);
      const primary_authors = parseFilter("primary_author");

      if (req.tag) tags.push(req.tag.toLocaleLowerCase());
      if (req.author) authors.push(req.author);

      console.log("list filter", {
        req,
        filter: req.filter,
        slugs,
        tags,
        authors,
        primary_tags,
        primary_authors,
        featured
      });

      switch (type) {
        case "posts":
          results.push(
            ...this.posts.filter(
              (p) =>
                (!featured || !this.pins.length || p.featured) &&
                (!slugs.length || slugs.includes(p.slug)) &&
                (!tags!.length ||
                  p.tags.find(
                    (t) =>
                      tags!.includes(t.slug.toLocaleLowerCase()) ||
                      tags!.includes(t.id)
                  )) &&
                (!primary_tags.length ||
                  primary_tags.includes(
                    p.primary_tag?.slug.toLocaleLowerCase() || ""
                  ) ||
                  primary_tags.includes(p.primary_tag?.id || "")) &&
                (!authors.length ||
                  p.authors.find(
                    (a) => authors.includes(a.slug) || authors.includes(a.id)
                  )) &&
                (!req.kinds ||
                  !req.kinds.length ||
                  req.kinds.includes(p.event.kind!)) &&
                (!primary_authors.length ||
                  primary_authors.includes(p.primary_author?.slug || "") ||
                  primary_authors.includes(p.primary_author?.id || ""))
            )
          );
          break;
        case "tags":
          results.push(
            ...this.tags.filter((t) => !slugs.length || slugs.includes(t.slug))
          );
          results.sort(
            (a, b) => (a.feature_image ? 0 : 1) - (b.feature_image ? 0 : 1)
          );
          break;
        case "authors":
          results.push(...this.authors);
          break;
        case "profiles":
          results.push(...this.profiles);
          break;
        case "recommendations":
          results.push(...this.recommendations);
          break;
        case "related":
          results.push(
            ...this.related.filter(
              (p) => !req.ids || !req.ids.length || req.ids.includes(p.id!)
            )
          );
          break;
        default:
          throw new Error("Not implemented");
      }
    }

    let relatedIndex: number | undefined;
    if (relatedNoteId) {
      const all = [...results];
      results.length = 0;
      results.push(...all.filter((p) => p.id !== relatedNoteId));
      relatedIndex = all.findIndex((p) => p.id === relatedNoteId);
    }

    const total = results.length;
    const limit = req.limit || DEFAULT_MAX_LIMIT;
    const perPage = Math.min(total, limit);
    const page = req.page && req.page > 0 ? req.page : 1;
    const pages = Math.ceil(total / perPage);
    let start = (page - 1) * perPage;
    const count = Math.min(perPage, total - start);

    if (type === "posts" && relatedIndex !== undefined && count < total) {
      start = Math.max(0, relatedIndex - Math.ceil(count / 2));
    }

    const end = start + count;

    const pageResults = results.slice(start, end);

    const response: StoreListResponse = {
      pagination: {
        total,
        page,
        pages,
        limit,
        prev: page > 1 ? page - 1 : null,
        next: end < total ? page + 1 : null,
        until: results
          .map((p) => p.event ? p.event.created_at! : 0)
          .reduce((pv, cv) => Math.min(pv, cv), Math.floor(Date.now() / 1000)),
      },
    };

    // @ts-ignore
    response[type] = pageResults;

    console.log("list response", { req, response });

    return response;
  }

  public isValidType(type: string): boolean {
    return (
      type === "posts" ||
      type === "tags" ||
      type === "authors" ||
      type === "pages" ||
      type === "tiers" ||
      type === "newsletters"
    );
  }
}
