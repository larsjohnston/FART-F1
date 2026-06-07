'use client'

export interface DriverVM {
  id: string
  name: string
  team: string
  teamColor: string
  quali?: number
  headshot?: string | null
  drafted?: { byName: string } | null
}

export default function DriverCard({
  d,
  canPick,
  onPick,
}: {
  d: DriverVM
  canPick: boolean
  onPick: () => void
}) {
  const dim = !!d.drafted
  return (
    <button
      disabled={dim || !canPick}
      onClick={onPick}
      style={{
        textAlign: 'left',
        padding: 10,
        borderRadius: 10,
        border: '1px solid var(--line)',
        borderLeft: `3px solid ${dim ? '#333' : d.teamColor}`,
        background: dim ? '#0e1217' : 'var(--panel-2)',
        color: dim ? '#555' : 'var(--text)',
        outline: canPick && !dim ? '2px solid var(--live)' : 'none',
        outlineOffset: -1,
        opacity: dim ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {d.headshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.headshot} alt="" width={28} height={28} style={{ borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: d.teamColor,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: '#000',
            }}
          >
            {d.name.slice(0, 2)}
          </span>
        )}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, textDecoration: dim ? 'line-through' : 'none' }}>
            {d.name}
          </div>
          <div style={{ fontSize: 11, color: dim ? '#555' : d.teamColor }}>
            {d.team}
            {d.quali ? ` · P${d.quali}` : ''}
            {d.drafted ? ` · ${d.drafted.byName}` : ''}
          </div>
        </div>
      </div>
    </button>
  )
}
