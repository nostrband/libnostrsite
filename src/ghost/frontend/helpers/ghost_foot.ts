// # Ghost Foot Helper
// Usage: `{{ghost_foot}}`
//
// Outputs scripts and other assets at the bottom of a Ghost theme
import { getRenderer } from "../services/renderer";
import { getPwaCode } from "../../../pwa-code";
import {
  CSS_VENOBOX,
  JS_CONTENT_CTA,
  JS_EMBEDS,
  JS_MAPTALKS,
  JS_NOSTR_LOGIN,
  JS_SEARCH,
  JS_VENOBOX,
  JS_ZAP,
  JS_ZAPTHREADS,
} from "../../..";

// We use the name ghost_foot to match the helper for consistency:
export default function ghost_foot(options: any) {
  const { SafeString, renderOptions } = getRenderer(options);

  // eslint-disable-line camelcase
  const foot: string[] = [];
  const site = options.data.site;

  // const globalCodeinjection = settingsCache.get("codeinjection_foot");
  // const postCodeinjection =
  //   options.data.root && options.data.root.post
  //     ? options.data.root.post.codeinjection_foot
  //     : null;
  // const tagCodeinjection =
  //   options.data.root && options.data.root.tag
  //     ? options.data.root.tag.codeinjection_foot
  //     : null;

  // if (!_.isEmpty(globalCodeinjection)) {
  //   foot.push(globalCodeinjection);
  // }

  // if (!_.isEmpty(postCodeinjection)) {
  //   foot.push(postCodeinjection);
  // }

  // if (!_.isEmpty(tagCodeinjection)) {
  //   foot.push(tagCodeinjection);
  // }

  if (site.codeinjection_foot) {
    foot.push(site.codeinjection_foot);
  }

  // venobox galleries
  if (site.config.get("no_default_plugins") !== "true") {
    foot.push(`
  <link rel="stylesheet" href="${CSS_VENOBOX}" type="text/css" media="screen" />
  <script>
    (() => {
      const script = document.createElement('script');
      script.async = true;
      script.type = "text/javascript";
      script.src = "${JS_VENOBOX}";
      script.onload = () => {
        new VenoBox({ 
          selector: ".vbx-media", 
          spinColor: "${site.accent_color}",
          overlayColor: "${site.accent_color}",
        })
      };
      document.body.appendChild(script);  
    })()
  </script>
  `);

    foot.push(`
  <script type="text/javascript" async src="${JS_ZAPTHREADS}"></script>
`);

    foot.push(`
  <script type="text/javascript" async src="${JS_CONTENT_CTA}"></script>
`);

    const relays = [
      ...new Set([
        ...site.contributor_inbox_relays,
        ...site.contributor_relays,
      ]),
    ];
    if (relays.length > 10) relays.length = 10;
    console.log("nostr-login relays", relays, site);

    foot.push(`
  <script async src="${JS_NOSTR_LOGIN}"
    data-perms="sign_event:1,sign_event:9734"
    data-start-screen="local-signup"
    data-signup-relays="${relays}"
  ></script>
  <script>
    (async () => {
      if (!window.nostrSite)
        await new Promise((ok) => document.addEventListener('npLoad', ok));
      const ep = window.nostrSite.plugins.register("nostr-login");
      document.addEventListener("nlAuth", async (e) => {
        console.log("nlAuth", e);
        ep.dispatch("auth", { type: e.detail.type, pubkey: e.detail.pubkey });
  
        if (e.detail.type === 'login' || e.detail.type === 'signup') {
          window.__nlAuthed = true;
        } else {
          window.__nlAuthed = false;
        }

        const npub = window.nostrSite.nostrTools.nip19.npubEncode(await window.nostr.getPublicKey());
        const zapThreads = document.querySelector('zap-threads');
        if (zapThreads) {
          if (window.__nlAuthed)
            zapThreads.setAttribute("user", npub);
          else
            zapThreads.setAttribute("user", "");
        }
        const zapButton = document.querySelector('#zap-button');
        if (zapButton) {
          if (window.__nlAuthed)
            zapButton.setAttribute("data-anon", "");
          else
            zapButton.setAttribute("data-anon", "true");
        }
        const cta = document.querySelector('np-content-cta');
        if (cta) {
          if (window.__nlAuthed)
            cta.setAttribute("data-user-npub", npub);
          else
            cta.setAttribute("data-user-npub", "");
        }
      });  
    })();
  </script>
`);

    foot.push(`
  <script src="${JS_ZAP}"></script>
  <script>
    (async () => {
      if (!window.nostrSite)
        await new Promise((ok) => document.addEventListener('npLoad', ok));
      const ep = window.nostrSite.plugins.register("nostr-zap");
      console.log("nostr-zap ep", ep);
      ep.subscribe("action-zap", (amount) => {
        const button = document.querySelector("#zap-button");
        button.setAttribute("data-amount", amount || "");
        button.dispatchEvent(new Event("click"));
      });
      document.addEventListener("nostr-zap-published", (e) => {
        console.log("nostr-zap on zap published", e);
        ep.dispatch("event-published", e.detail);
      });
    })();
  </script>
    `);

    foot.push(`
  <script async src="${JS_SEARCH}"></script>
  <script>
    document.addEventListener("np-search-goto", (e) => {
      console.log("np-search-goto", e);
      window.location.href = e.detail;
    });
  </script>`);

    foot.push(`
  <script async src="${JS_EMBEDS}"></script>

    `);

    // FIXME turn into a separate plugin that will
    // load other posts and show them on the map
    foot.push(`
  <script type="text/javascript" src="${JS_MAPTALKS}"></script>
  <div id="map" style='width: 100%; height: 50%; min-height: 300px'></div>
  <script>
    const container = document.querySelector("np-map");
    console.log("map", container);
    if (container) {
      const coords = container.getAttribute("coords").split(',').map(c => Number(c));
      console.log("coords", coords);
      const div = document.createElement("div");
      div.style.width="100%";
      div.style.height="300px";
      container.append(div);
      const map = new maptalks.Map(div, {
        center: coords,
        zoom: 15,
        zoomControl : true, // add zoom control
        scaleControl : true, // add scale control
        baseLayer: new maptalks.TileLayer('base', {
//          urlTemplate: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          subdomains: ["a","b","c"], // "d"
          attribution: '&copy; <a href="http://osm.org">OpenStreetMap</a>'
        })
      });

      const point = new maptalks.Marker(
        coords,
        {
          visible : true,
          editable : false,
          cursor : 'pointer',
          draggable : false,
          // symbol : {
          //   'textFaceName' : 'sans-serif',
          //   'textName' : 'MapTalks',
          //   'textFill' : '#34495e',
          //   'textHorizontalAlignment' : 'right',
          //   'textSize' : 40
          // }
        }
      );
      point.on('click touchend', (e) => console.log(e));

      new maptalks.VectorLayer('vector', point).addTo(map);
    }
  </script>
    `);

    //   foot.push(`
    // <script src="https://vjs.zencdn.net/8.16.1/video.min.js"></script>
    //   `);
  }

  foot.push(getPwaCode(renderOptions));

  // no need for spinner for server-side rendered pages,
  // and for tab-mode for plugins
  if (
    renderOptions.mode !== "ssr" &&
    renderOptions.mode !== "sw" &&
    renderOptions.mode !== "tab"
  ) {
    foot.push(`
  <section id="__nostr_site_loading_modal">
    <div class="loader"></div>
  </section>
  <style>
    #__nostr_site_loading_modal {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 100%;
      background-color: #fff;
      z-index: 1000000;
      display: block;
    }

    #__nostr_site_loading_modal .loader {
      width: 48px;
      height: 48px;
      border: 5px solid #bbb;
      border-bottom-color: transparent;
      border-radius: 50%;
      display: inline-block;
      box-sizing: border-box;
      animation: rotation 1s linear infinite;
      position: absolute;
      top: 50%;
      left: 50%;
    }

    @keyframes rotation {
      0% {
        transform: rotate(0deg);
      }

      100% {
        transform: rotate(360deg);
      }
    }

  </style>
  <script>
    const modal = document.getElementById("__nostr_site_loading_modal");
    // give it some time to render
    setTimeout(() => modal.style.display = 'none', 100);
  </script>
`);
  }

  return new SafeString(foot.join(" ").trim());
}
