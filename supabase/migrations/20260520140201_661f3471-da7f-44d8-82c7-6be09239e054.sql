REVOKE EXECUTE ON FUNCTION public.cleanup_expired_ai_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_ai_cache() TO service_role;