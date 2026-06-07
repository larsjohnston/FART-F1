-- Let the "This Week" standings view update live as race results are synced.
-- (picks + drafts were already added to the realtime publication in 0001.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'results'
  ) then
    execute 'alter publication supabase_realtime add table results';
  end if;
end $$;
