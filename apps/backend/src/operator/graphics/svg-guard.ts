/**
 * A strict reader for SVG that a model wrote.
 *
 * Designed posts are SVG drawn by Claude for one post at a time. The renderer
 * (resvg) runs no scripts and fetches nothing, but we still only accept the
 * small, plain subset a poster needs: shapes, gradients, clips, text and one
 * photo slot. Anything outside that list is rejected, not cleaned, so a design
 * either passes as written or falls back to the templates.
 *
 * No XML library: the subset is small enough that a tight reader is easier to
 * trust than a general one, and it refuses comments-with-tricks, CDATA,
 * DOCTYPEs and processing instructions outright.
 */

export interface SvgNode {
  name: string;
  attrs: Record<string, string>;
  children: Array<SvgNode | string>;
}

export class SvgRejected extends Error {}

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path',
  'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'image',
]);

const ATTRS = new Set([
  'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height',
  'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'clip-rule',
  'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor',
  'dx', 'dy', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'clip-path', 'mask', 'maskUnits', 'clipPathUnits', 'href', 'xlink:href',
  'preserveAspectRatio', 'viewBox', 'xmlns', 'xmlns:xlink', 'xml:space',
]);

/** The images a design may draw: the post's own photo and the brand's real
 *  logo, both filled in by us. A design can't bring an image of its own. */
export const PHOTO_SLOT = '{{PHOTO}}';
export const LOGO_SLOT = '{{LOGO}}';
const SLOTS = new Set([PHOTO_SLOT, LOGO_SLOT]);

const MAX_LENGTH = 80_000;
const MAX_ELEMENTS = 800;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) throw new SvgRejected(`bad character ${m}`);
      return String.fromCodePoint(code);
    }
    const v = ENTITIES[e.toLowerCase()];
    if (v === undefined) throw new SvgRejected(`unknown entity ${m}`);
    return v;
  });
}

const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function checkAttr(el: string, name: string, value: string) {
  if (!ATTRS.has(name)) throw new SvgRejected(`attribute ${name} on <${el}> is not allowed`);
  if (/javascript:|data:|https?:|\/\/|@import|expression\(/i.test(value) && !(el === 'svg' && name.startsWith('xmlns'))) {
    throw new SvgRejected(`attribute ${name} points outside the design`);
  }
  if (name === 'href' || name === 'xlink:href') {
    if (el !== 'image' || !SLOTS.has(value)) throw new SvgRejected('only the photo and logo slots may be linked');
  }
  for (const m of value.matchAll(/url\(([^)]*)\)/g)) {
    if (!/^\s*#[\w-]+\s*$/.test(m[1])) throw new SvgRejected(`url(${m[1]}) must point inside the design`);
  }
}

/** Parse, enforcing the allow-list as it goes. Throws SvgRejected. */
export function parseSvg(src: string): SvgNode {
  if (src.length > MAX_LENGTH) throw new SvgRejected('design is too large');
  let s = src.trim().replace(/^```(?:svg|xml)?\s*|\s*```$/g, '');
  // Plain comments are harmless and models like them; anything else that
  // starts with "<!" or "<?" is not part of a poster.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  if (/<!|<\?/.test(s)) throw new SvgRejected('declarations and CDATA are not allowed');

  let i = 0;
  let count = 0;
  const root: SvgNode = { name: '#root', attrs: {}, children: [] };
  const stack: SvgNode[] = [root];
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const text = s.slice(i, lt === -1 ? s.length : lt);
    if (text.trim()) {
      const parent = stack[stack.length - 1];
      if (parent.name !== 'text' && parent.name !== 'tspan') throw new SvgRejected(`stray text in <${parent.name}>`);
      parent.children.push(decode(text));
    } else if (text && (stack[stack.length - 1].name === 'text' || stack[stack.length - 1].name === 'tspan')) {
      stack[stack.length - 1].children.push(' ');
    }
    if (lt === -1) break;
    if (s[lt + 1] === '/') {
      const gt = s.indexOf('>', lt);
      if (gt === -1) throw new SvgRejected('unclosed tag');
      const name = s.slice(lt + 2, gt).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new SvgRejected(`mismatched </${name}>`);
      i = gt + 1;
      continue;
    }
    const m = /^<([A-Za-z][\w:-]*)/.exec(s.slice(lt));
    if (!m) throw new SvgRejected('bad tag');
    const name = m[1];
    if (!ELEMENTS.has(name)) throw new SvgRejected(`<${name}> is not allowed`);
    if (++count > MAX_ELEMENTS) throw new SvgRejected('design has too many elements');
    let j = lt + m[0].length;
    const attrs: Record<string, string> = {};
    for (;;) {
      const a = /^\s*([A-Za-z][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(s.slice(j));
      if (!a) break;
      const value = decode(a[3] ?? a[4] ?? '');
      checkAttr(name, a[1], value);
      attrs[a[1]] = value;
      j += a[0].length;
    }
    const end = /^\s*(\/?)>/.exec(s.slice(j));
    if (!end) throw new SvgRejected(`malformed <${name}>`);
    const node: SvgNode = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!end[1]) stack.push(node);
    i = j + end[0].length;
  }
  if (stack.length !== 1) throw new SvgRejected(`unclosed <${stack[stack.length - 1].name}>`);
  const top = root.children.filter((c): c is SvgNode => typeof c !== 'string');
  if (top.length !== 1 || top[0].name !== 'svg') throw new SvgRejected('design must be one <svg>');
  return top[0];
}

/** Write a parsed tree back out, with the image slots filled in. */
export function serializeSvg(
  node: SvgNode,
  fill: { photo?: string; logo?: string } = {},
  skip?: (n: SvgNode) => boolean,
): string {
  const out = (n: SvgNode | string): string => {
    if (typeof n === 'string') return encode(n);
    if (skip?.(n)) return '';
    const attrs = Object.entries(n.attrs)
      .filter(([k]) => !(n === node && k.startsWith('xmlns')))
      .map(([k, v]) => {
        const link = k === 'href' || k === 'xlink:href';
        const val = link && v === PHOTO_SLOT ? fill.photo ?? '' : link && v === LOGO_SLOT ? fill.logo ?? '' : v;
        return ` ${k}="${encode(val)}"`;
      })
      .join('');
    // The root always carries the namespaces resvg needs, whatever was written.
    const ns = n === node ? ' xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' : '';
    return `<${n.name}${ns}${attrs}>${n.children.map(out).join('')}</${n.name}>`;
  };
  return out(node);
}

export function walk(node: SvgNode, fn: (n: SvgNode, ancestors: SvgNode[]) => void, ancestors: SvgNode[] = []) {
  fn(node, ancestors);
  for (const c of node.children) if (typeof c !== 'string') walk(c, fn, [...ancestors, node]);
}
