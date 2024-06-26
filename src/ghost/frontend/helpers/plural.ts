// # Plural Helper
// Usage example: `{{plural ../pagination.total empty='No posts' singular='1 post' plural='% posts'}}`
// or for translatable themes, with (t) translation helper's subexpressions:
// `{{plural ../pagination.total empty=(t "No posts") singular=(t "1 post") plural=(t "% posts")}}`
//
// Pluralises strings depending on item count
//
// The 1st argument is the numeric variable which the helper operates on
// The 2nd argument is the string that will be output if the variable's value is 0
// The 3rd argument is the string that will be output if the variable's value is 1
// The 4th argument is the string that will be output if the variable's value is 2+

import { getRenderer } from "../services/renderer";

// @ts-ignore
import tpl from "@tryghost/tpl";
import isUndefined from "lodash-es/isUndefined";

const messages = {
  valuesMustBeDefined:
    "All values must be defined for empty, singular and plural",
};

export default function plural(number: number, options: any) {
  const { SafeString } = getRenderer(options);

  if (
    isUndefined(options.hash) ||
    isUndefined(options.hash.empty) ||
    isUndefined(options.hash.singular) ||
    isUndefined(options.hash.plural)
  ) {
    throw new Error(tpl(messages.valuesMustBeDefined));
  }

  if (number === 0) {
    return new SafeString(options.hash.empty.replace("%", number));
  } else if (number === 1) {
    return new SafeString(options.hash.singular.replace("%", number));
  } else if (number >= 2) {
    return new SafeString(options.hash.plural.replace("%", number));
  }
}
