-- Unattended autopilot scheduler. Lets the world run its prepare-loop without the
-- operator present, while every gated action still waits for explicit approval.
--
-- Applied live via the Supabase MCP. The Vault secret and cron.schedule() calls
-- are data operations run once after this migration (kept here for the record):
--
--   -- one-time: store a random cron auth token in Vault
--   select vault.create_secret(encode(gen_random_bytes(24),'hex'),
--                              'autopilot_cron_secret', 'Auth token for the autopilot cron loop');
--
--   -- prepare-loop every 30 min
--   select cron.schedule('autopilot-run', '*/30 * * * *', $cmd$
--     select net.http_post(
--       url := 'https://<ref>.supabase.co/functions/v1/autopilot-cron',
--       headers := jsonb_build_object('Content-Type','application/json',
--         'x-automation-secret', (select decrypted_secret from vault.decrypted_secrets where name='autopilot_cron_secret')),
--       body := '{"mode":"run"}'::jsonb, timeout_milliseconds := 25000);
--   $cmd$);
--
--   -- daily operator digest at 13:00 UTC
--   select cron.schedule('autopilot-digest', '0 13 * * *', $cmd$
--     select net.http_post(
--       url := 'https://<ref>.supabase.co/functions/v1/autopilot-cron',
--       headers := jsonb_build_object('Content-Type','application/json',
--         'x-automation-secret', (select decrypted_secret from vault.decrypted_secrets where name='autopilot_cron_secret')),
--       body := '{"mode":"digest"}'::jsonb, timeout_milliseconds := 25000);
--   $cmd$);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Validate an incoming automation token against the Vault secret without ever
-- returning the secret. service_role only (the edge function's key).
create or replace function public.verify_automation_token(candidate text)
returns boolean
language sql
security definer
set search_path = public, vault
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'autopilot_cron_secret' and decrypted_secret = candidate
  );
$$;

revoke all on function public.verify_automation_token(text) from public;
revoke all on function public.verify_automation_token(text) from anon, authenticated;
grant execute on function public.verify_automation_token(text) to service_role;
