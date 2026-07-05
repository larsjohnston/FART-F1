import { NextRequest, NextResponse } from 'next/server'
import { serverClientForSchema } from '@/lib/supabase/server'
import { SUPABASE_SCHEMA, APP_MASTER, LEAGUES } from '@/lib/config'

interface Finish { driver_id: string; finish_position: number; grid?: number | null }

// Manual/preliminary race results. Writes provisional rows (status 'Manual',
// provisional=true) so they score immediately and are overwritten when the
// official results sync. When called on the app-master deployment, the write
// fans out to EVERY pool's schema (they share one Supabase project), so the
// super user enters preliminary results once and both leagues update. Rows are
// matched per schema by (season, round) → race and filtered to drivers that
// exist in that schema so a missing FK can't fail the whole write.
export async function POST(req: NextRequest) {
  try {
    const { season, round, finishes } = (await req.json()) as { season: number; round: number; finishes: Finish[] }
    if (!season || !round || !Array.isArray(finishes) || !finishes.length) {
      return NextResponse.json({ ok: false, error: 'season, round and finishes are required' }, { status: 400 })
    }

    const schemas = APP_MASTER ? [...new Set(LEAGUES.map(l => l.schema))] : [SUPABASE_SCHEMA]
    const driverIds = [...new Set(finishes.map(f => f.driver_id))]
    const results: { schema: string; saved: number; skipped: number; error?: string }[] = []

    for (const schema of schemas) {
      const db = serverClientForSchema(schema)
      const { data: race } = await db.from('races').select('id').eq('season', season).eq('round', round).maybeSingle()
      if (!race) { results.push({ schema, saved: 0, skipped: finishes.length, error: 'round not synced in this pool' }); continue }

      const { data: known } = await db.from('drivers').select('id').in('id', driverIds)
      const knownSet = new Set((known ?? []).map(d => d.id))
      const rows = finishes
        .filter(f => Number.isFinite(f.finish_position) && f.finish_position > 0 && knownSet.has(f.driver_id))
        .map(f => ({ race_id: race.id, driver_id: f.driver_id, finish_position: Math.round(f.finish_position), grid: f.grid ?? null, status: 'Manual', provisional: true }))

      if (rows.length) {
        const { error } = await db.from('results').upsert(rows, { onConflict: 'race_id,driver_id' })
        if (error) { results.push({ schema, saved: 0, skipped: finishes.length, error: error.message }); continue }
      }
      results.push({ schema, saved: rows.length, skipped: finishes.length - rows.length })
    }

    return NextResponse.json({ ok: true, results })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
