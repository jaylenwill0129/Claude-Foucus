create index agent_automation_events_job_id_idx on public.agent_automation_events (job_id);
create index agent_automation_events_owner_id_idx on public.agent_automation_events (owner_id);
create index agent_automation_jobs_approved_by_idx on public.agent_automation_jobs (approved_by);
create index agent_oauth_states_user_id_idx on public.agent_oauth_states (user_id);
create index agent_prospects_owner_id_idx on public.agent_prospects (owner_id);

create policy "Users inspect their OAuth states"
on public.agent_oauth_states for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.agent_automation_policies from authenticated;
revoke all on public.agent_automation_jobs from authenticated;
revoke all on public.agent_automation_events from authenticated;
revoke all on public.agent_automation_summary from authenticated;

grant select, insert, update, delete on public.agent_automation_policies to authenticated;
grant select, insert, update, delete on public.agent_automation_jobs to authenticated;
grant select on public.agent_automation_events to authenticated;
grant select on public.agent_automation_summary to authenticated;
