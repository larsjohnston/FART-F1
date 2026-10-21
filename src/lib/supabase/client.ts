import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SCHEMA } from '@/lib/config'

// This app never uses Supabase Auth (identity is plain localStorage via
// usePlayer/NamePicker) — disable the session machinery entirely so queries
// never await GoTrueClient's lock-guarded getSession(). Left on, that lock
// can get stuck (a known supabase-js issue, especially when a mobile/PWA tab
// is backgrounded mid-request) and every subsequent supabase.from(...) call
// queues behind it forever — surfaced as /draft "hanging" until you navigate
// away and back.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, db: { schema: SUPABASE_SCHEMA } },
)
