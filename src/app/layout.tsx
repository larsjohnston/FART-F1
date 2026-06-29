import './globals.css'
import type { Metadata, Viewport } from 'next'
import BottomNav from '@/components/BottomNav'
import ServiceWorker from '@/components/ServiceWorker'
import { PlayerProvider } from '@/lib/players/context'

// metadata.manifest is intentionally omitted — Next injects the manifest <link>
// automatically from app/manifest.ts.
export const metadata: Metadata = {
  applicationName: 'FART-F1',
  title: 'FART-F1',
  description: 'Fantasy F1 draft pool',
  appleWebApp: {
    capable: true,
    title: 'FART-F1',
    statusBarStyle: 'black-translucent',
  },
  // Legacy iOS standalone flag (Next emits the modern `mobile-web-app-capable`;
  // older iOS still keys off this one for fullscreen home-screen launch).
  other: { 'apple-mobile-web-app-capable': 'yes' },
}

export const viewport: Viewport = {
  themeColor: '#0d1117',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* App shell: pinned to the visual viewport with position:fixed + inset:0
          (NOT height:100dvh — dvh renders short of the screen in iOS standalone,
          leaving a dead strip below the nav). A flex column whose ONLY scrolling
          area is the inner container; the BottomNav is a static flex footer that
          can't detach during momentum scroll. paddingTop clears the status-bar
          notch; the nav clears the home indicator. See CLAUDE.md "BottomNav pinning". */}
      <body style={{ position: 'fixed', inset: 0, maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <PlayerProvider>{children}</PlayerProvider>
        </div>
        <BottomNav />
        <ServiceWorker />
      </body>
    </html>
  )
}
