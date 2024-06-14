import { RenderOptions } from ".";

export function getPwaCode(options: RenderOptions) {
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
    // iife mode has all the code loaded already by the bootstrap html oage,
    // all we need is to launch the service worker after the page is rendered
    case "iife":
      return `
      <script>
        window.nostrSite.startPwa();
      </script>
      ${style}
    `;

    // sw & preview don't need to launch anything, all code is already loaded and started
    case "preview":
    case "sw":
      return `
      ${style}
    `;

    // ssr loads an async engine script that will launch PWA as soon as it loads
    // without blocking the pre-rendered html processing
    // FIXME make /index.js an .env variable
    case "ssr":
      return `
      <script async type="text/javascript" src="${ssrIndexScriptUrl}" onload="window.nostrSite.startPwa();"></script>
      ${style}
    `;

    default:
      return "";
  }
}
