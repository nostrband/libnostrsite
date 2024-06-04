import NDK, {
  NDKEvent,
  NDKFilter,
  NDKRelaySet,
  NDKSubscription,
  NostrEvent,
} from "@nostr-dev-kit/ndk";
import { ThemeEngine } from "../theme-engine";
import { Site } from "../types/site";
import { RamStore } from "./ram-store";
import {
  KIND_LONG_NOTE,
  KIND_NOTE,
  KIND_PROFILE,
  SUPPORTED_KINDS,
} from "../consts";
import { NostrParser } from "../parser/parser";
import { Tag } from "../types/tag";
import { recommendations } from "./sample-recommendations";
import { Profile } from "../types/profile";
import { Post } from "../types/post";
import { StoreObject } from "../types/store";
import { matchFilter, nip19 } from "nostr-tools";
import { slugify } from "../../ghost/helpers/slugify";
import { DbEvent, dbi } from "./db";
import { PromiseQueue, RenderMode } from "..";

const MAX_OBJECTS = 10000;

export class NostrStore extends RamStore {
  private mode: RenderMode;
  private ndk: NDK;
  private settings: Site;
  private parser: NostrParser;
  private filters: NDKFilter[];
  private subs: NDKSubscription[] = [];

  constructor(
    mode: RenderMode = "iife",
    ndk: NDK,
    settings: Site,
    parser: NostrParser
  ) {
    super();
    this.mode = mode;
    this.ndk = ndk;
    this.settings = settings;
    this.parser = parser;
    this.filters = this.createTagFilters();
    console.log("tag filters", this.filters);
  }

  public destroy() {
    for (const s of this.subs) {
      s.stop();
    }
  }

  private matchObject(e: DbEvent | NostrEvent) {
    if (e.kind === KIND_PROFILE) return false;
    if (e.kind === KIND_NOTE) {
      if (e.tags.find((t) => t.length >= 2 && t[0] === "e")) {
        console.log("skip reply event", e);
        return false;
      }
    }

    // @ts-ignore
    return !!this.filters.find((f) => matchFilter(f, e));
  }

  private toNDKEvent(e: DbEvent) {
    return new NDKEvent(this.ndk, {
      id: e.id,
      pubkey: e.pubkey,
      created_at: e.created_at,
      kind: e.kind,
      content: e.content,
      tags: e.tags,
      sig: e.sig,
    });
  }

  private async loadFromDb(limit: number) {
    const events = await dbi.listEvents(limit);

    const badObjectIds = events
      .filter((e) => !this.matchObject(e))
      .map((e) => e.id);
    console.log("badObjectIds", badObjectIds);
    await dbi.deleteEvents(badObjectIds);

    const objects = events.filter((e) => this.matchObject(e));
    await this.parseEvents(objects.map((e) => this.toNDKEvent(e)));

    const profiles = events.filter((e) => e.kind === KIND_PROFILE);
    this.parseProfiles(profiles.map((p) => this.toNDKEvent(p)));

    let since = 0;
    if (objects.length > 0) {
      since = objects[0].created_at;
    }

    console.log(
      "load db objects",
      objects.length,
      "latest at",
      since,
      "profiles",
      profiles.length
    );

    return since;
  }

  private async fetchObjects(since?: number, until?: number, sub?: boolean) {
    console.log(Date.now(), "fetch objects", since, until, sub);

    const promises: Promise<void>[] = [];

    if (this.settings.include_all || !!this.settings.include_tags?.length) {
      promises.push(this.fetchByFilter(since, until, sub));
    }

    // if (this.settings.include_manual) {
    //   promises.push(this.fetchManual(since, until, sub));
    // }

    await Promise.all(promises);

    console.log(Date.now(), "fetched objects", since, until, sub);
  }

  private async loadMinimal() {
    // a fast method to get some usable set of events

    // load 100 latest from db and
    // fetch since latest in db until now
    const since = await this.loadFromDb(100);
    await this.fetchObjects(since);
  }

