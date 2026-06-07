-- Store the richer per-result fields (starting grid + classification status) so
-- driver stats (retired %, positions gained) come from our own DB and survive
-- Jolpica outages, instead of being fetched live on every Stats page load.
alter table results add column if not exists grid int;
alter table results add column if not exists status text;
