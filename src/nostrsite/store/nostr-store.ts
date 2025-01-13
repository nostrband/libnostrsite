import NDK, {
  NDKEvent,
  NDKFilter,
  NDKKind,
  NDKRelaySet,
  NDKSubscription,
  NostrEvent,
} from "@nostr-dev-kit/ndk";
import { Site } from "../types/site";
import { RamStore } from "./ram-store";
import {
  DEFAULT_MAX_LIMIT,
  KIND_CONTACTS,
  KIND_LONG_NOTE,
  KIND_MUSIC,
  KIND_NOTE,
  KIND_PINNED_TO_SITE,
  KIND_PROFILE,
  KIND_RELAYS,
  KIND_SITE,
  KIND_SITE_SUBMIT,
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
import { nip19 } from "nostr-tools";
import { slugify } from "../../ghost/helpers/slugify";
import { DbEvent, dbi } from "./db";
import {
  Context,
  PromiseQueue,
  RenderMode,
  eventId,
  fetchEvent,
  fetchEvents,
  fetchRelays,
  parseRelayEvents,
  prepareRelays,
  profileId,
  tags,
  tv,
} from "..";
import {
  createSiteFilters,
  createSiteSubmitFilters,
  fetchByIds,
  matchPostsToFilters,
  parseAddr,
  scanRelays,
} from "../..";
import { SUBMIT_STATE_ADD, Submit } from "../types/submit";

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
  private fetchContextDone = new Set<string>();
  private submittedEvents = new Map<string, Submit>();

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
    this.filters = this.createTagFilters({});
    console.log("tag filters", this.filters);
  }

  public destroy() {
    for (const s of this.subs) {
      s.stop();
    }
  }

  public matchObject(e: DbEvent | NostrEvent | NDKEvent) {
    const match =
      matchPostsToFilters(e, this.filters) ||
      this.submittedEvents.get(eventId(e))?.state === SUBMIT_STATE_ADD;
    // if (!match) console.log("skip ", e.id, e);
    return match;
  }

  private async loadFromDb(limit: number) {
    const submits = await dbi.listKindEvents(KIND_SITE_SUBMIT, limit);
    await this.parseEvents(submits.map((e) => new NDKEvent(this.ndk, e)));

    const events = await dbi.listPostEvents(limit);

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

    // ignore events that don't match or are already parsed
    const objects = events.filter(
      (e) => this.matchObject(e) && !this.posts.find((p) => p.event.id === e.id)
    );
    await this.parseEvents(objects.map((e) => new NDKEvent(this.ndk, e)));

    const profiles = events.filter(
      (e) =>
        e.kind === KIND_PROFILE &&
        !this.profiles.find((p) => p.event.id === e.id)
    );
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

  public async prepareSettings() {
    await this.fetchRelays();
  }

  private async fetchRelays() {
    // already known?
    if (this.settings.contributor_relays.length > 0 || this.fetchedRelays)
      return;

    // NOTE: we expect fetchRelays to provide a good small set
    // of relays for each contributor
    let maxRelays = 6;
    switch (this.mode) {
      case "iife":
      case "preview":
        maxRelays = 3;
        break;
    }

    // look at cache first
    if (this.useCache()) {
      const cached = [
        ...(await dbi.listKindEvents(KIND_CONTACTS, 100)),
        ...(await dbi.listKindEvents(KIND_RELAYS, 100)),
      ].filter((e) => this.settings.contributor_pubkeys.includes(e.pubkey));
      console.log("cached outbox relay events", cached);

      const pubkeyRelays = parseRelayEvents(
        new Set(cached.map((e) => new NDKEvent(this.ndk, e)))
      );
      const { read, write } = prepareRelays(pubkeyRelays, maxRelays);

      this.settings.contributor_relays = write;
      this.settings.contributor_inbox_relays = read;

      console.log(
        "contributor cached outbox relays",
        this.settings.contributor_relays
      );
    }

    const fetch = async () => {
      // skip if we're offline
      if (this.isOffline()) return;

      // one try only
      if (this.fetchedRelays) return;
      this.fetchedRelays = true;

      // fetch relays for contributors
      const { write, read, events } = await fetchRelays(
        this.ndk,
        this.settings.contributor_pubkeys,
        maxRelays
      );

      await this.storeEvents(events);

      this.settings.contributor_relays = write;
      this.settings.contributor_inbox_relays = read;

      console.log(
        "contributor outbox relays",
        this.settings.contributor_relays
      );
    };

    // if we've got some from cache then do background
    // update for relay list event, otherwise
    // block until relays are fetched
    if (this.settings.contributor_relays.length) {
      // tab shouldn't do this
      if (this.mode !== "tab") fetch();
    } else await fetch();
  }

  private async fetchPins() {
    if (!this.pins.length) return;

    const pins = this.pins.filter(
      (p) => !this.posts.find((post) => post.id === p)
    );

    const idsFilter: NDKFilter = {
      ids: pins
        .map((p) => nip19.decode(p))
        .filter((p) => p.type === "note")
        .map((p) => p.data as string),
    };
    const addrs = pins
      .map((p) => nip19.decode(p))
      .filter((p) => p.type === "naddr")
      .map((p) => p.data) as nip19.AddressPointer[];
    const addrFilter: NDKFilter = {
      authors: [...new Set(addrs.map((a) => a.pubkey))],
      kinds: [...new Set(addrs.map((a) => a.kind))],
      "#d": [...new Set(addrs.map((a) => a.identifier))],
    };
    const filters: NDKFilter[] = [];
    if (idsFilter.ids!.length) filters.push(idsFilter);
    if (addrFilter.authors!.length) filters.push(addrFilter);
    if (!filters.length) return;

    const relays = await this.getRelays();
    const events = await fetchEvents(this.ndk, filters, relays, 3000);

    const matching = [...events].filter((e) => this.matchObject(e));
    console.log("store update pinned", matching);
    await this.storeEvents(matching);
    await this.parseEvents(matching);
    await this.processBatch();
  }

  private async fetchForContext(context: Context) {
    // now fetch route-specific stuff, if any
    let kinds: number[] = [];
    let hashtags: string[] = [];
    let authors: string[] = [];
    if (
      context.context.includes("index") &&
      !context.context.includes("kind")
    ) {
      if (this.settings.homepage_kinds)
        kinds = this.settings.homepage_kinds.map((k) => parseInt(k));
      if (this.settings.homepage_tags) {
        hashtags = this.settings.homepage_tags
          .filter((t) => t.tag === "t")
          .map((t) => t.value);
      }
    } else if (context.context.includes("kind")) {
      kinds = context.context
        .filter((c) => c.startsWith("kind:"))
        .map((c) => parseInt(c.split("kind:")[1]));
    } else if (context.context.includes("tag")) {
      hashtags = [context.param!];
    } else if (context.context.includes("author")) {
      authors = [this.authorIdToPubkey(context.param!)];
    }
    // NOTE: post pages are fetched automatically using fetchObject

    console.log("fetchForRoute", context, { authors, kinds, hashtags });

    const contextId =
      kinds.join(",") + ":" + hashtags.join(",") + authors.join(",");

    // already done?
    if (this.fetchContextDone.has(contextId)) return;

    // if there are filters specific to the current page,
    // make sure we load them too
    if (kinds.length || hashtags.length || authors.length) {
      // make sure we try to load until (before) the current
      // page of results
      let until = undefined;
      if (context.pagination) until = context.pagination.until - 1;

      // create filters for the current route
      const filters = this.createTagFilters({
        authors: authors.length ? authors : undefined,
        kinds: kinds.length ? kinds : undefined,
        hashtags: hashtags.length ? hashtags : undefined,
      });

      // load up to 1 new page
      const limit = context.pagination
        ? context.pagination.limit
        : DEFAULT_MAX_LIMIT;

      // ensure we don't load excessive events, but do 5x
      // to make sure we accomodate for skipped replies
      filters.forEach((f) => (f.limit = limit * 5));

      // fetch, with small timeout
      const wasPosts = this.posts.length;
      await this.fetchAllObjects(limit, { until, filters, timeout: 3000 });

      // nothing loaded? mark as done
      if (wasPosts === this.posts.length) {
        console.log("done fetchForContext", contextId);
        this.fetchContextDone.add(contextId);
      }
    }
  }

  private async loadIife() {
    // a fast method to get some usable set of events

    // load some posts from db and
    const since = await this.loadFromDb(this.maxObjects * 10);
    // fetch since latest in db until now
    await this.fetchAllObjects(this.maxObjects, { since });
    await this.fetchPinList();
  }

  private async loadPreview() {
    // fetch the latest stuff from relays
    await this.fetchAllObjects(this.maxObjects, {});
    await this.fetchPinList();
  }

  private async getRelays() {
    // ensure relays are known
    await this.fetchRelays();

    // use admin relays if contributor relays are empty
    return this.settings.contributor_relays || this.settings.admin_relays;
  }

  private async subscribeForNewEvents(since: number) {
    const relays = await this.getRelays();
    if (this.settings.include_all || !!this.settings.include_tags?.length) {
      await this.fetchByFilter(relays, since, 0, true);
    }

    this.subscribeForPins(relays, since);
  }

  private async fetchAllObjects(
    max: number,
    {
      since = 0,
      until = 0,
      slow = false,
      filters,
      submitFilters,
      timeout,
    }: {
      since?: number;
      until?: number;
      slow?: boolean;
      filters?: NDKFilter[];
      submitFilters?: NDKFilter[];
      timeout?: number;
    }
  ) {
    if (this.isOffline()) return;

    const relays = await this.getRelays();
    console.log(Date.now(), "sync start max", max, relays, filters);

    filters = filters || this.createTagFilters({});
    submitFilters = submitFilters || this.createSubmitFilters({});
    console.log(
      "fetchAllObjects filters",
      filters,
      "submitFilters",
      submitFilters
    );

    timeout =
      timeout ||
      (this.mode === "iife" ||
      this.mode === "preview" ||
      (this.mode === "ssr" && max <= 500) // index.html
        ? 3000
        : 10000);
    const threads = slow ? 5 : this.mode === "ssr" ? 50 : 15;

    const onBatch = async (events: NDKEvent[]) => {
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
    };

    let promises = [];
    // if (this.settings.include_all || !!this.settings.include_tags?.length) {
    if (filters?.length) {
      promises.push(
        scanRelays(this.ndk, filters, relays, max, {
          matcher: (e) => this.matchObject(e),
          onBatch,
          since,
          until,
          timeout,
          threads,
        })
      );
    }

    // fetch submit events
    if (submitFilters.length) {
      promises.push(
        scanRelays(this.ndk, submitFilters, relays, max, {
          matcher: () => true,
          onBatch,
          since,
          until,
          timeout,
          threads,
        })
      );
    }

    await Promise.all(promises);

    console.log(Date.now(), "sync done all posts", this.posts.length, filters);
  }

  private async getSynched() {
    const sync = await dbi.getSync();
    return sync && sync.site_id === this.settings.event.id;
  }

  private async loadSw() {
    const since = await this.loadFromDb(this.maxObjects);
    const now = Math.floor(Date.now() / 1000);
    const synced = await this.getSynched();

    if (synced) {
      // sync forward from since
      await this.fetchAllObjects(this.maxObjects, { since });
    } else {
      // NOTE: instead of doing some fast pre-sync, which essentially loads
      // the same stuff that iife mode has just loaded, we assume sw
      // is ready and just do the full background sync until the
      // already-loaded post

      // if (!this.posts.length) {
      //   // only do if iife failed - pre-sync 10%
      //   await this.fetchAllObjects(this.maxObjects / 10, {});
      // }

      // NOTE: even though iife has already loaded something,
      // we can't know if it was full scan or forRoute, and so can't
      // assume that oldest post in db has everything loaded in front of it
      // const until = this.getUntil();
      // console.log("sync sw until", until);

      // full bg sync until now,
      // only scan UP TO maxObject taking loaded objects into account,
      // otherwise every restart of half-done sync will load more and
      // more data
      const left = this.maxObjects - this.posts.length;
      this.fetchAllObjects(left, { slow: true }).then(async () => {
        // mark as synced
        await dbi.setSync(this.settings.event.id!);
      });
    }

    await this.fetchPinList();

    // sync forward from 'since'
    this.subscribeForNewEvents(now);
  }

  private async loadSsr() {
    await this.fetchAllObjects(this.maxObjects, {});
    await this.fetchPinList();
  }

  private async loadTab() {
    // load everything from db
    await this.loadFromDb(this.maxObjects);
    // first page load? fetch some from network
    if (!this.posts.length) {
      await this.fetchAllObjects(50, {});
      await this.fetchPinList();
    } else {
      // ensure relays
      await this.fetchRelays();
    }
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

  public async update(context: Context) {
    // make sure we fetch the needed stuff
    switch (this.mode) {
      case "iife":
      case "preview":
        await this.fetchForContext(context);
        break;
      case "sw":
        await this.fetchForContext(context);
        break;
      case "ssr":
        // make deploy work properly
        if (context.context.includes("home")) {
          await this.fetchForContext(context);
        }
        break;
    }
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
      .filter((t) => !!t)
      .map((t) => t.toLocaleLowerCase());

    // ensure tags
    const hashtags = this.parser.parseHashtags(e);
    console.log("parseHashtags", post.id, hashtags);
    for (const tagName of hashtags) {
      const tagId = tagName.toLocaleLowerCase();
      if (tagId.length > 128) continue; // FS issues
      if (allowed.length && !allowed.includes(tagId)) continue;

      const existingTag = this.tags.find((t) => t.id === tagId);
      const tag: Tag = existingTag || {
        type: "tag",
        id: tagId,
        url: "",
        slug: slugify(tagId),
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
      if (!tag.postIds.includes(post.id)) tag.postIds.push(post.id);
      if (!post.tags.find((t) => t.id === tagId)) post.tags.push(tag);
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
        if (
          p.length > 2 &&
          typeof p[2] === "string" &&
          p[2].startsWith("wss://")
        )
          relays.push(p[2]);
      }
    }

    // parse content links (those might not match tags)
    const links = events
      .map((e) => {
        switch (e.kind) {
          case KIND_LONG_NOTE:
          case KIND_NOTE:
          case KIND_MUSIC:
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
    if (!events.length) return;

    // pre-parse and fetch all linked events
    await this.fetchProfileLinks(events);

    // now when linked events are cached we can
    // parse events and use linked events to
    // format content
    const newSubmitEvents: string[] = [];
    for (const e of events) {
      // submit events
      if (e.kind === KIND_SITE_SUBMIT) {
        const submit = await this.parser.parseSubmitEvent(e);
        if (!submit) continue;

        const existing = this.submittedEvents.get(submit.eventAddress);
        if (!existing || existing.event.created_at < submit.event.created_at) {
          this.submittedEvents.set(submit.eventAddress, submit);
          if (submit.state === SUBMIT_STATE_ADD)
            newSubmitEvents.push(submit.eventAddress);
        }
        continue;
      }

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

    await this.fetchSubmitted(newSubmitEvents);
  }

  private async postProcess() {
    // NOTE: must be idempotent

    // mark featured
    for (const p of this.posts) {
      p.featured = this.pins.includes(p.id);
    }

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

  private getPinListFilter(): NDKFilter {
    const pubkey = this.settings.admin_pubkey;

    const addr = parseAddr(this.settings.naddr);
    const a_tag = `${KIND_SITE}:${addr.pubkey}:${addr.identifier}`;

    return {
      "#d": [a_tag],
      kinds: [KIND_PINNED_TO_SITE as NDKKind],
      authors: [pubkey],
    };
  }

  private async fetchPinList() {
    const filter = this.getPinListFilter();
    const pubkey = filter.authors![0];
    const a_tag = filter["#d"]![0];

    const relays = [...this.settings.contributor_relays];
    console.log("fetching pins", pubkey, relays);

    let event = await fetchEvent(
      this.ndk,
      filter,
      relays,
      1000 // timeoutMs
    );
    console.log("fetched pins", { event, relays });
    if (event) {
      await this.storeEvents([event]);
    } else {
      if (this.useCache()) {
        // relay issues etc
        const cachedEvents = await dbi.listKindEvents(KIND_PINNED_TO_SITE, 100);
        const cachedPins = cachedEvents.find(
          (e) => e.pubkey === pubkey && tv(e, "d") === a_tag
        );
        console.log("cached pins", pubkey, cachedPins);
        if (cachedPins) {
          event = new NDKEvent(this.ndk, cachedPins);
        }
      }
    }
    if (event) await this.parsePins([event]);
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

  protected async fetchSubmitted(ids: string[]) {
    if (!ids.length) return;

    console.log("fetchSubmitted", ids);

    // check cache first
    const events: NDKEvent[] = [];
    if (this.useCache()) {
      const cached = await dbi.listEventsByIds(ids);
      console.log("cached submitted", cached);
      events.push(...cached.map((e) => new NDKEvent(this.ndk!, e)));
      ids = ids.filter((id) => !cached.find((e) => eventId(e) === id));
    }

    if (ids.length) {
      // contributor relays + relays of submitted events
      const relayHints = [
        ...this.settings.contributor_relays,
        ...this.settings.contributor_inbox_relays,
      ];
      for (const id of ids) {
        const submit = this.submittedEvents.get(id);
        if (submit) relayHints.push(submit.relay);
      }

      const newEvents = await fetchByIds(this.ndk, ids, relayHints, {
        timeout: 5000,
      });

      await this.storeEvents([...newEvents]);

      events.push(...newEvents);
    }

    await this.parseEvents([...events]);
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

    if (ids.length) {
      const relays = [
        ...relayHints,
        ...this.settings.contributor_relays,
        ...this.settings.contributor_inbox_relays,
      ];

      const newEvents = await fetchByIds(this.ndk, ids, relays);
      console.log("fetchRelated got", ids, newEvents);

      await this.storeEvents([...newEvents]);

      events.push(...newEvents);
    }

    await this.parseEvents([...events], /*related=*/ true);
  }

  private authorIdToPubkey(id: string) {
    try {
      const { type, data } = nip19.decode(id);
      if (type === "npub") return data;
      console.log("bad author id type", id, type);
    } catch (e) {
      console.log("bad author id", id, e);
    }
    return "";
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

    await this.storeEvents([event]);
    await this.parseEvents([event]);
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

    this.parseProfiles(profiles);
  }

  private parseProfiles(events: NDKEvent[]) {
    for (const e of events) {
      const p = this.parser.parseProfile(e);
      this.profiles.push(p);
    }
  }

  private async parsePins(events: NDKEvent[]) {
    // reset
    this.pins.length = 0;
    for (const p of this.posts) p.featured = false;

    for (const e of events) {
      const pins = this.parser.parsePins(e);
      console.log("pins by", e.pubkey, pins);
      this.pins.push(...pins);

      const post = this.posts.find((p) => pins.includes(p.id));
      if (post) post.featured = true;
    }
    console.log("new pins", this.pins);

    await this.fetchPins();
  }

  private createTagFilters({
    since,
    until,
    authors,
    kinds,
    hashtags,
  }: {
    since?: number;
    until?: number;
    authors?: string[];
    kinds?: number[];
    hashtags?: string[];
  }) {
    // download in batches of 2x of max objects (some of them
    // we'll drop, i.e. replies), max batch is 300 to try
    // to fit into the default timeout per batch
    const limit = Math.min(this.maxObjects * 2, 300);

    return createSiteFilters({
      since,
      until,
      authors,
      kinds,
      hashtags,
      limit,
      settings: this.settings,
    });
  }

  private createSubmitFilters({
    since,
    until,
    authors,
    kinds,
    hashtags,
  }: {
    since?: number;
    until?: number;
    authors?: string[];
    kinds?: number[];
    hashtags?: string[];
  }) {
    // limit the batch to 300 submit events
    const limit = Math.min(this.maxObjects, 300);

    return createSiteSubmitFilters({
      since,
      until,
      authors,
      kinds,
      hashtags,
      limit,
      settings: this.settings,
    });
  }

  private isOffline() {
    const offline =
      (this.mode === "sw" || this.mode === "iife") && !navigator?.onLine;
    console.log("sw offline", offline, this.mode);
    return offline;
  }

  private subscribeForPins(relays: string[], since: number) {
    if (this.isOffline()) return;

    console.warn("subscribeForPins", since, relays);

    const filter = this.getPinListFilter();
    filter.since = since;

    const sub = this.ndk.subscribe(
      filter,
      { groupable: false },
      NDKRelaySet.fromRelayUrls(relays, this.ndk),
      false // auto-start
    );
    this.subs.push(sub);

    sub.on("event", async (event) => {
      console.log("new pins list", event);
      await this.storeEvents([event]);
      await this.parsePins([event]);
    });

    sub.start();
  }

  private async fetchByFilter(
    relays: string[],
    since?: number,
    until?: number,
    subscribe?: boolean
  ) {
    if (this.isOffline()) return until;

    const filters = this.createTagFilters({ since, until });
    const submitFilters = this.createSubmitFilters({ since, until });
    filters.push(...submitFilters);
    if (!filters.length) {
      console.warn("Empty filters at fetchByFilter");
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
