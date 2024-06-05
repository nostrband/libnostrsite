import { NDKEvent } from "@nostr-dev-kit/ndk";
import Dexie from "dexie";

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

export interface DbSchema extends Dexie {
  events: Dexie.Table<DbEvent, string>;
  sync: Dexie.Table<DbSync, string>;
}

const db = new Dexie("cache_npub_pro") as DbSchema;

db.version(2).stores({
  events: "id,pubkey,kind,created_at,d_tag",
  sync: "site_id",
});

export const dbi = {
  addEvents: async (events: NDKEvent[]) => {
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
      console.log(`db listEvents error: ${error}`);
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
