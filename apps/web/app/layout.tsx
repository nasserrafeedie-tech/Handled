import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Your Social Media Manager',
  description: 'Done-for-you social media, run over text.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 antialiased">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-2 px-6 py-6 text-sm text-neutral-500 sm:flex-row">
            <span>© {new Date().getFullYear()} AISSM. Your social media, handled.</span>
            <nav className="flex items-center gap-4">
              <a className="hover:text-neutral-900" href="/">
                Home
              </a>
              <a className="hover:text-neutral-900" href="/billing">
                Pricing
              </a>
              <a className="hover:text-neutral-900" href="/privacy">
                Privacy
              </a>
              <a className="hover:text-neutral-900" href="/terms">
                Terms
              </a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
