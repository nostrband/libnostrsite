// # Ghost Foot Helper
// Usage: `{{ghost_foot}}`
//
// Outputs scripts and other assets at the bottom of a Ghost theme
import { getRenderer } from "../services/renderer";
import { getPwaCode } from "../../../pwa-code";
import { CSS_VENOBOX, JS_SEARCH, JS_VENOBOX, JS_ZAP } from "../../..";

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
  </script>
  `);

    foot.push(`<script src="${JS_ZAP}"></script>`);

    foot.push(`
    <script async src="${JS_SEARCH}"></script>
    <script>
      document.addEventListener("np-search-goto", (e) => {
        console.log("np-search-goto", e);
        window.location.href = e.detail;
      });
    </script>`);
  }

  foot.push(getPwaCode(renderOptions));

  // no need for spinner for server-side rendered pages
  if (renderOptions.mode !== "ssr" && renderOptions.mode !== "sw") {
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
