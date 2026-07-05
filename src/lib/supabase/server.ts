import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SCHEMA } from '@/lib/config'

/** Service-role client scoped to a specific Postgres schema. Both pools share one
 *  Supabase project, so the app master can write to another pool's schema from
 *  here (e.g. cross-league manual results). */
export function serverClientForSchema(schema: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema } },
  )
}

export function serverClient() {
  return serverClientForSchema(SUPABASE_SCHEMA)
}
