import NDK, {
  NDKEvent,
  NDKFilter,
  NDKRelaySet,
  NDKSubscription,
  NostrEvent,
} from "@nostr-dev-kit/ndk";
import { Site } from "../types/site";
import { RamStore } from "./ram-store";
import {
  BLACKLISTED_RELAYS,
  KIND_LONG_NOTE,
  KIND_NOTE,
  KIND_PROFILE,
  MAX_OBJECTS_IIFE,
  MAX_OBJECTS_PREVIEW,
  MAX_OBJECTS_SSR,
  MAX_OBJECTS_SW,
  MAX_OBJECTS_TAB,
  OUTBOX_RELAYS,
  SUPPORTED_KINDS,
} from "../consts";
import { NostrParser } from "../parser/parser";
import { Tag } from "../types/tag";
// import { recommendations } from "./sample-recommendations";
import { Post } from "../types/post";
import { StoreObject } from "../types/store";
import { matchFilter, nip19 } from "nostr-tools";
import { slugify } from "../../ghost/helpers/slugify";
import { DbEvent, dbi } from "./db";
import {
  PromiseQueue,
  RenderMode,
  eventId,
  fetchEvent,
  fetchEvents,
  fetchRelays,
  profileId,
  tags,
} from "..";
import { scanRelays } from "../..";

export class NostrStore extends RamStore {
  private mode: RenderMode;
  private ndk: NDK;
  private settings: Site;
  private parser: NostrParser;
  private filters: NDKFilter[];
  private maxObjects: number = 0;
  private subs: NDKSubscription[] = [];
  private fetchedRelays?: boolean;
  private getUrlCb?: (o: StoreObject) => string;

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

  public matchObject(e: DbEvent | NostrEvent | NDKEvent) {
    if (e.kind === KIND_PROFILE) return false;
    if (e.kind === KIND_NOTE) {
      if (
        e.tags.find((t) => t.length >= 4 && t[0] === "e" && t[3] === "root")
      ) {
        // console.log("skip reply event", e.id, e.pubkey);
        return false;
      }
    }

    // @ts-ignore
    return !!this.filters.find((f) => matchFilter(f, e));
  }

