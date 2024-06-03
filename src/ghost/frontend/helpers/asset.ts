// # Asset helper
// Usage: `{{asset "css/screen.css"}}`
//
// Returns the path to the specified asset.

// @ts-ignore
import tpl from "@tryghost/tpl";
import get from "lodash-es/get";
import { getRenderer } from "../services/renderer";

const messages = {
  pathIsRequired: "The {{asset}} helper must be passed a path",
};

export default function asset(path: string, options: any) {
  const { urlUtils, metaData, SafeString } = getRenderer(options);
  const { getAssetUrl } = metaData;

  const hasMinFile = get(options, "hash.hasMinFile");

  if (!path) {
    throw new Error(tpl(messages.pathIsRequired));
  }
  if (
    typeof urlUtils.getSiteUrl() !== "undefined" &&
    typeof urlUtils.getAdminUrl() !== "undefined" &&
    urlUtils.getSiteUrl() !== urlUtils.getAdminUrl()
  ) {
    const target = new URL(
      getAssetUrl(path, hasMinFile),
      urlUtils.getSiteUrl()
    );
    return new SafeString(target.href);
  }

  return new SafeString(getAssetUrl(path, hasMinFile));
}
