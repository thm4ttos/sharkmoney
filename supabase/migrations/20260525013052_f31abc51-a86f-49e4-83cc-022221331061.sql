
-- 1. Fix privilege escalation on user_roles: add explicit INSERT/UPDATE/DELETE policies for admins only
create policy "admins insert roles"
  on public.user_roles for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'::app_role));

create policy "admins update roles"
  on public.user_roles for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

create policy "admins delete roles"
  on public.user_roles for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- Restrictive policy: block non-admin writes entirely (defense in depth)
create policy "block non-admin role writes"
  on public.user_roles as restrictive for all
  to authenticated, anon
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Restrict whatsapp_messages: only admins or service role may insert (webhook uses service role / supabaseAdmin)
create policy "block public wa inserts"
  on public.whatsapp_messages as restrictive for insert
  to authenticated, anon
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Revoke EXECUTE on has_role from API roles (RLS policies still work — they run as definer)
revoke execute on function public.has_role(uuid, app_role) from anon, authenticated, public;
