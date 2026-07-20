/**
 * Owners say "teal", and their word is what we store — it reads right in the
 * onboarding read-back and in LLM brand context. The graphics engine needs
 * something SVG can render, so conversion happens here, at point of use:
 * common words map to brand-quality hexes, real hexes and plain CSS color
 * names pass through, and anything SVG would silently render black is dropped.
 */
const COLOR_WORDS: Record<string, string> = {
  teal: '#0F766E',
  gold: '#C79A45',
  navy: '#1E3A5F',
  burgundy: '#8C2F39',
  maroon: '#7A2733',
  sage: '#66705A',
  olive: '#6B7245',
  cream: '#F5EFE0',
  charcoal: '#333333',
  blush: '#E8B4B8',
  turquoise: '#2AA198',
  lavender: '#B69DD4',
  mint: '#98D8C8',
  coral: '#E9756B',
  mustard: '#D4A017',
  rust: '#B7410E',
  forest: '#2D5A3D',
  'forest green': '#2D5A3D',
  'sky blue': '#87CEEB',
  'baby blue': '#A7C7E7',
  'hot pink': '#E5399E',
  'royal blue': '#2A52BE',
};
const CSS_NAME = /^[a-z]{3,20}$/;
const HEX = /^#?[0-9a-f]{6}$/i;

export function toSvgColors(colors: string[]): string[] {
  return colors
    .map((c) => {
      const key = c.trim().toLowerCase();
      if (COLOR_WORDS[key]) return COLOR_WORDS[key];
      if (HEX.test(key)) return key.startsWith('#') ? key : `#${key}`;
      if (CSS_NAME.test(key)) return key; // plain CSS color name — SVG-safe
      return null;
    })
    .filter((c): c is string => c !== null)
    .slice(0, 4);
}
