# Abio - Seu Assistente Virtual

Crie um aplicativo SaaS completo chamado "BrinZap", baseado na identidade visual fornecida (logo com gradiente roxo + verde neon).

OBJETIVO:
O BrinZap é um sistema de gestão financeira e compromissos com dois pilares principais:

Entrada de dados via WhatsApp (principal diferencial)

Dashboard web completo para controle detalhado

O sistema deve ser simples, inteligente e com aparência de produto premium.

🔗 1. INTEGRAÇÃO COM WHATSAPP (OBRIGATÓRIO)

O sistema deve se integrar com WhatsApp (Cloud API ou similar) permitindo que o usuário envie mensagens como:

"Gastei 50 no mercado"

"Recebi 2000"

"Consulta amanhã às 14h"

O sistema deve:

Interpretar automaticamente (NLP / IA)

Identificar valor, tipo (gasto/receita), categoria e data

Registrar automaticamente no banco

Responder no WhatsApp com confirmação:

Ex:
"Registrado: R$50 em Alimentação ✅"
"Compromisso criado para amanhã às 14h 📅"

Também deve aceitar áudio.

🧠 2. INTELIGÊNCIA DO SISTEMA

Classificação automática de categorias:
(Alimentação, Transporte, Lazer, Moradia, Saúde, etc.)

Detecção de padrões de gasto

Aprendizado baseado no usuário

💻 3. DASHBOARD WEB COMPLETO (BASEADO NO VÍDEO)

O dashboard deve seguir exatamente o estilo de um app financeiro moderno como mostrado na referência:

TELA PRINCIPAL:

Saldo total

Total de receitas

Total de despesas

Gráfico (pizza ou barras)

Evolução mensal

Lista de transações recentes

SEÇÃO DE TRANSAÇÕES:

Lista completa

Filtros por data

Filtros por categoria

Busca

SEÇÃO DE CATEGORIAS:

Visual com ícones

Cores diferentes por categoria

Percentual de gasto por categoria

SEÇÃO DE COMPROMISSOS:

Lista de eventos

Organização por data

Integração com o que foi enviado no WhatsApp

📊 4. EXPERIÊNCIA DO DASHBOARD

Interface limpa e moderna

Cards grandes com informações claras

Linguagem simples:

Ex:
"Você gastou R$ 320 esse mês"
"Maior gasto: Alimentação"
"Você gastou 15% a mais que semana passada"

⚠️ 5. ALERTAS INTELIGENTES

O sistema deve mostrar automaticamente:

"Você está gastando acima do normal"

"Você economizou R$ X essa semana"

"Categoria X está aumentando"

🎨 6. DESIGN (OBRIGATÓRIO)

Seguir exatamente a identidade da marca BrinZap:

Fundo escuro (roxo/preto)

Gradiente neon (verde + roxo)

Botões com glow

Efeito moderno (tipo apps gringos SaaS)

Animações suaves (hover, fade, transições)

Layout espaçado e premium

💰 7. PLANOS (MONETIZAÇÃO)

Criar sistema de assinatura com:

Individual Mensal: R$ 17,90

Individual 6 meses: R$ 12,90 (mais vendido)

Individual 12 meses: R$ 9,98

Casal 6 meses: R$ 19,00

Casal 12 meses: R$ 14,98

REGRAS:

Mostrar preço original riscado (dobro)

Mostrar "50% OFF"

Destaque no plano de 6 meses

🆓 8. TESTE GRÁTIS

7 dias grátis automático

Após isso, exigir pagamento

🔐 9. USUÁRIO

Cadastro (email + senha ou Google)

Vincular número do WhatsApp ao usuário

⚙️ 10. TECNOLOGIA

Frontend: React / Next.js

Backend: Node.js ou Firebase

Banco: PostgreSQL ou Firebase

🚀 11. DIFERENCIAL (MUITO IMPORTANTE)

O app NÃO deve parecer apenas um gerenciador financeiro comum.

Ele deve deixar claro que:

👉 O controle acontece pelo WhatsApp
👉 O dashboard é o complemento visual

Adicionar na interface:

Simulação de chat:

Usuário: "Gastei 50 no mercado"
BrinZap: "Registrado em Alimentação ✅"

🎯 OBJETIVO FINAL:

Criar um produto SaaS premium, simples, altamente escalável e com forte diferencial competitivo, focado em aquisição rápida de usuários e retenção.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://agenteabio.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/aac711e9-4a90-40c4-8d46-cc953ada334b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
