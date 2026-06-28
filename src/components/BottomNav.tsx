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
    // Static flex footer inside the app-shell column (see layout.tsx) — NOT
    // position:fixed. The document body doesn't scroll; the content container
    // above does, so this bar is always physically pinned to the bottom and can
    // never get stranded mid-page during iOS momentum scroll. Don't reintroduce
    // position:fixed here. Clears the home-indicator safe area.
    <nav style={{ flexShrink: 0, display: 'flex', background: 'var(--panel)', borderTop: '1px solid var(--line)',
      paddingBottom: 'env(safe-area-inset-bottom)' }}>
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
