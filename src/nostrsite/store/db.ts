import { NDKEvent, NostrEvent } from "@nostr-dev-kit/ndk";
import Dexie from "dexie";

export interface DbSite {
  key: "site";
  site_id: string;
  created_at: number;
}

export interface DbEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
  sig: string;
  d_tag: string;
}

export interface DbSync {
  site_id: string;
  syncTimestamp: number;
}

export interface DbCacheEntry {
  id: string;
  data: string;
}

export interface DbSchema extends Dexie {
  site: Dexie.Table<DbSite, string>;
  events: Dexie.Table<DbEvent, string>;
  cache: Dexie.Table<DbCacheEntry, string>;
  sync: Dexie.Table<DbSync, string>;
}

const db = new Dexie("cache_npub_pro") as DbSchema;

db.version(4).stores({
  site: "key,site_id,created_at",
  events: "id,pubkey,kind,created_at,d_tag",
  sync: "site_id",
  cache: "id",
});

export const dbi = {
  setSite: async (site_id: string, created_at: number) => {
    try {
      await db.site.put({
        key: "site",
        site_id,
        created_at,
      });
    } catch (error) {
      console.log(`db setSite error: ${error}`);
    }
  },
  getSite: async () => {
    try {
      const site = await db.site.toArray();
      if (site.length > 0) return site[0];
    } catch (error) {
      console.log(`db getSite error: ${error}`);
    }
  },
  putCache: async (id: string, data: string) => {
    try {
      await db.cache.put({
        id,
        data,
      });
    } catch (error) {
      console.log(`db putCache error: ${error}`);
    }
  },
  getCache: async (id: string) => {
    try {
      const entry = await db.cache.get(id);
      if (entry) return entry.data;
    } catch (error) {
      console.log(`db getCache error: ${error}`);
    }
  },
  addEvents: async (events: NDKEvent[] | NostrEvent[]) => {
    try {
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

      await db.events.bulkPut(dbEvents);
    } catch (error) {
      console.log(`db addEvents error: ${error}`);
    }
  },
  listEvents: async (limit: number) => {
    try {
      return (await db.events.reverse().sortBy("created_at")).slice(0, limit);
    } catch (error) {
      console.log(`db listEvents error: ${error}`);
      return [];
    }
  },
  listKindEvents: async (kind: number, limit: number) => {
    try {
      return (
        await db.events.where({ kind }).reverse().sortBy("created_at")
      ).slice(0, limit);
    } catch (error) {
      console.log(`db listKindEvents error: ${error}`);
      return [];
    }
  },
  deleteEvents: async (ids: string[]) => {
    try {
      return await db.events.bulkDelete(ids);
    } catch (error) {
      console.log(`db deleteEvents error: ${error}`);
      return [];
    }
  },
  getSync: async () => {
    try {
      const sync = await db.sync.toArray();
      if (sync.length > 0) return sync[0];
    } catch (error) {
      console.log(`db getSync error: ${error}`);
    }
  },
  setSync: async (site_id: string) => {
    try {
      await db.sync.put({
        site_id,
        syncTimestamp: Date.now(),
      });
    } catch (error) {
      console.log(`db setSync error: ${error}`);
    }
  },
};
