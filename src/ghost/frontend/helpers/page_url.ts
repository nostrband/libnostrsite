// ### Page URL Helper
//
// *Usage example:*
// `{{page_url 2}}`
//
// Returns the URL for the page specified in the current object context.

import { getRenderer } from "../services/renderer";

// We use the name page_url to match the helper for consistency:
export default function page_url(page: number, options: any) {
  const hasPage = !!options;
  options = options || (page as any);
  const { urlUtils } = getRenderer(options);
  const pathBase = options.data.root.pathBase;
  if (hasPage && page > 1)
    return urlUtils.createUrl(`${pathBase}page/${page}`);
  // some themes use this helper w/o params,
  // and expect a base url w/ trailing slash, to which they'd
  // append /page/X themselves
  else return pathBase;
}
