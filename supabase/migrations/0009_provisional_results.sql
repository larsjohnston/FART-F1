-- Provisional results: OpenF1 publishes the finishing order within minutes of
-- the flag, well before Jolpica posts the official classification (~30–60 min,
-- penalties applied). We surface that provisional order immediately, then
-- overwrite it with the official result once Jolpica has it. This flag lets the
-- UI mark a result as provisional and lets sync know the row is safe to replace.
-- (results is already in the realtime publication — see 0003 — so flips on this
-- column push to the standings view live.)
alter table results add column if not exists provisional boolean not null default false;
