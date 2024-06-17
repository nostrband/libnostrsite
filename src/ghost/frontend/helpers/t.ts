// # t helper
// i18n: Translatable handlebars expressions for templates of the front-end and themes.
// Front-end: .hbs templates in core/server, overridden by copies in themes. Themes: in content/themes.
//
// Usage examples, for example in .hbs theme templates:
// {{t "Get the latest posts delivered right to your inbox"}}
// {{{t "Proudly published with {ghostlink}" ghostlink="<a href=\"https://ghost.org\">Ghost</a>"}}}
//
// To preserve HTML, use {{{t}}}. This helper doesn't use a SafeString object which would prevent escaping,
// because often other helpers need that (t) returns a string to be able to work as subexpression; e.g.:
// {{tags prefix=(t " on ")}}

//const {themeI18n} = require('../services/handlebars');
// @ts-ignore
import tpl from "@tryghost/tpl";

const messages = {
  oopsErrorTemplateHasError: "Oops, seems there is an error in the template.",
};

export default function t(text: string, options: any) {
  if (text === undefined && options === undefined) {
    throw new Error(tpl(messages.oopsErrorTemplateHasError));
  }

  const bindings: any = {};
  let prop;
  for (prop in options.hash) {
      if (Object.prototype.hasOwnProperty.call(options.hash, prop)) {
          bindings[prop] = options.hash[prop];
      }
  }
  // FIXME implement i18n
  return tpl(text, bindings);

  // return themeI18n.t(text, bindings);
}
