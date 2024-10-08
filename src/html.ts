// https://stackoverflow.com/a/69190644
// with my special sause for async and defer
async function executeScriptElements(doc: Document) {
  const scriptElements = doc.querySelectorAll("script");

  let deferScripts: {
    scriptElement: HTMLElement;
    clonedElement: HTMLElement;
    src: string;
  }[] = [];

  for (const scriptElement of Array.from(scriptElements)) {
    if (scriptElement.text.toLowerCase().includes("document.write")) {
      console.warn("Skip deprecated document.write scripts");
      continue;
    }

    const clonedElement = doc.createElement("script");

    let async = false;
    let defer = false;
    let type = "";
    let src = "";
    for (const attribute of Array.from(scriptElement.attributes)) {
      if (
        attribute.name === "async" &&
        (!attribute.value || attribute.value === "true")
      )
        async = true;
      if (
        attribute.name === "defer" &&
        (!attribute.value || attribute.value === "true")
      )
        defer = true;
      if (attribute.name === "type") type = attribute.value;
      if (attribute.name === "src") src = attribute.value;
      clonedElement.setAttribute(attribute.name, attribute.value);
    }
    console.log(Date.now(), "script", {
      async,
      defer,
      type,
      src,
    });

    clonedElement.text = scriptElement.text;

    // script elements created dynamically are async by default
    // https://stackoverflow.com/questions/7308908/waiting-for-dynamically-loaded-script#comment57537041_7308984
    clonedElement.async = async;

    // module scripts are always deferred
    if (defer || type === "module") {
      deferScripts.push({ scriptElement, clonedElement, src });
    } else {
      // inline script execute immediately,
      // async can execute at any time, no need to wait
      let promise = undefined;
      if (src && !async)
        promise = new Promise((ok) => {
          clonedElement.addEventListener("load", ok);
          clonedElement.addEventListener("error", ok);
        });

      scriptElement.parentNode!.replaceChild(clonedElement, scriptElement);
      if (promise) await promise;

      console.log(Date.now(), "loaded", src);
    }
  }

  // run deferred scripts after all others have been processed to
  // simulate the browser's behavior
  for (const { scriptElement, clonedElement, src } of deferScripts) {
    scriptElement.parentNode!.replaceChild(clonedElement, scriptElement);
    await new Promise((ok) => clonedElement.addEventListener("load", ok));
    console.log(Date.now(), "defer loaded", src);
  }
}

async function waitStyles(doc: Document) {
  const links = doc.getElementsByTagName("link");

  const promises: Promise<void>[] = [];
  for (const link of Array.from(links)) {
    const rel = link.getAttribute("rel");
    if (rel !== "stylesheet") continue;
    const src = link.getAttribute("href");
    console.log(Date.now(), "style", src);
    if (src)
      promises.push(
        new Promise<void>((ok) => {
          link.onload = () => {
            console.log(Date.now(), "loaded", src);
            ok();
          };
        })
      );
  }
  return Promise.all(promises);
}

export async function setHtml(html: string, doc?: Document, win?: Window) {
  // maybe iframe, not root doc
  doc = doc || document;
  win = win || window;

  // we need to open it to imitate creating the document from scratch,
  // so that calls to 'document.write' inlined into the html won't
  // result in implicit 'doc.open' and the reset of the page
  doc.open();

  // NOTE: document.write is sync method that produces lots of warning due
  // to browser fetching sync scripts within the 'write', browser
  // may also block those scripts, and this also causes document
  // readyState to always be 'loading', and it's also deprecated...
  // doc.write(html);
  // instead, we use innerHTML to set the html and then execute
  // scripts manually

  // create documentElement, which is cleared by doc.open
  doc.write("<html></html>");

  // so we're using innerHTML to replace the whole document,
  // but doesn't run the <script>,
  // see: https://developer.mozilla.org/en-US/docs/Web/API/HTMLScriptElement
  // "Note: When inserted using the Document.write() method, <script>
  // elements execute (typically synchronously), but when inserted using
  // Element.innerHTML or Element.outerHTML, they do not execute at all."
  console.log(Date.now(), "html set", html.length);
  doc.documentElement.innerHTML = html;

  // done
  doc.close();

  // wait for styles and scripts
  await Promise.all([waitStyles(doc), executeScriptElements(doc)]);

  console.log(Date.now(), "html done");

  // make it seem like the document has loaded
  // to trigger those scripts expecting it
  if (doc.readyState === "complete") {
    // first 'readystatechange', next DOMContentLoaded, then 'load'
    // dispatching is sync, so these will be processed one by one
    doc.dispatchEvent(new Event("readystatechange"));
    doc.dispatchEvent(new Event("DOMContentLoaded"));

    // FIXME: it must be dispatched after all scripts/styles/images
    // are loaded, we must simulate that by parsing our new DOM and
    // figuring when all the resources have loaded
    // NOTE: the incompatibility is that in the browser the load
    // event is dispatched on window but it's target is 'document',
    // hopefully we don't have issues with that.
    // More: https://developer.mozilla.org/en-US/docs/Web/API/Window/load_event
    win.dispatchEvent(new Event("load"));
  }
}
