import { ImageResponse } from 'next/og';

// Branded preview card shown when the site is shared on social / in messages.
export const runtime = 'edge';
export const alt = 'Handled — your social media, handled';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#F8F3EA',
          padding: '72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <svg width="48" height="48" viewBox="-36 -36 72 72">
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <path
                key={a}
                d="M0,-1 C7.5,-9 7.5,-25 0,-33 C-7.5,-25 -7.5,-9 0,-1 Z"
                fill="#8C2F39"
                transform={`rotate(${a})`}
              />
            ))}
            <circle r="4.6" fill="#8C2F39" />
          </svg>
          <div style={{ fontSize: '30px', fontWeight: 700, color: '#1A140D' }}>
            Handled
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div
            style={{
              display: 'flex',
              fontSize: '78px',
              fontWeight: 700,
              lineHeight: 1.05,
              color: '#1A140D',
              letterSpacing: '-0.02em',
            }}
          >
            Your social media, handled.
          </div>
          <div style={{ display: 'flex', fontSize: '32px', color: '#6d6357' }}>
            We make the posts. You approve them by text.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '24px',
            color: '#74232D',
            fontWeight: 600,
          }}
        >
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '999px',
              backgroundColor: '#8C2F39',
              display: 'flex',
            }}
          />
          Nothing to log into, and the first two weeks are refundable.
        </div>
      </div>
    ),
    { ...size },
  );
}
