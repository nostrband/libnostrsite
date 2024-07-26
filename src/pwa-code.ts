import { RenderOptions } from ".";

export function getPwaCode(options: RenderOptions) {
  console.log("getPwaCode options", options);
  const style = `
  <style>
  #pwa-toast {
    visibility: hidden;
    position: fixed;
    right: 0;
    bottom: 0;
    margin: 16px;
    padding: 12px;
    border: 1px solid #8885;
    border-radius: 4px;
    z-index: 1;
    text-align: left;
    box-shadow: 3px 4px 5px 0 #8885;
    display: grid;
    background-color: #fff;
  }
  #pwa-toast .message {
    margin-bottom: 8px;
  }
  #pwa-toast .buttons {
    display: flex;
  }
  #pwa-toast button {
    border: 1px solid #8885;
    outline: none;
    margin-right: 5px;
    border-radius: 2px;
    padding: 3px 10px;
  }
  #pwa-toast.show {
    visibility: visible;
  }
  button#pwa-refresh {
    display: none;
  }
  #pwa-toast.show.refresh button#pwa-refresh {
    display: block;
  }  
</style>
`;

  const { mode = "iife" } = options;
  const { ssrIndexScriptUrl = "/index.js" } = options;

  switch (mode) {
    // iife mode has all the code loaded already by the bootstrap html page,
    // all we need is to launch the pwa and tab after the page is rendered
    case "iife":
      return `
      <script>
        window.nostrSite.startTab();
        window.nostrSite.startPwa();
      </script>
      ${style}
    `;

    // preview doesn't need tab for now, a) it won't work bcs tab 
    // read from cache which is empty w/ preview, and b) it's not
    // really needed to have client-side plugins work in previews
    // FIXME actually those could work, leave it for later
    case "preview":
      return `
      ${style}
    `;

    // sw loads index.js in sync mode so that it's started before the `load`
    // event is fired, and launches tab when it's loaded,
    // no need to launch pwa as we've presumably been rendered by it.
    case "sw":
      return `
      <script type="text/javascript" 
        src="${ssrIndexScriptUrl}" 
        onload="window.nostrSite.startTab();"
      ></script>
      ${style}
    `;

    // ssr loads an async engine script that will launch PWA and tab 
    // as soon as it loads without blocking the pre-rendered html processing
    case "ssr":
      return `
      <script async type="text/javascript" 
        src="${ssrIndexScriptUrl}" 
        onload="window.nostrSite.startTab(); window.nostrSite.startPwa();"
      ></script>
      ${style}
    `;

    default:
      return "";
  }
}
