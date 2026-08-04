-- Allow authenticated users to execute has_role (needed by RLS policies that reference it)
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

-- Simplify user_roles SELECT policy so admins can read their own role without depending on has_role evaluation
DROP POLICY IF EXISTS "users see own roles" ON public.user_roles;
CREATE POLICY "users see own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));