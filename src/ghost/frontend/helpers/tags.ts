// # Tags Helper
// Usage: `{{tags}}`, `{{tags separator=' - '}}`
//
// Returns a string of the tags on the post.
// By default, tags are separated by commas.
//
// Note that the standard {{#each tags}} implementation is unaffected by this helper

import { getRenderer } from "../services/renderer";
import { templates } from "../services/theme-engine/handlebars/template";
// @ts-ignore
import { filter } from "../../helpers/visibility";
import isString from "lodash/isString";

export default function tags(options: any) {
  options = options || {};
  options.hash = options.hash || {};

  // @ts-ignore
  const self: any = this;

  const { SafeString, escapeExpression, urlService } = getRenderer(options);

  const autolink = !(
    isString(options.hash.autolink) && options.hash.autolink === "false"
  );
  const separator = isString(options.hash.separator)
    ? options.hash.separator
    : ", ";
  const prefix = isString(options.hash.prefix) ? options.hash.prefix : "";
  const suffix = isString(options.hash.suffix) ? options.hash.suffix : "";
  const limit = options.hash.limit
    ? parseInt(options.hash.limit, 10)
    : 10;
  let from = options.hash.from ? parseInt(options.hash.from, 10) : 1;
  let to = options.hash.to ? parseInt(options.hash.to, 10) : undefined;

  function createTagList(tagsList: any): string[] {
    function processTag(tag: any) {
      return autolink
        ? templates.link({
            url: urlService.getUrlByResourceId(tag.id, {
              withSubdirectory: true,
            }),
            text: escapeExpression(tag.name),
          })
        : escapeExpression(tag.name);
    }

    return filter(tagsList, options.hash.visibility, processTag);
  }

  let output = "";
  if (self.tags && self.tags.length) {
    const results: string[] = createTagList(self.tags);
    from -= 1; // From uses 1-indexed, but array uses 0-indexed.
    to = to || limit + from || results.length;
    output = results.slice(from, to).join(separator);
  }

  if (output) {
    output = prefix + output + suffix;
  }

  return new SafeString(output);
}
