/**
 * The Fleuron — Handled's brand mark. The old keyboard ✳ redrawn as a
 * printer's fleuron: six ink petals fused to a center dot.
 * Inherits color via `fill-current`; spin it with `motion-safe:animate-spin-slow`
 * on a wrapper (or pass className) exactly like the old asterisk.
 * Master SVGs live in handled-hq/brand/logo/.
 */
export function Fleuron({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="-36 -36 72 72"
      aria-hidden
      className={`inline-block fill-current ${className}`}
    >
      <path id="hq-petal" d="M0,-1 C7.5,-9 7.5,-25 0,-33 C-7.5,-25 -7.5,-9 0,-1 Z" />
      <use href="#hq-petal" transform="rotate(60)" />
      <use href="#hq-petal" transform="rotate(120)" />
      <use href="#hq-petal" transform="rotate(180)" />
      <use href="#hq-petal" transform="rotate(240)" />
      <use href="#hq-petal" transform="rotate(300)" />
      <circle r="4.6" />
    </svg>
  );
}
