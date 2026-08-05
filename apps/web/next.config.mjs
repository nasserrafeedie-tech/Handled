/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The old vercel.app address stays alive but forwards everyone (and search
  // engines, permanently) to the real domain.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'aissm-web.vercel.app' }],
        destination: 'https://texthandled.com/:path*',
        permanent: true,
      },
    ];
  },
  // texthandled.com/contact → the vCard. Tapping it on a phone opens "Add to
  // Contacts" with the Handled name, number, email, and fleuron photo — so the
  // thread stops being a bare 10-digit number.
  async rewrites() {
    return [{ source: '/contact', destination: '/handled.vcf' }];
  },
  async headers() {
    return [
      {
        source: '/handled.vcf',
        headers: [
          { key: 'Content-Type', value: 'text/vcard; charset=utf-8' },
          // inline (not attachment) so iOS Safari previews the contact card
          // with an Add button instead of downloading a file.
          { key: 'Content-Disposition', value: 'inline; filename="handled.vcf"' },
        ],
      },
    ];
  },
};

export default nextConfig;
