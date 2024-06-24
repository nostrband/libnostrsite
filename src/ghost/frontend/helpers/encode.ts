// # Encode Helper
//
// Usage:  `{{encode uri}}`
//
// Returns URI encoded string

import { getRenderer } from "../services/renderer";

export default function encode(str: string, options: any) {
  const { SafeString } = getRenderer(options);

  const uri = str || options;
  try {
    return new SafeString(encodeURIComponent(uri));
  } catch (e) {
    console.log("failed to encode", uri, e);
    throw e;
  }
}
