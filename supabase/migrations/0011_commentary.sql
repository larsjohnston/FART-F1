-- Sarcastic draft commentary: one AI-generated quip per pick. Publicly readable
-- (like picks/results) and added to the realtime publication so the live feed
-- updates for every player as picks are made. Writes happen server-side.
create table if not exists commentary (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references drafts(id) on delete cascade,
  overall int not null,
  text text not null,
  created_at timestamptz not null default now(),
  unique (draft_id, overall)
);

create index if not exists commentary_draft_idx on commentary (draft_id, overall);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'commentary'
  ) then
    execute 'alter publication supabase_realtime add table commentary';
  end if;
end $$;
