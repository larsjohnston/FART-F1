'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/draft', label: 'Draft' },
  { href: '/standings', label: 'Standings' },
  { href: '/stats', label: 'Stats' },
  { href: '/history', label: 'History' },
  { href: '/admin', label: 'Commissioner' },
]

export default function BottomNav() {
  const path = usePathname()
  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 520, margin: '0 auto',
      display: 'flex', background: 'var(--panel)', borderTop: '1px solid var(--line)',
      // Promote to its own compositor layer so iOS Safari keeps it pinned to the
      // viewport while scrolling — without this the fixed bar gets stranded
      // mid-page during momentum scroll. Also clear the home-indicator safe area.
      transform: 'translateZ(0)', willChange: 'transform',
      paddingBottom: 'env(safe-area-inset-bottom)', zIndex: 50 }}>
      {TABS.map(t => {
        const active = path?.startsWith(t.href) ?? false
        return (
          <Link key={t.href} href={t.href} style={{ flex: 1, textAlign: 'center', padding: '11px 2px',
            fontSize: 11, color: active ? 'var(--text)' : 'var(--muted)', lineHeight: 1.1,
            borderTop: active ? '2px solid var(--accent)' : '2px solid transparent', textDecoration: 'none' }}>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