  private async loadFromDb(limit: number) {
    const events = await dbi.listEvents(limit);

    // NOTE: it's hard to know which events are 'related'
    // and which belong to the site, so we just rely on
    // matchObject below to filter, and don't try to clean
    // up the db.
    // @ts-ignore
    // const badObjectIds: string[] = events
    //   .filter(
    //     (e) =>
    //       e.kind !== KIND_SITE &&
    //       e.kind !== KIND_PACKAGE &&
    //       e.kind !== KIND_PROFILE &&
    //       !this.matchObject(e)
    //   )
    //   .map((e) => e.id);
    // // console.log("badObjectIds", badObjectIds);
    // await dbi.deleteEvents(badObjectIds);

    const objects = events.filter((e) => this.matchObject(e));
    await this.parseEvents(objects.map((e) => new NDKEvent(this.ndk, e)));

    const profiles = events.filter((e) => e.kind === KIND_PROFILE);
    this.parseProfiles(profiles.map((p) => new NDKEvent(this.ndk, p)));

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

  private async fetchRelays() {
    // already known?
    if (
      this.settings.contributor_relays.length > 0 ||
      this.fetchedRelays ||
      this.isOffline()
    )
      return;

    // one try only
    this.fetchedRelays = true;

    // NOTE: we expect fetchRelays to provide a good small set
    // of relays for each contributor
    let maxRelays = 6;
    switch (this.mode) {
      case "iife":
      case "preview":
        maxRelays = 3;
        break;
    }

    // fetch relays for contributors
    const { write, read } = await fetchRelays(
      this.ndk,
      this.settings.contributor_pubkeys,
      maxRelays
    );

    this.settings.contributor_relays = write;
    this.settings.contributor_inbox_relays = read;

    // // limit number of relays if we care about latency
    // if (this.mode === "iife" || this.mode === "preview")
    //   this.settings.contributor_relays.length = Math.min(
    //     this.settings.contributor_relays.length,
    //     5
    //   );

    console.log("contributor outbox relays", this.settings.contributor_relays);
  }

  // private async fetchObjects(
  //   relay: string,
  //   since?: number,
  //   until?: number,
  //   sub?: boolean
  // ) {
  //   console.warn(Date.now(), "fetch objects", since, until, sub);

  //   const promises: Promise<number | undefined>[] = [];

  //   if (this.settings.include_all || !!this.settings.include_tags?.length) {
  //     promises.push(this.fetchByFilter(since, until, sub));
  //   } else {
  //     console.warn("No include tags specified!");
  //   }

  //   // if (this.settings.include_manual) {
  //   //   promises.push(this.fetchManual(since, until, sub));
  //   // }

  //   const results = await Promise.all(promises);
  //   const newUntil = results.reduce(
  //     (pv, cv) => (!cv ? pv : pv ? Math.min(cv, pv) : cv),
  //     until
  //   );

  //   console.warn(
  //     Date.now(),
  //     "fetched objects",
  //     since,
  //     until,
  //     "=>",
  //     newUntil,
  //     sub
  //   );

  //   return newUntil;
  // }

  private async loadIife() {
    // a fast method to get some usable set of events

    // load some posts from db and
    const since = await this.loadFromDb(this.maxObjects * 10);
    // fetch since latest in db until now
    await this.fetchAllObjects(this.maxObjects, since);
  }

  private async loadPreview() {
    // fetch the latest stuff from relays
    await this.fetchAllObjects(this.maxObjects);
  }

  private async getRelays() {
    // ensure relays are known
    await this.fetchRelays();

    // use admin relays if contributor relays are empty
    return this.settings.contributor_relays || this.settings.admin_relays;
  }

  private async subscribeOnNewEvents(since: number) {
    const relays = await this.getRelays();
    if (this.settings.include_all || !!this.settings.include_tags?.length) {
      await this.fetchByFilter(relays, since, 0, true);
    }
  }

  private async fetchAllObjects(
    max: number = 0,
    since: number = 0,
    until: number = 0,
    slow = false
  ) {
    if (this.isOffline()) return;

    const relays = await this.getRelays();
    console.log(Date.now(), "sync start max", max, relays);

    const timeout =
      this.mode === "iife" ||
      this.mode === "preview" ||
      (this.mode === "ssr" && max <= 500) // index.html
        ? 3000
        : 10000;
    const threads = slow ? 5 : this.mode === "ssr" ? 50 : 15;

    let promises = [];
    if (this.settings.include_all || !!this.settings.include_tags?.length) {
      promises.push(
        (async () => {
          await scanRelays(this.ndk, this.createTagFilters(), relays, max, {
            matcher: (e) => this.matchObject(e),
            onBatch: async (events) => {
              await this.storeEvents(events);
              await this.parseEvents(events);
              await this.processBatch();
              console.warn(
                Date.now(),
                "scan batch events",
                events.length,
                "posts",
                this.posts.length
              );
            },
            since,
            until,
            timeout,
            threads,
          });
        })()
      );
      // for (const relay of relays) {
      //   promises.push(
      //     this.scanRelayPosts(
      //       relay,
      //       max,
      //       since,
      //       this.fetchByFilterFromRelay.bind(this)
      //     )
      //   );
      // }
    }

    // scan all relays in parallel, track until cursor
    // on each relay separately to make sure we scan them
    // properly
    await Promise.all(promises);

    // let until = 0;
    // let reqsLeft = 30; // 30*300=10k
    // do {
    //   // const was_count = this.posts.length;
    //   const newUntil = await this.fetchObjects(since, until);

    //   // if (this.posts.length === was_count) {
    //   //   console.log("stop sync, end");
    //   //   break;
    //   // }

    //   // const newUntil = this.posts
    //   //   .map((p) => p.event.created_at)
    //   //   .reduce((last, current) => Math.min(last, current), until);
    //   console.log("newUntil", newUntil);
    //   if (!newUntil) {
    //     console.log("stop sync, end");
    //     break;
    //   }
    //   if (newUntil === until) {
    //     console.log("stop sync, same cursor", newUntil);
    //     break;
    //   }
    //   until = newUntil!;
    //   --reqsLeft;
    // } while (this.posts.length < max && reqsLeft > 0);

    console.log(Date.now(), "sync done all posts", this.posts.length);
  }

  // private async scanRelayPosts(
  //   relay: string,
  //   max: number = 0,
  //   since: number = 0,
  //   fetcher: (
  //     relay: string,
  //     since: number,
  //     until: number
  //   ) => Promise<number | undefined>
  // ) {
  //   console.log(Date.now(), "sync start", relay, max, since);

  //   let until = 0;
  //   let reqsLeft = 30; // 30*300=10k
  //   do {
  //     // const was_count = this.posts.length;
  //     const newUntil = await fetcher(relay, since, until);
  //     console.log(
  //       "sync next until",
  //       relay,
  //       newUntil,
  //       "posts",
  //       this.posts.length
  //     );
  //     if (!newUntil) {
  //       console.log("sync end", relay);
  //       break;
  //     }
  //     if (newUntil === until) {
  //       console.log("sync stop same cursor", relay, newUntil);
  //       break;
  //     }
  //     until = newUntil!;
  //     --reqsLeft;
  //   } while (this.posts.length < max && reqsLeft > 0);

  //   console.log(Date.now(), "sync done", relay);
  // }

  private async loadSw() {
    // FIXME if site settings object changed and list of
    // hashtags/kinds/authors expanded then we would
    // need to reset the cache, otherwise we'd load
    // only a subset of events from cache and not resync really
    const since = await this.loadFromDb(this.maxObjects);
    const now = Math.floor(Date.now() / 1000);

    const sync = await dbi.getSync();
    const synced = sync && sync.site_id === this.settings.event.id;

    if (synced) {
      // sync forward from since
      await this.fetchAllObjects(this.maxObjects, since);
    } else {
      // NOTE: instead of this pre-sync, which essentially loads
      // the same stuff that iife mode has just loaded, we assume sw
      // is ready and just do the full background sync until the
      // already-loaded post
      if (!this.posts.length) {
        // only do if iife failed
        // pre-sync 10%
        await this.fetchAllObjects(100);
      }

      // iife has already loaded some recent posts and written them to db,
      // now we should do full sync until the oldest of the recent posts
      const until = this.posts
        .map((p) => p.event.created_at!)
        .reduce((pv, cv) => Math.min(pv, cv), now);

      console.log("sync sw until", until);

      // full bg sync since oldest object,
      // only scan UP TO maxObject taking loaded objects into account
      const left = this.maxObjects - this.posts.length;
      this.fetchAllObjects(left, 0, until, true).then(async () => {
        // mark as synced
        await dbi.setSync(this.settings.event.id!);
      });
    }

    // sync forward from 'since'
    this.subscribeOnNewEvents(now);
  }

  private async loadSsr() {
    await this.fetchAllObjects(this.maxObjects);
  }

  private async loadTab() {
    // load everything from db
    await this.loadFromDb(this.maxObjects);
    // first page load? fetch some from network
    if (!this.posts.length) await this.fetchAllObjects(100);
    // ensure relays
    else await this.fetchRelays();
  }

  private getMaxObjects() {
    switch (this.mode) {
      case "iife":
        return MAX_OBJECTS_IIFE;
      case "preview":
        return MAX_OBJECTS_PREVIEW;
      case "ssr":
        return MAX_OBJECTS_SSR;
      case "sw":
        return MAX_OBJECTS_SW;
      case "tab":
        return MAX_OBJECTS_TAB;
    }
  }

  private async processBatch() {
    await this.fetchContributors();
    await this.assignAuthors();
    await this.postProcess();

    // assign urls, prepare html
    await this.prepare();
  }

  public async load(maxObjects: number = 0) {
    if (maxObjects) this.maxObjects = maxObjects;
    else this.maxObjects = this.getMaxObjects();

    if (this.mode === "iife") {
      await this.loadIife();
    } else if (this.mode === "preview") {
      await this.loadPreview();
    } else if (this.mode === "sw") {
      await this.loadSw();
    } else if (this.mode === "ssr") {
      await this.loadSsr();
    } else if (this.mode === "tab") {
      await this.loadTab();
    }

    await this.processBatch();

    console.log("store posts", this.posts);
    console.log("store tags", this.tags);
    console.log("store authors", this.authors);
    console.log("store profiles", this.profiles);
    console.log("store recommendations", this.recommendations);

    console.warn("loaded posts", this.posts.length);
  }

  public async prepare(getUrl?: (o: StoreObject) => string) {
    if (!getUrl) getUrl = this.getUrlCb;
    this.getUrlCb = getUrl;

    // noop if not yet provided with getUrl callback
    if (!getUrl) return;

    // assign urls first
    for (const tag of this.tags) {
      tag.url = getUrl!(tag);
    }
    for (const author of this.authors) {
      author.url = getUrl!(author);
    }
    for (const post of this.posts) {
      post.url = getUrl!(post);
    }

    // prepare html second
    for (const post of this.posts) {
      if (!post.html) await this.parser.prepareHtml(post, this);
    }
  }

  private async storeEvents(events: NDKEvent[]) {
    // no caching for ssr for now
    if (!this.useCache()) return;

    //const promise =
    await dbi.addEvents(events);

    // block if we're not in tab rendering mode
    //if (this.mode !== "iife" && this.mode !== "tab") await promise;
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
        type: "tag",
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

  private removePost(post: Post) {
    for (const t of post.tags) {
      t.postIds = t.postIds.filter((id) => id !== post.id);
    }
    for (const a of post.authors) {
      a.count.posts--;
    }
    this.posts.splice(
      this.posts.findIndex((p) => p.id === post.id),
      1
    );
  }

  // NOTE: we only auto-fetch profiles for all the
  // nostr: links, these can't result in infinite
  // recursion and can work for SSR, resolving
  // of note links is done on the client when
  // rendering each specific page to limit the number
  // of events to be fetched
  private async fetchProfileLinks(events: NDKEvent[]) {
    console.log("fetchProfileLinks", events.length, events);
    const pubkeys: string[] = [];
    const relays: string[] = [];

    // parse event tags
    for (const e of events) {
      pubkeys.push(e.pubkey);
      for (const p of tags(e, "p")) {
        if (p[1].length !== 64) continue;
        pubkeys.push(p[1]);
        if (p.length > 2 && p[2].startsWith("wss://")) relays.push(p[2]);
      }
    }

    // parse content links (those might not match tags)
    const links = events
      .map((e) => {
        switch (e.kind) {
          case KIND_LONG_NOTE:
          case KIND_NOTE:
            return this.parser
              .parseNostrLinks(e.content)
              .map((l) => l.split("nostr:")[1]);
          case KIND_PROFILE:
            const profile = this.parser.parseProfile(e);
            return this.parser
              .parseNostrLinks(profile.profile?.about || "")
              .map((l) => l.split("nostr:")[1]);
        }
        return [];
      })
      .flat();
    console.log("nostr profile links", events, links);

    links.forEach((id) => {
      try {
        const { type, data } = nip19.decode(id);
        switch (type) {
          case "npub":
            pubkeys.push(data);
            break;
          case "nprofile":
            pubkeys.push(data.pubkey);
            relays.push(...(data.relays || []));
            break;
        }
      } catch {}
    });

    console.log("linked profiles", { pubkeys, relays });

    let nonCached = [];
    for (const pubkey of pubkeys) {
      if (!this.profiles.find((p) => p.pubkey === pubkey))
        nonCached.push(pubkey);
    }

    // nothing to fetch
    if (!nonCached.length) return;

    // fetch new profiles
    await this.fetchProfiles(nonCached, relays);
  }

  private async parseEvents(events: NDKEvent[], related: boolean = false) {
    // pre-parse and fetch all linked events
    await this.fetchProfileLinks(events);

    // now when linked events are cached we can
    // parse events and use linked events to
    // format content
    for (const e of events) {
      const post = await this.parser.parseEvent(e, this);
      if (!post) continue;

      const list = related ? this.related : this.posts;

      // replaceable events
      const existing = list.find((p) => p.id === post!.id);
      if (existing && existing.event.created_at > post.event.created_at)
        continue;

      if (!related) {
        // drop existing post, we're replacing it with a new version
        if (existing) this.removePost(existing);

        // make sure it has unique slug
        if (this.posts.find((p) => p.slug === post!.slug)) post.slug = post.id;

        // hashtags
        this.parsePostTags(post, e);
      }

      // put to local storage
      list.push(post);

      console.debug(related ? "related" : "post", post);
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
    this.posts.sort((a, b) => {
      if (a.published_at === b.published_at) return 0;
      if (b.published_at! < a.published_at!) return -1;
      return 1;
    });
  }

  private async fetchContributors() {
    const pubkeys = [
      ...(this.settings.contributor_pubkeys || []),
      this.settings.admin_pubkey,
    ];
    await this.fetchProfiles(pubkeys);
  }

  private async assignAuthors() {
    // NOTE: must be idempotent

    // assign authors
    for (const post of this.posts) {
      // got author already?
      if (post.primary_author) continue;

      const id = profileId(post.event);
      let author = this.authors.find((a) => a.id === id);
      if (!author) {
        // create new author from profile
        const profile = this.profiles.find((p) => p.id === id);
        if (profile) {
          author = await this.parser.parseAuthor(profile, this);
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

  protected async fetchRelated(ids: string[], relayHints: []) {
    console.log("fetchRelated", ids);

    const events: NDKEvent[] = [];
    if (this.useCache()) {
      const cached = await dbi.listEventsByIds(ids);
      console.log("cached related", cached);
      events.push(...cached.map((e) => new NDKEvent(this.ndk!, e)));
      ids = ids.filter((id) => !cached.find((c) => eventId(c) === id));
    }

    const idFilter: NDKFilter = { ids: [] };
    const naddrFilters: NDKFilter[] = [];

    for (const id of ids) {
      // NOTE: ids are expected to have been `normalizeId`-ed
      const { type, data } = nip19.decode(id);
      switch (type) {
        case "note":
          idFilter.ids!.push(data);
          break;
        case "naddr":
          naddrFilters.push({
            kinds: [data.kind],
            authors: [data.pubkey],
            "#d": [data.identifier],
          });
          break;
        default:
          throw new Error("Invalid related id " + id);
      }
    }

    const filters: NDKFilter[] = [...naddrFilters];
    if (idFilter.ids!.length) filters.push(idFilter);

    if (filters.length) {
      const relays = [
        ...relayHints.filter((r) => !BLACKLISTED_RELAYS.includes(r)),
        ...this.settings.contributor_relays,
        ...this.settings.contributor_inbox_relays,
      ];

      const newEvents = await fetchEvents(this.ndk, filters, relays, 3000);
      console.log("fetchRelated got", ids, newEvents);

      await this.storeEvents([...newEvents]);

      events.push(...newEvents);
    }

    await this.parseEvents([...events], /*related=*/ true);
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

    const event = await fetchEvent(
      this.ndk,
      f,
      this.settings.contributor_relays,
      3000
    );
    console.log("fetchObject got", slugId, objectType, event);
    if (!event || !this.matchObject(event.rawEvent())) return undefined;

    await this.parseEvents([event]);
    await this.storeEvents([event]);
    await this.processBatch();
  }

  private useCache() {
    return this.mode !== "ssr" && this.mode !== "preview";
  }

  public async fetchProfiles(pubkeys: string[], relayHints: string[] = []) {
    // only fetch new ones
    pubkeys = pubkeys.filter(
      (pubkey) => !this.profiles.find((p) => p.pubkey === pubkey)
    );

    const cachedEvents = this.useCache() ? await dbi.listProfiles(pubkeys) : [];
    const profiles = cachedEvents
      .filter((e) => pubkeys.includes(e.pubkey))
      .map((e) => new NDKEvent(this.ndk, e));
    console.log("cached profiles", profiles, pubkeys);

    const nonCachedPubkeys = [
      ...new Set(pubkeys.filter((p) => !profiles.find((e) => e.pubkey === p))),
    ];

    if (nonCachedPubkeys.length > 0) {
      const relays = [
        ...this.settings.contributor_relays,
        ...OUTBOX_RELAYS,
        ...relayHints,
      ];
      console.log("fetching profiles", nonCachedPubkeys, relays);
      const events = await fetchEvents(
        this.ndk,
        {
          kinds: [KIND_PROFILE],
          authors: nonCachedPubkeys,
        },
        relays,
        1000 // timeoutMs
      );
      console.log("fetched profiles", { events, relays });
      if (events) {
        profiles.push(...events);

        await this.storeEvents([...events]);
      }
      // NOTE: links in bio are non-standard, and it's
      // an infinite loop here (fetching profiles that link
      // to each other won't finish), we should implement
      // a cache for these linked events before we try this
      // await this.fetchNostrLinks([...events]);
    }

    this.parseProfiles([...profiles]);
  }

  private parseProfiles(events: NDKEvent[]) {
    for (const e of events) {
      const p = this.parser.parseProfile(e);
      this.profiles.push(p);
    }
  }

  private createTagFilters(since?: number, until?: number) {
    // const limit =
    //   this.mode !== "iife" && this.mode !== "preview"
    //     ? Math.min(this.maxObjects, 1000)
    //     : 50;

    // download in batches of 2x of max objects (some of them
    // we'll drop, i.e. replies), max batch is 300 to make
    // sure we fit into the default timeout per batch
    const limit = Math.min(this.maxObjects * 2, 300);

    const filters: NDKFilter[] = [];
    const add = (kind: number, tag?: { tag: string; value: string }) => {
      const tagKey = "#" + tag?.tag;
      // reuse filters w/ same tag
      let f: NDKFilter | undefined = filters.find((f) => {
        // if (!f.kinds?.includes(kind)) return false;
        if (!tag) return !Object.keys(f).find((k) => k.startsWith("#"));
        else return tagKey in f;
      });

      if (!f) {
        // first filter for this tag
        f = {
          authors: this.settings.contributor_pubkeys,
          kinds: [kind],
          limit,
        };
        if (tag) {
          // @ts-ignore
          f[tagKey] = [tag.value];
        }
        if (since) {
          f.since = since;
        }
        if (until) {
          f.until = until;
        }

        // append new filter
        filters.push(f);
      } else {
        // append tag and kind
        if (tag) {
          // @ts-ignore
          if (!f[tagKey].includes(tag.value)) {
            // @ts-ignore
            f[tagKey].push(tag.value);
          }
        }
        if (!f.kinds!.includes(kind)) f.kinds!.push(kind);
      }
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

  private isOffline() {
    const offline =
      (this.mode === "sw" || this.mode === "iife") && !navigator?.onLine;
    console.log("sw offline", offline, this.mode);
    return offline;
  }

  // private async fetchByFilterFromRelay(
  //   relay: string,
  //   since?: number,
  //   until?: number
  // ) {
  //   return this.fetchByFilter([relay], since, until);
  // }

  private async fetchByFilter(
    relays: string[],
    since?: number,
    until?: number,
    subscribe?: boolean
  ) {
    if (this.isOffline()) return until;

    const filters = this.createTagFilters(since, until);
    if (!filters.length) {
      console.warn("Empty filters for 'include' tags");
      return until;
    }

    console.warn("fetchByFilter", since, until, subscribe, relays, filters);

    let eose = false;
    const events: NDKEvent[] = [];

    const sub = this.ndk.subscribe(
      filters,
      { groupable: false },
      NDKRelaySet.fromRelayUrls(relays, this.ndk),
      false // auto-start
    );
    this.subs.push(sub);

    const queue = new PromiseQueue();
    let newUntil = until;

    return new Promise<number | undefined>((ok) => {
      const timeoutMs =
        subscribe || // it's forward looking, should be fast
        this.mode === "iife" || // asap
        (this.mode === "ssr" && this.maxObjects <= 500) // index.html
          ? 3000
          : 10000;

      const timeout = setTimeout(() => {
        console.warn(
          "fetchByFilter timeout",
          timeoutMs,
          filters,
          since,
          until,
          relays
        );
        onEose();
      }, timeoutMs);

      const onEose = async () => {
        if (timeout) clearTimeout(timeout);
        if (eose) return; // timeout

        // events.sort((a, b) => b.created_at! - a.created_at!);
        // console.warn(Date.now(), "fetchByFilter end", since, until, [
        //   ...events,
        // ]);

        eose = true;
        if (!subscribe) sub.stop();

        // console.log("events", { events, filters, relays });
        await this.storeEvents(events);
        await this.parseEvents(events);
        ok(newUntil);

        // consumed
        events.length = 0;
      };

      const onEvent = async (e: NDKEvent) => {
        if (!newUntil || e.created_at! < newUntil) newUntil = e.created_at;
        if (eose && subscribe) {
          console.log("new event", e);
          if (this.matchObject(e)) {
            await this.storeEvents([e]);
            await this.parseEvents([e]);
            await this.processBatch();
          }
        } else {
          if (this.matchObject(e)) events.push(e);
        }
      };

      sub.on("event", queue.appender(onEvent));

      sub.on("eose", queue.appender(onEose));

      sub.start();
    });
  }

  // private async fetchManual(_: number) {
  //   // FIXME implement
  // }
}
