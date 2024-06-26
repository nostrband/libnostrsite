// ### Pagination Helper
// `{{pagination}}`
// Outputs previous and next buttons, along with info about the current page
import { templates } from "../services/theme-engine/handlebars/template";

// @ts-ignore
import tpl from "@tryghost/tpl";
import { getRenderer } from "../services/renderer";
import isFunction from "lodash-es/isFunction";
import isNull from "lodash-es/isNull";
import isNumber from "lodash-es/isNumber";
import isObject from "lodash-es/isObject";
import isUndefined from "lodash-es/isUndefined";
import merge from "lodash-es/merge";

const messages = {
  invalidData:
    "The {{pagination}} helper was used outside of a paginated context. See https://ghost.org/docs/themes/helpers/pagination/.",
  valuesMustBeDefined:
    "All values must be defined for page, pages, limit and total",
  nextPrevValuesMustBeNumeric: "Invalid value, Next/Prev must be a number",
  valuesMustBeNumeric:
    "Invalid value, check page, pages, limit and total are numbers",
};

export default function pagination(options: any) {
  options = options || {};
  options.hash = options.hash || {};
  options.data = options.data || {};

  const { hbs } = getRenderer(options);
  const createFrame = hbs.handlebars.createFrame;

  // @ts-ignore
  const self: any = this;

  if (!isObject(self.pagination) || isFunction(self.pagination)) {
    throw new Error(tpl(messages.invalidData));
  }

  if (
    isUndefined(self.pagination.page) ||
    isUndefined(self.pagination.pages) ||
    isUndefined(self.pagination.total) ||
    isUndefined(self.pagination.limit)
  ) {
    throw new Error(tpl(messages.valuesMustBeDefined));
  }

  if (
    (!isNull(self.pagination.next) && !isNumber(self.pagination.next)) ||
    (!isNull(self.pagination.prev) && !isNumber(self.pagination.prev))
  ) {
    throw new Error(tpl(messages.nextPrevValuesMustBeNumeric));
  }

  if (
    !isNumber(self.pagination.page) ||
    !isNumber(self.pagination.pages) ||
    !isNumber(self.pagination.total) ||
    !isNumber(self.pagination.limit)
  ) {
    throw new Error(tpl(messages.valuesMustBeNumeric));
  }

  // CASE: The pagination helper should have access to the pagination properties at the top level.
  merge(self, self.pagination);
  // CASE: The pagination helper will forward attributes passed to it.
  merge(self, options.hash);
  const data = createFrame(options.data);

  return templates.execute("pagination", self, { data }, hbs);
}
