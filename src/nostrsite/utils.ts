
export function isBlossomUrl(u: string) {
  const url = new URL(u);
  const pathExt = url.pathname.split(".");
  const segments = pathExt[0].split("/");
  // path must be /sha256-hex(.ext)?
  const isNot = pathExt.length > 2 || segments.length > 2 || segments[1].length != 64;
  return !isNot;
}
