"use strict";
// # Authors Helper
// Usage: `{{authors}}`, `{{authors separator=' - '}}`
//
// Returns a string of the authors on the post.
// By default, authors are separated by commas.
//
// Note that the standard {{#each authors}} implementation is unaffected by this helper.
import isString from "lodash-es/isString";
// @ts-ignore
import { getRenderer } from "../services/renderer";
import { templates } from "../services/theme-engine/handlebars/template";
// @ts-ignore
import { filter } from "../../helpers/visibility"

export default function authors(options: any = {}) {
  options.hash = options.hash || {};

  const { urlService, SafeString, escapeExpression } =
    getRenderer(options);

  let {
    autolink,
    separator = ", ",
    prefix = "",
    suffix = "",
    limit,
    visibility,
    from = 1,
    to,
  } = options.hash;
  let output = "";

  autolink = !(isString(autolink) && autolink === "false");
  limit = limit ? parseInt(limit, 10) : limit;
  from = from ? parseInt(from, 10) : from;
  to = to ? parseInt(to, 10) : to;

  function createAuthorsList(authorsList: any): string[] {
    function processAuthor(author: any) {
      return autolink
        ? templates.link({
            url: urlService.getUrlByResourceId(author.id, {
              withSubdirectory: true,
            }),
            text: escapeExpression(author.name),
          })
        : escapeExpression(author.name);
    }

    return filter(authorsList, visibility, processAuthor);
  }

  // @ts-ignore
  const self: any = this;
  console.log("authors", self.authors);

  if (self.authors && self.authors.length) {
    const list = createAuthorsList(self.authors);
    from -= 1; // From uses 1-indexed, but array uses 0-indexed.
    to = to || limit + from || list.length;
    output = list.slice(from, to).join(separator);
  }

  if (output) {
    output = prefix + output + suffix;
  }

  return new SafeString(output);
}
