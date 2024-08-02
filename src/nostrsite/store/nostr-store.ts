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
  KIND_PACKAGE,
  KIND_PROFILE,
  KIND_SITE,
  OUTBOX_RELAYS,
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
import {
  PromiseQueue,
  RenderMode,
  fetchEvent,
  fetchEvents,
  fetchRelays,
  profileId,
  tags,
} from "..";

const MAX_OBJECTS = 10000;

export class NostrStore extends RamStore {
  private mode: RenderMode;
  private ndk: NDK;
  private settings: Site;
  private parser: NostrParser;
  private filters: NDKFilter[];
  private maxObjects: number = MAX_OBJECTS;
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
      if (e.tags.find((t) => t.length >= 2 && t[0] === "e")) {
        console.log("skip reply event", e.id);
        return false;
      }
    }

    // @ts-ignore
    return !!this.filters.find((f) => matchFilter(f, e));
  }

  private async loadFromDb(limit: number) {
    const events = await dbi.listEvents(limit);

    // @ts-ignore
    const badObjectIds: string[] = events
      .filter(
        (e) =>
          e.kind !== KIND_SITE &&
          e.kind !== KIND_PACKAGE &&
          e.kind !== KIND_PROFILE &&
          !this.matchObject(e)
      )
      .map((e) => e.id);
    // console.log("badObjectIds", badObjectIds);
    await dbi.deleteEvents(badObjectIds);

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

    // fetch relays for contributors
    const { write, read } = await fetchRelays(
      this.ndk,
      this.settings.contributor_pubkeys
    );

    this.settings.contributor_relays = write;
    this.settings.contributor_inbox_relays = read;

    // limit number of relays if we care about latency
    if (this.mode === "iife" || this.mode === "preview")
      this.settings.contributor_relays.length = Math.min(
        this.settings.contributor_relays.length,
        5
      );

    console.log("contributor outbox relays", this.settings.contributor_relays);
  }

  private async fetchObjects(since?: number, until?: number, sub?: boolean) {
    console.warn(Date.now(), "fetch objects", since, until, sub);

    // ensure relays are known
    await this.fetchRelays();

    const promises: Promise<number | undefined>[] = [];

    if (this.settings.include_all || !!this.settings.include_tags?.length) {
      promises.push(this.fetchByFilter(since, until, sub));
    } else {
      console.warn("No include tags specified!");
    }

    // if (this.settings.include_manual) {
    //   promises.push(this.fetchManual(since, until, sub));
    // }

    const results = await Promise.all(promises);
    const newUntil = results.reduce(
      (pv, cv) => (!cv ? pv : pv ? Math.min(cv, pv) : cv),
      until
    );

    console.warn(
      Date.now(),
      "fetched objects",
      since,
      until,
      "=>",
      newUntil,
      sub
    );

    return newUntil;
  }

  private async loadIife() {
    // a fast method to get some usable set of events

    // load some posts from db and
    // fetch since latest in db until now
    const since = await this.loadFromDb(100);
    await this.fetchAllObjects(this.maxObjects, since);
  }

  private async loadPreview() {
    // fetch the latest stuff from relays
    await this.fetchAllObjects(this.maxObjects);
  }

  private async fetchAllObjects(max: number = 0, since: number = 0) {
    console.log(Date.now(), "start sync, max", max);
    let until = 0;
    do {
      // const was_count = this.posts.length;
      const newUntil = await this.fetchObjects(since, until);

      // if (this.posts.length === was_count) {
      //   console.log("stop sync, end");
      //   break;
      // }

      // const newUntil = this.posts
      //   .map((p) => p.event.created_at)
      //   .reduce((last, current) => Math.min(last, current), until);
      console.log("newUntil", newUntil);
      if (!newUntil) {
        console.log("stop sync, end");
        break;
      }
      if (newUntil === until) {
        console.log("stop sync, same cursor", newUntil);
        break;
      }
      until = newUntil!;
    } while (this.posts.length < max);

    console.log(Date.now(), "done sync, posts", this.posts.length);
  }

  private async loadSw() {
    const since = await this.loadFromDb(this.maxObjects);
    const now = Math.floor(Date.now() / 1000);

    const sync = await dbi.getSync();
    const synced = sync && sync.site_id === this.settings.event.id;

    // sync from since
    await this.fetchAllObjects(this.maxObjects, synced ? since : 0);

    // mark as synced
    if (!synced) await dbi.setSync(this.settings.event.id!);

    // sync forward from 'since'
    await this.fetchObjects(now, 0, true);
  }

  private async loadSsr() {
    await this.fetchAllObjects(this.maxObjects);
  }

  private async loadTab() {
    // load everything from db
    await this.loadFromDb(this.maxObjects);
    // first page load? fetch some from network
    if (!this.posts.length) await this.fetchAllObjects(100);
  }

  public async load(maxObjects: number = 0) {
    if (maxObjects) this.maxObjects = maxObjects;

    // FIXME for testing
    this.recommendations = recommendations;

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

    await this.fetchContributors();

    await this.assignAuthors();

    await this.postProcess();

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

    this.posts.forEach((post) => {
      post.url = getUrl!(post);
    });
    this.tags.forEach((tag) => {
      tag.url = getUrl!(tag);
    });
    this.authors.forEach((author) => {
      author.url = getUrl!(author);
    });
  }

  private async storeEvents(events: NDKEvent[]) {
    // no caching for ssr for now
    if (this.mode === "ssr" || this.mode === "preview") return;

    const promise = dbi.addEvents(events);

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

  private async fetchNostrLinks(events: NDKEvent[]) {
    console.log("fetchNostrLinks", events.length, events);
    const pubkeys: string[] = [];
    const relays: string[] = [];
    // const preAddrs: nip19.AddressPointer[] = [];
    // const reAddrs: nip19.AddressPointer[] = [];
    // const ids: string[] = [];

    // parse event tags
    for (const e of events) {
      pubkeys.push(e.pubkey);
      for (const p of tags(e, "p")) {
        if (p[1].length !== 64) continue;
        pubkeys.push(p[1]);
        if (p.length > 2 && p[2].startsWith("wss://")) relays.push(p[2]);
      }
      // for (const t of tags(e, "e")) {
      //   if (t[1].length !== 64) continue;
      //   ids.push(t[1]);
      //   if (t.length > 2 && t[2].startsWith("wss://")) relays.push(t[2]);
      // }
      // for (const a of tags(e, "a")) {
      //   const fs = a[1].split(":");
      //   if (fs.length !== 3 || fs[1].length !== 64) continue;
      //   try {
      //     (fs[2] ? preAddrs : reAddrs).push({
      //       kind: parseInt(fs[0]),
      //       pubkey: fs[1],
      //       identifier: fs[2],
      //     });
      //   } catch {
      //     continue;
      //   }
      //   if (a.length > 2 && a[2].startsWith("wss://")) relays.push(a[2]);
      // }
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
    console.log("nostr links", events, links);

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
          // case "naddr":
          //   (data.identifier ? preAddrs : reAddrs).push(data);
          //   relays.push(...(data.relays || []));
          //   break;
          // case "nevent":
          //   ids.push(data.id);
          //   relays.push(...(data.relays || []));
          //   break;
          // case "note":
          //   ids.push(data);
          //   break;
        }
      } catch {}
    });

    // console.log("linked", { pubkeys, ids, preAddrs, reAddrs, relays });
    console.log("linked", { pubkeys, relays });

    // linked profiles
    if (pubkeys.length) await this.fetchProfiles(pubkeys, relays);

    // // linked events
    // const filters = [];
    // if (ids.length) filters.push({ ids });
    // if (preAddrs.length)
    //   filters.push({
    //     authors: preAddrs.map((a) => a.pubkey),
    //     kinds: preAddrs.map((a) => a.kind),
    //     "#d": preAddrs.map((a) => a.identifier),
    //   });
    // if (reAddrs.length)
    //   filters.push({
    //     authors: preAddrs.map((a) => a.pubkey),
    //     kinds: preAddrs.map((a) => a.kind),
    //   });

    // if (filters.length) {
    //   relays.push(
    //     ...this.settings.contributor_relays,
    //     ...this.settings.contributor_inbox_relays
    //   );
    //   const linkedEvents = await fetchEvents(this.ndk, filters, relays, 3000);
    //   console.log("linked events", { filters, linkedEvents });

    //   // fetch authors
    //   await this.fetchNostrLinks([...linkedEvents], true);

    //   for (const e of linkedEvents) {
    //     const post = await this.parser.parseEvent(e, this);
    //     if (!post) continue;

    //     const existing = this.related.find((p) => p.id === post!.id);
    //     if (existing && existing.event.created_at > post.event.created_at)
    //       continue;

    //     if (existing)
    //       this.related.splice(
    //         this.related.findIndex((r) => r === existing),
    //         1
    //       );

    //     console.log("related", post);
    //     this.related.push(post);
    //   }
    // }
  }

  private async parseEvents(events: NDKEvent[]) {
    // pre-parse and fetch all linked events
    await this.fetchNostrLinks(events);

    // now when linked events are cached we can
    // parse events and use linked events to
    // format content
    for (const e of events) {
      const post = await this.parser.parseEvent(e, this);
      if (!post) continue;

      // replaceable events
      const existing = this.posts.find((p) => p.id === post!.id);
      if (existing && existing.event.created_at > post.event.created_at)
        continue;

      // drop existing post, we're replacing it with a new version
      if (existing) this.removePost(existing);

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

    await this.prepare();
  }

  private useCache() {
    return this.mode !== "ssr" && this.mode !== "preview";
  }

  private async fetchProfiles(pubkeys: string[], relayHints: string[] = []) {
    // only fetch new ones
    pubkeys = pubkeys.filter(
      (pubkey) => !this.profiles.find((p) => p.pubkey === pubkey)
    );

    const cachedEvents = this.useCache()
      ? await dbi.listKindEvents(KIND_PROFILE, 100)
      : [];
    const profiles = cachedEvents
      .filter((e) => pubkeys.includes(e.pubkey))
      .map((e) => new NDKEvent(this.ndk, e));
    console.log("cached profiles", profiles);

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
          authors: pubkeys,
        },
        relays,
        1000 // timeoutMs
      );
      console.log("fetched profiles", { events, relays });
      if (events) profiles.push(...events);
      // NOTE: links in bio are non-standard, and it's
      // an infinite loop here (fetching profiles that link
      // to each other won't finish), we should implement
      // a cache for these linked events before we try this
      // await this.fetchNostrLinks([...events]);
    }

    await this.storeEvents([...profiles]);

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
      let f: NDKFilter | undefined = filters.find(f => {
        if (!tag) return !Object.keys(f).find(k => k.startsWith("#"))
        else return tagKey in f;
      });

      if (!f) {
        // first filter for this tag
        f = {
          authors: this.settings.contributor_pubkeys,
          kinds: [kind],
          limit,
        }
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
        if (!f.kinds!.includes(kind))
          f.kinds!.push(kind);
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

  private async fetchByFilter(
    since?: number,
    until?: number,
    subscribe?: boolean
  ) {
    const filters = this.createTagFilters(since, until);
    if (!filters.length) {
      console.warn("Empty filters for 'include' tags");
      return until;
    }

    if (this.isOffline()) return until;

    const relays = [
      ...(this.settings.contributor_relays || this.settings.admin_relays),
    ].filter((r) => !BLACKLISTED_RELAYS.includes(r));
    console.warn("fetchByFilter", since, until, subscribe, relays, filters);

    const sub = this.ndk.subscribe(
      filters,
      { groupable: false },
      NDKRelaySet.fromRelayUrls(relays, this.ndk),
      false // auto-start
    );
    this.subs.push(sub);

    let eose = false;
    const events: NDKEvent[] = [];

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
        console.warn("fetchByFilter timeout");
        onEose();
      }, timeoutMs);

      const onEose = async () => {
        if (timeout) clearTimeout(timeout);
        if (eose) return; // timeout
        eose = true;
        if (!subscribe) sub.stop();

        console.log("events", { events, filters, relays });
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

            // ensure we load profiles
            await this.assignAuthors();

            //
            await this.postProcess();
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

  public getProfile(pubkey: string): Profile | undefined {
    return this.profiles.find((p) => p.pubkey === pubkey);
  }
}
