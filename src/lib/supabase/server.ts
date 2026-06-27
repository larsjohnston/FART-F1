import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SCHEMA } from '@/lib/config'

export function serverClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: SUPABASE_SCHEMA } },
  )
}
