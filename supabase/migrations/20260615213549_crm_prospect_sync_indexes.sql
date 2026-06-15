create unique index agent_prospects_source_record_owner_idx
on public.agent_prospects (owner_id, source, source_record_id)
where source_record_id is not null;
