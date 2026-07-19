import { ImageResponse } from 'next/og';

// Branded preview card shown when the site is shared on social / in messages.
export const runtime = 'edge';
export const alt = 'AISSM — your social media, handled';
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '52px',
              height: '52px',
              borderRadius: '999px',
              backgroundColor: '#BE5B2D',
              color: 'white',
              fontSize: '28px',
              fontWeight: 700,
            }}
          >
            A
          </div>
          <div style={{ fontSize: '30px', fontWeight: 700, color: '#1A140D' }}>
            AISSM
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
            Done-for-you posts for small businesses — run entirely over text.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '24px',
            color: '#A0481F',
            fontWeight: 600,
          }}
        >
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '999px',
              backgroundColor: '#BE5B2D',
              display: 'flex',
            }}
          />
          No dashboard. No passwords. Cancel anytime.
        </div>
      </div>
    ),
    { ...size },
  );
}
