-- Modo Casal: duas contas Abio podem se vincular com consentimento mútuo
-- (pending -> accepted/rejected, ou cancelled ao desvincular). Depois de
-- ACCEPTED, os dois passam a enxergar automaticamente as receitas/despesas,
-- contas fixas, parcelamentos e metas um do outro (transparência total entre
-- o casal) — o consentimento é no VÍNCULO (uma vez, mútuo, revogável), não
-- item por item. Nada fica visível antes do aceite.

CREATE TABLE public.couple_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  split_ratio_requester numeric(5,2) NOT NULL DEFAULT 50 CHECK (split_ratio_requester BETWEEN 0 AND 100),
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  unlinked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT couple_links_no_self CHECK (requester_id <> partner_id)
);
ALTER TABLE public.couple_links ENABLE ROW LEVEL SECURITY;

-- Ambas as partes enxergam o vínculo (pending, accepted ou histórico); admin também.
CREATE POLICY "couple_links parties read" ON public.couple_links FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR partner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role));

-- Sem policy de INSERT/UPDATE/DELETE pra "authenticated": toda escrita passa
-- pelo service role (couple.functions.ts / wa-processor.server.ts), que já
-- valida a identidade via requireSupabaseAuth ANTES de chamar supabaseAdmin.
-- Isso evita um usuário forjar um "accepted" direto via update() no client.
CREATE POLICY "couple_links admin write" ON public.couple_links FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Impede duas linhas ativas (pending/accepted) pro MESMO par, em qualquer ordem.
CREATE UNIQUE INDEX couple_links_active_pair ON public.couple_links (
  LEAST(requester_id, partner_id), GREATEST(requester_id, partner_id)
) WHERE status IN ('pending','accepted');

CREATE INDEX couple_links_requester_idx ON public.couple_links (requester_id);
CREATE INDEX couple_links_partner_idx ON public.couple_links (partner_id);

-- "Quem pagou de fato" uma despesa compartilhada (pro cálculo de saldo/
-- divisão) — NULL = pago pelo próprio user_id da transação, não precisa backfill.
ALTER TABLE public.transactions ADD COLUMN paid_by_user_id uuid REFERENCES public.profiles(id);

-- Helper reaproveitado nas 4 policies novas abaixo, mesmo espírito de has_role().
CREATE OR REPLACE FUNCTION public.is_accepted_partner(_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.couple_links cl
    WHERE cl.status = 'accepted'
      AND ((cl.requester_id = auth.uid() AND cl.partner_id = _owner)
        OR (cl.partner_id = auth.uid() AND cl.requester_id = _owner))
  );
$$;

-- Policies aditivas de SELECT — a policy FOR ALL original de cada tabela
-- (dono) continua intacta; isto só ACRESCENTA uma segunda policy permissiva,
-- então o Postgres faz OR entre elas automaticamente. Nada fica visível pro
-- parceiro antes de status='accepted' (a função retorna false até lá); depois
-- do aceite, TUDO da tabela fica visível pro parceiro (transparência total,
-- sem opt-in por item).
CREATE POLICY "tx partner select" ON public.transactions FOR SELECT TO authenticated
  USING (public.is_accepted_partner(user_id));
CREATE POLICY "bills partner select" ON public.recurring_bills FOR SELECT TO authenticated
  USING (public.is_accepted_partner(user_id));
CREATE POLICY "installments partner select" ON public.installment_purchases FOR SELECT TO authenticated
  USING (public.is_accepted_partner(user_id));
CREATE POLICY "goals partner select" ON public.financial_goals FOR SELECT TO authenticated
  USING (public.is_accepted_partner(user_id));
