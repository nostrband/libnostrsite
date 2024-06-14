// @ts-ignore
import { stripInvisibleChars } from "./strip-invisible-chars";
import slugifyExt from "slugify";

/**
 * Slugify
 *
 * Prepares a string for use in a url.
 *
 * @param {String} str - the string we want to slugify
 * @param {object} options - filter options
 * @param {bool} [options.requiredChangesOnly] - don't perform optional cleanup, e.g. removing extra dashes
 * @returns {String} slugified string
 */
export function slugify(str: string, options: any = {}) {
  // Ensure we have a string
  str = str || "";

  // Strip all characters that cannot be printed
  str = stripInvisibleChars(str);

  // Handle the £ symbol separately, since it needs to be removed before the unicode conversion.
  str = str.replace(/£/g, "-");

  // Remove non ascii characters
  str = slugifyExt(str);

  // Replace URL reserved chars: `@:/?#[]!$&()*+,;=` as well as `\%<>|^~£"{}` and \`
  str = str
    .replace(
      /(\s|\.|@|:|\/|\?|#|\[|\]|!|\$|&|\(|\)|\*|\+|,|;|=|\\|%|<|>|\||\^|~|"|\{|\}|`|–|—)/g,
      "-"
    )
    // Remove apostrophes
    .replace(/'/g, "")
    // Make the whole thing lowercase
    .toLowerCase();

  // These changes are optional changes, we can enable/disable these
  if (!options.requiredChangesOnly) {
    // Convert 2 or more dashes into a single dash
    str = str
      .replace(/-+/g, "-")
      // Remove trailing dash
      .replace(/-$/, "")
      // Remove any dashes at the beginning
      .replace(/^-/, "");
  }

  // Handle whitespace at the beginning or end.
  str = str.trim();

  return str;
}