  private async fetchAllObjects() {
    console.log(Date.now(), "start full sync");
    let until = 0;
    do {
      const was_count = this.posts.length;
      await this.fetchObjects(0, until);

      if (this.posts.length === was_count) {
        console.log("stop full sync, end");
        break;
      }

      const newUntil = this.posts
        .map((p) => p.event.created_at)
        .reduce((last, current) => Math.min(last, current), until);
      if (newUntil === until) {
        console.log("stop full sync, same cursor", newUntil);
        break;
      }
      until = newUntil;
    } while (this.posts.length < MAX_OBJECTS);

    console.log(Date.now(), "done full sync, posts", this.posts.length);
  }

  private async loadAll() {
    let since = await this.loadFromDb(MAX_OBJECTS);

    const sync = await dbi.getSync();
    const synced = sync && sync.site_id === this.settings.event.id;

    if (!synced) {
      // forward sync will be done from 'now'
      since = Math.floor(Date.now() / 1000);

      // full sync
      await this.fetchAllObjects();

      // mark as synced
      await dbi.setSync(this.settings.event.id!);
    }

    // sync forward from 'since'
    await this.fetchObjects(since, 0, true);
  }

  private async loadSsr() {
      await this.fetchAllObjects();
  }

  public async load() {
    this.recommendations = recommendations;

    if (this.mode === "iife") {
      await this.loadMinimal();
    } else if (this.mode === "sw") {
      await this.loadAll();
    } else if (this.mode === "ssr") {
      await this.loadSsr();
    }

    await this.fetchAuthors();

    await this.postProcess();

    console.log("store posts", this.posts);
    console.log("store tags", this.tags);
    console.log("store authors", this.authors);
    console.log("store profiles", this.profiles);
    console.log("store recommendations", this.recommendations);
  }

  public async prepare(engine: ThemeEngine) {
    this.posts.forEach((post) => {
      post.url = engine.getMetaDataUrl(post);
    });
    this.tags.forEach((tag) => {
      tag.url = engine.getMetaDataUrl(tag);
    });
    this.authors.forEach((author) => {
      author.url = engine.getMetaDataUrl(author);
    });
  }

  private async storeEvents(events: NDKEvent[]) {
    // no caching for ssr for now
    if (this.mode === "ssr") return;

    const dbEvents: DbEvent[] = events.map((e) => ({
      id: e.id || "",
      pubkey: e.pubkey || "",
      kind: e.kind || 0,
      created_at: e.created_at || 0,
      content: e.content || "",
      tags: e.tags || [],
      sig: e.sig || "",
      d_tag: e.tags.find((t) => t.length >= 2 && t[0] === "d")?.[1] || "",
    }));

    const promise = dbi.addEvents(dbEvents);

    // block if we're not in tab rendering mode
    if (this.mode !== "iife") await promise;
  }

  private async parsePostTags(post: Post, e: NDKEvent) {
    const allowed = (this.settings.config.get("hashtags") || "")
      .split(",")
      .filter((t) => !!t);

    // ensure tags
    for (const tagName of this.parser.parseHashtags(e)) {
      if (allowed.length && !allowed.includes(tagName)) continue;

      const existingTag = this.tags.find((t) => t.id === tagName);
      const tag: Tag = existingTag || {
        id: tagName,
        url: "",
        slug: slugify(tagName),
        name: tagName,
        description: null,
        meta_title: null,
        meta_description: null,
        feature_image: null,
        visibility: "public",
        images: [],
        postIds: [],
      };

      if (!existingTag) this.tags.push(tag);

      tag.postIds.push(post.id);

      post.tags.push(tag);
      if (!post.primary_tag) post.primary_tag = tag;
    }
  }

