-- Active forgetting for the collective-memory bus: learnings not re-validated
-- lose confidence over time, and old, never-reinforced, faded self-learnings are
-- pruned — so the bus keeps only what keeps proving useful. Research digests are
-- exempt from pruning. Scheduled daily via pg_cron 'knowledge-decay' (0 6 * * *):
--   select cron.schedule('knowledge-decay', '0 6 * * *', $$ select public.decay_agent_knowledge(); $$);

create or replace function public.decay_agent_knowledge()
returns void
language sql
security definer
set search_path = public
as $$
  -- Stale (not reinforced in 2 days) learnings lose 0.05 confidence per run, floored at 0.1.
  update public.agent_knowledge
     set confidence = greatest(0.1, confidence - 0.05)
   where updated_at < now() - interval '2 days';

  -- Prune old self-learnings (outcomes) that never reinforced and faded out.
  delete from public.agent_knowledge
   where kind = 'outcome'
     and reinforced_count = 0
     and confidence <= 0.2
     and created_at < now() - interval '10 days';
$$;

revoke all on function public.decay_agent_knowledge() from public, anon, authenticated;
grant execute on function public.decay_agent_knowledge() to service_role;
