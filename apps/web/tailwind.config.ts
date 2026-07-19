import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Warm print-shop palette: cream stock, espresso ink, terracotta,
        // a brass accent and a muted sage. Everything mixes from these.
        paper: '#F8F3EA',
        parchment: '#EFE7D8',
        ink: '#1A140D',
        clay: {
          50: '#FAF1EA',
          100: '#F3DFD0',
          200: '#E7C0A6',
          300: '#D89B75',
          400: '#CB7548',
          500: '#BE5B2D',
          600: '#A0481F',
          700: '#7E3718',
          800: '#5C2812',
        },
        brass: '#C79A45',
        sage: '#66705A',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(26,20,13,0.05), 0 10px 28px -14px rgba(26,20,13,0.22)',
        lift: '0 2px 4px rgba(26,20,13,0.06), 0 24px 48px -16px rgba(26,20,13,0.28)',
        glow: '0 0 80px -12px rgba(190,91,45,0.55)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      transitionTimingFunction: {
        // One easing for the whole site: fast start, long soft landing.
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        // Hero headline words rising out of a clipped line.
        rise: {
          from: { transform: 'translateY(115%) rotate(2.5deg)' },
          to: { transform: 'translateY(0) rotate(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        caret: {
          '0%, 45%': { opacity: '1' },
          '50%, 95%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'dot-pulse': {
          '0%, 60%, 100%': { transform: 'translateY(0)', opacity: '0.4' },
          '30%': { transform: 'translateY(-4px)', opacity: '1' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0) rotate(-1deg)' },
          '50%': { transform: 'translateY(-10px) rotate(-0.2deg)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        rise: 'rise 0.9s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.8s ease-out both',
        marquee: 'marquee 36s linear infinite',
        caret: 'caret 1.1s step-end infinite',
        'dot-pulse': 'dot-pulse 1.2s ease-in-out infinite',
        'float-slow': 'float-slow 7s ease-in-out infinite',
        'spin-slow': 'spin-slow 24s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