  private async parseEvents(events: NDKEvent[]) {
    for (const e of events) {
      let post: Post | undefined;
      switch (e.kind) {
        case KIND_LONG_NOTE:
          post = await this.parser.parseLongNote(e);
          break;
        case KIND_NOTE:
          post = await this.parser.parseNote(e);
          break;
        default:
          console.warn("invalid kind", e);
      }
      if (!post) continue;
      if (this.posts.find((p) => p.id === post!.id)) continue;

      // make sure it has unique slug
      if (this.posts.find((p) => p.slug === post!.slug)) post.slug = post.id;

      // hashtags
      this.parsePostTags(post, e);

      // put to local storage
      this.posts.push(post);

      console.debug("post", post);
    }
  }

  private async postProcess() {
    // NOTE: must be idempotent

    // attach images to tags
    for (const tag of this.tags) {
      for (const post of this.posts.filter((p) =>
        p.tags.find((t) => t.id === tag.id)
      )) {
        tag.images.push(...post.images);
      }
      // dedup
      tag.images = [...new Set(tag.images)];
    }

    // get tags without images, sorted by number of images asc
    const sortedTags = [...this.tags.filter((t) => !t.feature_image)].sort(
      (a, b) => a.images.length - b.images.length
    );

    for (const tag of sortedTags) {
      for (const image of tag.images) {
        // if image not already used, use it
        if (!this.tags.find((t) => t.feature_image === image)) {
          const t = this.tags.find((t) => t.id === tag.id);
          t!.feature_image = image;
          break;
        }
      }
    }

    // now sort tags from most used to least used
    this.tags.sort((a, b) => b.postIds.length - a.postIds.length);

    // sort posts desc by update time
    this.posts.sort((a, b) => b.event.created_at - a.event.created_at);
  }

  private async fetchAuthors() {
    // NOTE: must be idempotent

    // fetch authors
    let pubkeys = [
      ...(this.settings.contributor_pubkeys || []),
      this.settings.admin_pubkey,
    ];
    for (const p of this.posts) {
      pubkeys.push(p.event.pubkey);
      pubkeys.push(
        ...p.event.tags
          .filter((t) => t.length >= 2 && t[0] === "p" && t[1].length === 64)
          .map((t) => t[1])
      );
    }

    // only fetch new ones
    pubkeys = pubkeys.filter(
      (pubkey) => !this.profiles.find((p) => p.pubkey === pubkey)
    );

    await this.fetchProfiles(pubkeys);

    // assign authors
    for (const post of this.posts) {

      // got author already?
      if (post.primary_author) continue;

      const id = this.parser.getAuthorId(post.event);
      let author = this.authors.find((a) => a.id === id);
      if (!author) {
        // create new author from profile
        const profile = this.profiles.find((p) => p.id === id);
        if (profile) {
          author = this.parser.parseAuthor(profile);
          this.authors.push(author);
        }
      }

      // assign author to this post and count the post
      if (author) {
        author.count.posts++;
        post.primary_author = author;
        post.authors.push(author);
      }
    }
  }

  protected async fetchObject(
    slugId: string,
    objectType?: string
  ): Promise<StoreObject | undefined> {
    console.log("fetchObject", slugId, objectType);

    const f: NDKFilter = {
      authors: this.settings.contributor_pubkeys,
      limit: 1,
    };

    switch (objectType) {
      case "posts":
        f.kinds = SUPPORTED_KINDS;
        break;
      case "tags":
        // FIXME fetch tag object?
        return undefined;
      case "authors":
        // FIXME fetch profile object?
        return undefined;
    }

    try {
      const { type, data } = nip19.decode(slugId);
      switch (type) {
        case "naddr":
          if (this.settings.contributor_pubkeys!.includes(data.pubkey))
            return undefined;
          f["#d"] = [data.identifier];
          break;
        case "nevent":
          f.ids = [data.id];
          break;
        case "note":
          f.ids = [data];
          break;
        case "nprofile":
        case "npub":
          return undefined;
      }
    } catch {
      f["#d"] = [slugId];
    }

    const event = await this.ndk.fetchEvent(f);
    console.log("fetchObject got", slugId, objectType, event);
    if (!event || !this.matchObject(event.rawEvent())) return undefined;

    await this.parseEvents([event]);
  }

