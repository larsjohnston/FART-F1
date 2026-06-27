import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SCHEMA } from '@/lib/config'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { db: { schema: SUPABASE_SCHEMA } },
)
