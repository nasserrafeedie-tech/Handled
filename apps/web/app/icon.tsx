import { ImageResponse } from 'next/og';

// Branded browser-tab icon: the oxblood Fleuron on paper.
// Master SVGs live in handled-hq/brand/logo/.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

const PETAL = 'M0,-1 C7.5,-9 7.5,-25 0,-33 C-7.5,-25 -7.5,-9 0,-1 Z';
const ANGLES = [0, 60, 120, 180, 240, 300];

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8F3EA',
          borderRadius: '999px',
        }}
      >
        <svg width="26" height="26" viewBox="-36 -36 72 72">
          {ANGLES.map((a) => (
            <path key={a} d={PETAL} fill="#8C2F39" transform={`rotate(${a})`} />
          ))}
          <circle r="4.6" fill="#8C2F39" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
