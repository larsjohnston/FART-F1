import type { CSSProperties } from 'react'

/** Small circular player avatar — their photo if set, else their initial on a
 *  team-coloured ring. Used anywhere a player's name appears. */
export default function PlayerAvatar({ name, color, photoUrl, size = 24 }: {
  name: string; color: string; photoUrl?: string | null; size?: number
}) {
  const base: CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    border: `2px solid ${color}`, objectFit: 'cover',
  }
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt={name} style={base} />
  }
  return (
    <span style={{
      ...base, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--panel-2)', fontWeight: 800, fontSize: Math.round(size * 0.45),
    }}>
      {name.slice(0, 1)}
    </span>
  )
}
