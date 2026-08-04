# Sistema de Afiliados — abio

Módulo completo, escalável, com painel admin, painel do afiliado, rastreio, comissões, saques, materiais, cupons, metas, ranking e anti-fraude.

Dado o tamanho, entregarei em **6 fases**. Você aprova a fase 1 (fundação) e sigo. Nenhuma alteração de código nesta mensagem.

## Arquitetura

```text
Visitante → /?ref=CODIGO
   ↓ (cookie 60d + localStorage + registra affiliate_clicks)
Cadastro → trigger handle_new_user vincula referrals(user_id, affiliate_id)
   ↓
Assinatura paga → cria affiliate_commissions (pending → available após D+7)
   ↓
Afiliado solicita saque → admin aprova → affiliate_payouts (paid)
```

## Modelo de dados (fase 1)

- `affiliates` — user_id, code (único), status (active/blocked/pending), custom_commission_pct, coupon_code, created_at
- `affiliate_settings` (singleton) — cookie_days, min_payout_cents, default_commission_pct por período (monthly/quarterly/semiannual/annual/lifetime), payout_methods (jsonb)
- `affiliate_clicks` — affiliate_id, ref_code, ip_hash, user_agent, device, browser, source, utm (jsonb), landing_path, created_at
- `affiliate_campaigns` — affiliate_id, slug, name, channel, clicks_count, signups_count
- `referrals` — user_id (unique), affiliate_id, click_id, status (visited/signup/trial/paid/cancelled), first_paid_at, source_campaign
- `affiliate_commissions` — affiliate_id, referral_id, subscription_id, plan_slug, gross_cents, commission_cents, status (pending/available/paid/reversed), available_at, paid_at
- `affiliate_payouts` — affiliate_id, amount_cents, method, payload (jsonb), status (requested/approved/paid/rejected), requested_at, paid_at, admin_note
- `affiliate_goals` — global tiers (sales_count, reward_type, reward_value)
- `affiliate_notifications` — affiliate_id, kind, payload, read_at
- `coupons` — code, affiliate_id (nullable), discount_type, discount_value, active, valid_until, max_uses, uses

RLS: afiliado lê/escreve só o próprio; admin (has_role) faz tudo; anon insere em `affiliate_clicks` via server route pública. Trigger `handle_new_user` estendido para ler cookie `abio_ref` recebido via server fn no signup e criar `referrals`.

## Anti-fraude

- Hash IP + UA no click; bloquear auto-referência (user_id === affiliate.user_id no signup)
- Índice único parcial: 1 referral por user_id
- Rate-limit: mesmo ip_hash não pode gerar mais que N signups/24h (flag para revisão)
- Cookie assinado (HMAC) do lado do server para evitar injeção manual
- Auditoria em `admin_audit_log` para promoção/bloqueio/aprovação de saque

## Fases

**Fase 1 — Fundação (banco + tracking)**
1. Migration com todas as tabelas acima, RLS, grants, seeds em `affiliate_settings`.
2. Server route `POST /api/public/affiliate/track` — grava `affiliate_clicks`, seta cookie assinado 60d.
3. Componente `<AffiliateTracker />` no `__root.tsx` — lê `?ref=` ou `?af=`, chama a rota, persiste em localStorage.
4. Extensão do `handle_new_user`: se `raw_user_meta_data->>'ref'` existir, criar `referrals`.
5. `src/lib/affiliate.functions.ts` com `getMyAffiliate`, `promoteToAffiliate` (admin), `blockAffiliate`, `listAffiliates` (admin).

**Fase 2 — Painel admin `/admin/afiliados`**
- Aba na sidebar 🤝 Afiliados
- Tabela: buscar, filtrar por status/desempenho, editar comissão, bloquear/reativar
- Botão "Tornar Afiliado" na `admin.users.$userId`
- Configurações globais (settings) editáveis

**Fase 3 — Painel do afiliado `/app/afiliados`**
- KPIs (cliques, cadastros, assinaturas, conversão, comissão pendente/disponível/paga)
- Link + QR Code (usa `qrcode` package) + botão copiar/compartilhar
- Histórico de indicações com status colorido
- Gráfico de crescimento (recharts, já no projeto)
- CTA "Quero ser afiliado" quando `has_role != affiliate`

**Fase 4 — Comissões automáticas**
- Trigger em `subscriptions` INSERT status='active' com price_cents>0:
  - localizar `referrals.affiliate_id` do user
  - calcular commission_cents = gross × pct (custom || settings.default[period])
  - inserir `affiliate_commissions` status='pending', available_at = now()+7d
- Cron diário `/api/public/hooks/affiliate-mature` promove pending→available quando available_at ≤ now
- Reversão automática se subscription cancela em ≤ 7d

**Fase 5 — Saques + materiais + cupons + campanhas**
- Fluxo de saque (afiliado solicita, admin aprova/paga)
- Área "Materiais": banners/textos hospedados no bucket + templates de post
- Cupons: aplicar no checkout futuro (hoje só cadastro/estatística)
- Múltiplos links de campanha `?ref=CODIGO&c=instagram`

**Fase 6 — Ranking, metas, notificações, exports**
- View materializada `affiliate_leaderboard` (mensal/anual)
- Metas globais + progresso do afiliado
- Notificações via WhatsApp (usa pipeline existente) e in-app
- Export CSV nas telas admin

## Detalhes técnicos

- Cookie: `abio_ref` HttpOnly=false (precisa ser lido no signup client-side), SameSite=Lax, 60d, valor = `code|hmac`
- Signup passa `ref` em `signInWithPassword` via `options.data.ref` → trigger lê `raw_user_meta_data`
- Códigos: gerados a partir de `slug(profile.name)` + sufixo curto quando colidem; fallback `AB{6 dígitos}`
- Todas as tabelas com GRANT authenticated + service_role; `affiliate_clicks` também com INSERT anon via RPC
- `has_role` estendida com role `affiliate` (novo valor do enum `app_role`) para gate do painel do afiliado

## Escopo desta aprovação

Se aprovar, implemento **Fase 1** integralmente nesta próxima resposta (migration + tracking + server fns base + tracker no root). As fases seguintes viram mensagens separadas para manter cada entrega revisável.

Confirma seguir com a Fase 1?
