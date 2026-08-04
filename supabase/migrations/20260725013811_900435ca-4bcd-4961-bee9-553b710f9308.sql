-- Migra o domínio virtual do login (username → email) de @brinzap.app para @abio.app
-- Preserva o local-part e não afeta usuários com e-mail real.

UPDATE auth.users
SET email = regexp_replace(email, '@brinzap\.app$', '@abio.app'),
    updated_at = now()
WHERE email LIKE '%@brinzap.app';

UPDATE public.profiles
SET email = regexp_replace(email, '@brinzap\.app$', '@abio.app'),
    updated_at = now()
WHERE email LIKE '%@brinzap.app';