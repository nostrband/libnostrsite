import { setHtml } from "./html";
import { nip19 } from "nostr-tools";
import { KIND_SITE } from "./nostrsite/consts";
import { NostrSiteRenderer } from "./nostrsite/nostr-site-renderer";
import { SiteAddr } from "./nostrsite/types/site-addr";
import NDK from "@nostr-dev-kit/ndk";

export async function getMetaAddr(): Promise<SiteAddr | undefined> {
  // <link rel="manifest" href="manifest.json" />
  const metas = document.getElementsByTagName("meta");
  for (const meta of metas) {
    if (meta.getAttribute("property") !== "nostr:site") continue;

    const content = meta.getAttribute("content");
    if (!content || !content.startsWith("naddr1")) {
      console.log("Bad meta nostr:site value: ", content);
      continue;
    }

    const { type, data } = nip19.decode(content);
    if (type !== "naddr" || data.kind !== KIND_SITE || !data.pubkey.trim()) {
      console.log("Bad meta nostr:site addr: ", type, data);
      continue;
    }

    return {
      name: data.identifier,
      pubkey: data.pubkey,
      relays: data.relays,
    };
  }

  return undefined;
}

export async function renderCurrentPage() {
  // read-only thing, but SW should re-fetch
  // it and update HBS object if something changes
  const addr = await getMetaAddr();
  console.log("addr", addr);
  if (!addr) throw new Error("No nostr site addr");

  const start = Date.now();
  const renderer = new NostrSiteRenderer(addr);
  await renderer.start({});
  const t1 = Date.now();
  console.log("renderer created in ", t1 - start);

  // render using hbs and replace document.html
  const { result } = await renderer.render(document.location.pathname);
  //  console.log("result html size", result.length, setHtml);
  const t2 = Date.now();
  console.log(
    "renderer rendered ",
    document.location.pathname,
    " in ",
    t2 - t1
  );
  await setHtml(result);
  const t3 = Date.now();
  console.log("renderer setHtml in ", t3 - t2);
}

export async function fetchNostrSite(addr: SiteAddr) {
  const ndk = new NDK({
    // FIXME also add some seed relays?
    explicitRelayUrls: addr.relays,
  });

  await ndk.connect();

  const event = await ndk.fetchEvent(
    {
      // @ts-ignore
      kinds: [KIND_SITE],
      authors: [addr.pubkey],
      "#d": [addr.name],
    },
    { groupable: false }
  );

  // we no longer need it
  for (const r of ndk.pool.relays.values()) {
    r.disconnect();
  }

  return event ? event.rawEvent() : undefined;
}
