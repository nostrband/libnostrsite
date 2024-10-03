import { Site } from "../types/site";
import { Route, Router } from "../types/router";

export class DefaultRouter implements Router {
  private settings: Site;

  constructor(settings: Site) {
    this.settings = settings;
  }

  route(path: string): Route {
    path = decodeURI(path.split("?")[0]);

    // canonical form has trailing slash
    if (!path.endsWith("/")) path += "/";

    const match = (prefix: string) => {
      if (prefix.startsWith("/")) prefix = prefix.substring(1);

      prefix = (this.settings!.url || "") + prefix;
      console.log("match?", { path, prefix });
      if (prefix.endsWith("*")) {
        return path.startsWith(prefix.substring(0, prefix.length - 1));
      } else {
        return path === prefix;
      }
    };

    const param = (prefix: string) => {
      return path.split(`/${prefix}/`)[1].split("/")[0];
    };
    const isRss = path.endsWith("/rss/");

    const route: Route = {
      path,
      // ensure trailing slash
      pathBase: path.includes("/page/") ? path.split("page/")[0] : path,
      pathHtml: path,
      context: [],
    };
    // home feed: index+home for page 1, index+paged for others
    if (match("/") || match("/rss/")) {
      route.context = ["index", "home"];
    } else if (match("/page/*")) {
      route.context = ["index", "paged"];
      route.param = param("page");
    } else if (match("/notes/*")) {
      // /notes/ or /notes/page/:X
      // - kind+index(to reuse index template)+kind:X - page 1
      // - +paged for other pages
      route.context = ["kind", "kind:1", "index"];
      if (match("/notes/page/*")) {
        route.context.push("paged");
        route.param = param("notes/page");
      }
      // same as /notes/ above
    } else if (match("/posts/*")) {
      route.context = ["kind", "kind:30023", "index"];
      if (match("/posts/page/*")) {
        route.context.push("paged");
        route.param = param("posts/page");
      }
    } else if (match("/post/*")) {
      route.context = ["post"];
      route.param = param("post");
      // tag for page 1, tag+paged for others
    } else if (match("/tag/*")) {
      route.context = ["tag"];
      route.param = param("tag");
      if (match(`/tag/${route.param}/page/*`)) {
        route.context.push("paged");
        route.param2 = param(`tag/${route.param}/page`);
      }
      // ensure it's case-insensitive
      route.param = route.param!.toLowerCase();
    } else if (match("/author/*")) {
      // author for page 1, author+paged for others
      route.context = ["author"];
      route.param = param("author");
      if (match(`/author/${route.param}/page/*`)) {
        route.context.push("paged");
        route.param2 = param(`author/${route.param}/page`);
      }
    } else {
      // FIXME find a static page matching the path
      console.log("bad path");
      route.context = ["error"];
    }

    // rss only on homepage, tag or author
    route.hasRss =
      !route.context.includes("paged") &&
      (route.context.includes("home") ||
        route.context.includes("tag") ||
        route.context.includes("author"));

    if (isRss && route.hasRss) {
      route.context.push("rss");
      route.pathHtml = route.path.split("rss/")[0]; // ensure trailing slash
    }

    if (
      !route.context.includes("home") &&
      !route.context.includes("kind") &&
      !route.context.includes("error") &&
      !route.param
    ) {
      console.log("No param for contexts", route.context);
      route.context = ["error"];
    }

    return route;
  }
}
