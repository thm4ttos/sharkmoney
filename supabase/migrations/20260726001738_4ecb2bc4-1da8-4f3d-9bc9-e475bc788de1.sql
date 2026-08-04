
REVOKE ALL ON FUNCTION public.cleanup_ops_tables() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_ops_tables() FROM authenticated;
REVOKE ALL ON FUNCTION public.cleanup_ops_tables() FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_ops_tables() TO service_role;
