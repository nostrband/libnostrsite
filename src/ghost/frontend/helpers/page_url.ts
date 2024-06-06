// ### Page URL Helper
//
// *Usage example:*
// `{{page_url 2}}`
//
// Returns the URL for the page specified in the current object context.

import { getRenderer } from "../services/renderer";

// We use the name page_url to match the helper for consistency:
export default function page_url(page: number, options: any) {
    const { urlUtils } = getRenderer(options);
    return urlUtils.createUrl(`/page/${page}`);
};
