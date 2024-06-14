// https://stackoverflow.com/a/9493060

/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from https://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, and l are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 255].
 *
 * @param   {number}  h       The hue
 * @param   {number}  s       The saturation
 * @param   {number}  l       The lightness
 * @return  {Array}           The RGB representation
 */
function hslToRgb(h: number, s: number, l: number) {
  h /= 360.0;
  s /= 100.0;
  l /= 100.0;

  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hueToRgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

// https://gist.github.com/0x263b/2bdd90886c2036a1ad5bcf06d6e6fb37
export function toHSL(
  str: string,
  opts: {
    hue?: number[];
    sat?: number[];
    lit?: number[];
  }
): { h: number; s: number; l: number } {
  opts = opts || {};
  opts.hue = opts.hue || [0, 360];
  opts.sat = opts.sat || [75, 100];
  opts.lit = opts.lit || [40, 60];

  var range = function (hash: number, min: number, max: number) {
    var diff = max - min;
    var x = ((hash % diff) + diff) % diff;
    return x + min;
  };

  var hash = 0;
  if (str.length === 0)
    return {
      h: opts.hue[0],
      s: opts.sat[0],
      l: opts.lit[0],
    };
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }

  const h = range(hash, opts.hue[0], opts.hue[1]);
  const s = range(hash, opts.sat[0], opts.sat[1]);
  const l = range(hash, opts.lit[0], opts.lit[1]);

  return {
    h,
    s,
    l,
  };
}

export function toRGB(
  str: string,
  opts: {
    hue?: number[];
    sat?: number[];
    lit?: number[];
  }
) {
  const hsl = toHSL(str, opts);
  // console.log("hsl", hsl);
  return hslToRgb(hsl.h, hsl.s, hsl.l);
}

export function toRGBString(
  str: string,
  opts: {
    hue?: number[];
    sat?: number[];
    lit?: number[];
  }
) {
  const rgb = toRGB(str, opts);
  // console.log("rgb", rgb);
  return `#${rgb[0].toString(16)}${rgb[1].toString(16)}${rgb[2].toString(16)}`;
}