  private async fetchProfiles(pubkeys: string[]) {
    const relays = [
      ...(this.settings.include_relays || []),
      ...(this.settings.admin_relays || []),
      "wss://relay.nostr.band",
      "wss://purplepag.es",
    ];

    const events = await this.ndk.fetchEvents(
      {
        kinds: [KIND_PROFILE],
        authors: pubkeys,
      },
      {},
      NDKRelaySet.fromRelayUrls(relays, this.ndk)
    );
    console.log("profiles", { events, relays });
    if (!events) return;

    await this.storeEvents([...events]);

    this.parseProfiles([...events]);
  }

  private parseProfiles(events: NDKEvent[]) {
    for (const e of events) {
      const p = this.parser.parseProfile(e);
      this.profiles.push(p);
    }
  }

  private createTagFilters(since?: number, until?: number) {
    const filters: NDKFilter[] = [];
    const add = (kind: number, tag?: { tag: string; value: string }) => {
      const f: NDKFilter = {
        authors: this.settings.contributor_pubkeys,
        kinds: [kind],
        limit: this.mode !== "iife" ? 1000 : 50,
      };
      if (tag) {
        // @ts-ignore
        f["#" + tag.tag] = [tag.value];
      }
      if (since) {
        f.since = since;
      }
      if (until) {
        f.until = until;
      }

      filters.push(f);
    };

    let kinds = SUPPORTED_KINDS;
    if (this.settings.include_kinds?.length)
      kinds = this.settings.include_kinds
        .map((k) => parseInt(k))
        .filter((k) => SUPPORTED_KINDS.includes(k));

    const addAll = (tag?: { tag: string; value: string }) => {
      for (const k of kinds) add(k, tag);
    };

    if (this.settings.include_all) {
      addAll();
    } else if (this.settings.include_tags?.length) {
      for (const tag of this.settings.include_tags) {
        if (tag.tag.length !== 1 || tag.tag < "a" || tag.tag > "z") {
          console.log("Invalid include tag", tag);
          continue;
        }

        addAll(tag);
      }
    }

    return filters;
  }

  private async fetchByFilter(
    since?: number,
    until?: number,
    subscribe?: boolean
  ) {
    const filters = this.createTagFilters(since, until);
    if (!filters.length) {
      console.warn("Empty filters for 'include' tags");
      return;
    }

    // FIXME implement proper relay selection logic
    const relays = this.settings.include_relays ||
      this.settings.admin_relays || ["wss://relay.nostr.band"];

    const sub = this.ndk.subscribe(
      filters,
      {},
      NDKRelaySet.fromRelayUrls(relays, this.ndk),
      false // auto-start
    );
    this.subs.push(sub);

    let eose = false;
    const events: NDKEvent[] = [];

    const queue = new PromiseQueue();

    return new Promise<void>((ok) => {
      sub.on(
        "event",
        queue.appender(async (e) => {
          if (eose && subscribe) {
            console.log("new event", e);
            if (this.matchObject(e)) {
              await this.storeEvents([e]);
              await this.parseEvents([e]);

              // ensure we load profiles
              await this.fetchAuthors();

              // 
              await this.postProcess();          
            }
          } else {
            if (this.matchObject(e)) events.push(e);
          }
        })
      );

      sub.on(
        "eose",
        queue.appender(async () => {
          eose = true;
          if (!subscribe) sub.stop();

          console.log("events", { events, filters, relays });
          await this.storeEvents(events);
          await this.parseEvents(events);
          ok();

          events.length = 0;
        })
      );

      sub.start();
    });
  }

  // private async fetchManual(_: number) {
  //   // FIXME implement
  // }

  public getProfile(pubkey: string): Profile | undefined {
    return this.profiles.find((p) => p.pubkey === pubkey);
  }
}
