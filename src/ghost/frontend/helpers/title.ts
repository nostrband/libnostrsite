// # Title Helper
// Usage: `{{title}}`
//
// Overrides the standard behavior of `{[title}}` to ensure the content is correctly escaped

import { getRenderer } from "../services/renderer";

export default function title(options: any) {
  const { SafeString, escapeExpression } = getRenderer(options);
  // @ts-ignore
  return new SafeString(escapeExpression(this.title || ""));
}
