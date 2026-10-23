# Nexo Web

Versão web do Nexo, com a mesma experiência do aplicativo mobile. Usa o mesmo projeto Supabase
(tabelas, RLS e função `nexo-assistant`), então os dados da conta aparecem nos dois lugares.

## Rotas

| Rota | Conteúdo |
| --- | --- |
| `/` | Página inicial pública |
| `/termos` | Termos de Uso e Política de Privacidade |
| `/app` | Aplicativo (abre no assistente) |
| `/app/chat` | Assistente de IA, com histórico e conversas importantes |
| `/app/home` | Meu dia: saldo, contas que vencem, agenda, hábitos, tarefas, coach e resumo da semana |
| `/app/agenda` | Agenda mensal |
| `/app/rotina` | Hábitos, semana, sequências e metas de sequência |
| `/app/financas` | Financeiro (planos pagos): saldo, cartões e faturas, contas, orçamentos e gráficos |
| `/app/metas` | Objetivos (dinheiro + agenda + rotina), metas de sequência e metas financeiras |
| `/app/conquistas` | Nível, conquistas, sequências e saúde financeira |
| `/app/configuracoes` | Conta, notificações, sincronização e segurança |
| `/app/ajuda` | Guias e suporte |
| `/app/perfil` | Dados do perfil |

## Como rodar

```bash
npm install
cp .env.example .env     # preencha com a URL e a publishable key do Supabase
npm run dev
```

Abra http://localhost:5173.

## Configuração do Supabase para a web

Em **Authentication → URL Configuration → Redirect URLs**, adicione:

- `http://localhost:5173/**` (desenvolvimento)
- `https://SEU-DOMINIO/**` (produção)

O login com Google continua usando a URL de callback do Supabase no Google Cloud
(`https://SEU-PROJETO.supabase.co/auth/v1/callback`). Não é preciso adicionar a URL do site lá.

## Testes e verificação

```bash
npm run test       # testes (Vitest)
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm run check      # os três juntos
```

O `npm run build` roda o `check` antes de gerar o site: se um teste ou o lint falhar, o deploy para.
Para gerar sem as verificações (só em emergência), use `npm run build:only`.

## Build e publicação

```bash
npm run build      # confere e gera a pasta dist/
```

A pasta `dist/` pode ser publicada na Vercel (já há `vercel.json`) ou na Netlify (já há `public/_redirects`).
Em ambos, as rotas são reescritas para `index.html`, o que permite abrir `/app/chat` ou `/termos` diretamente.

## Atualização 1.4: o que publicar

1. **Banco:** aplique as migrations novas (`supabase db push`), nesta ordem:
   - `20261023120000_nexo_planning.sql`: preferências sincronizadas, cartões e pagamentos de fatura, contas a pagar,
     colunas novas em `nexo_transactions` (cartão, parcelas, conta paga), orçamentos, objetivos, metas de sequência e conquistas.
   - `20261023130000_nexo_whatsapp.sql`: base da integração com WhatsApp (pode aplicar mesmo sem usar).
   - `20261024120000_nexo_whatsapp_paid.sql`: o WhatsApp passa a exigir plano pago (Básico ou Pro) para vincular.
   As tabelas novas têm RLS; o que é financeiro só pode ser criado ou alterado em plano pago, como os lançamentos.
   Se o site for publicado antes da migration, as telas novas mostram um aviso e o resto continua funcionando.
2. **Função do assistente:** `supabase functions deploy nexo-assistant`. O site pede as ferramentas novas
   (`toolset: "web-2"`); o app mobile continua recebendo as mesmas de antes.
3. **Site:** publique o `dist/`.
4. **WhatsApp (opcional, futuro):** veja [docs/whatsapp.md](docs/whatsapp.md).

### Recursos novos

- **Registro rápido:** em Meu dia e no Financeiro, escreva “gastei 45 no mercado ontem” ou “dentista terça às 15h”.
  O Nexo mostra o que entendeu (valor, categoria, data, cartão e parcelas, ou data e hora) antes de salvar.
  O assistente também registra direto quando recebe esse tipo de frase.
- **Financeiro:** saldo disponível (receitas menos despesas à vista e faturas pagas), ajuste de saldo, cartões com
  dia de fechamento e vencimento (cada compra cai na fatura certa, inclusive parcelada), pagamento de fatura total
  ou parcial, contas a pagar mensais ou únicas, orçamento por categoria com projeção do fim do mês.
- **Coach:** avisos como “nesse ritmo você estoura o orçamento de Lazer no dia 22” ou “faltam R$ 300 para a meta,
  que tal guardar R$ 75 por semana?”, contas e faturas vencendo, limite do cartão e sequências em risco.
- **Resumo da semana:** os últimos 7 dias comparados com os 7 anteriores (gastos, categoria que mais mudou, hábitos,
  compromissos de amanhã). Aparece no Meu dia e como notificação às segundas.
- **Objetivos:** juntam uma meta financeira, um compromisso e hábitos de apoio (ex.: “Viagem em julho”), com progresso,
  ritmo e o próximo passo.
- **Gamificação:** metas de sequência, 20 conquistas com pontos e nível, sequência geral e nota de saúde financeira.
- **Notificações:** além do lembrete diário e dos compromissos, avisos de contas e faturas, dicas do coach e resumo
  semanal. As preferências ficam salvas na conta e valem em todos os aparelhos.

## Função do assistente (`nexo-assistant`)

A versão desta pasta responde aos poucos (streaming) para a web e continua devolvendo JSON para o app mobile.
Ela também confirma no Supabase Auth que quem chama tem sessão de usuário e recusa mensagens com papéis
como `system`. Para publicar:

```bash
supabase functions deploy nexo-assistant
```

Enquanto a versão antiga estiver publicada, o site continua funcionando: a resposta chega inteira e é
"digitada" na tela. Publique sempre a partir desta pasta (a cópia do projeto mobile é mais antiga).

## Segurança

- **Política de conteúdo (CSP):** gerada no build a partir de `VITE_SUPABASE_URL` e colocada no `index.html`.
  Só permite scripts do próprio site e conexões com o projeto Supabase configurado.
- **Cabeçalhos HTTP:** `vercel.json` e `public/_headers` (Netlify) bloqueiam o site dentro de iframes,
  ativam HSTS e desligam câmera, microfone e localização. O `npm run preview` usa os mesmos cabeçalhos.
- **Pagamentos:** o app só redireciona para `checkout.stripe.com` e `billing.stripe.com`. O plano é decidido só no
  servidor e os recursos pagos são conferidos no banco. Detalhes e passo a passo em
  [Pagamentos: proteção contra burla e abuso](#pagamentos-proteção-contra-burla-e-abuso).
- **Exportação:** células do CSV que começam com `=`, `+`, `-` ou `@` são gravadas como texto (evita fórmulas maliciosas no Excel).
  A planilha usa a SheetJS 0.20.3 do CDN oficial da SheetJS (a versão do npm, 0.18.5, tem falhas conhecidas e não recebe correções).

## Notificações na web

Em Configurações (ou no cartão Notificações do menu) dá para ligar o **lembrete diário**, escolher o horário
e receber **avisos antes dos compromissos**. Sem um servidor de push, os avisos só chegam enquanto o Nexo
estiver aberto em alguma aba do navegador (pode estar minimizada). O `public/sw.js` exibe a notificação do
sistema e, ao clicar nela, abre a tela certa do app. Também há avisos de contas e faturas, dicas do coach e o resumo
da semana. As preferências ficam no navegador e na conta (tabela `nexo_preferences`), então valem nos outros
aparelhos; a permissão de notificação é dada em cada navegador.

## Diferenças em relação ao aplicativo

- **Lembretes:** no navegador os avisos só aparecem enquanto o site estiver aberto. No app, eles são agendados no celular.
- **Login com Google:** na web é um redirecionamento da própria página; no app abre um navegador interno.
- **Dados sem conta:** como no app, para salvar agenda, rotina, tarefas e conversas é preciso entrar na conta.

## Estrutura

```
src/
├── App.tsx                 rotas
├── routes.ts               telas carregadas sob demanda (React.lazy)
├── main.tsx                ponto de entrada
├── components/             menu lateral, modal de login, casca do app, caixas de diálogo
│   ├── finance/            abas do financeiro (cartões, contas, orçamentos, gráficos)
│   ├── goals/              objetivos e metas de sequência
│   └── planning/           registro rápido, coach, abas e anel de progresso
├── pages/                  telas (Chat, Meu dia, Agenda, Rotina, Financeiro, Metas, Conquistas...)
├── store/                  auth, data (agenda, rotina, conversas), finance, progress (objetivos e conquistas), ui
├── lib/                    regras puras com testes (*.test.ts): cartões, contas, saldo, coach, resumo, conquistas...
├── legal/termos.html       conteúdo dos Termos e da Política de Privacidade
└── styles/                 base, layout, controles, listas, janelas + um arquivo por tela (chat, landing, planning...)
public/nexo-logo.png        logo do Nexo
public/sw.js                service worker das notificações
public/_headers             cabeçalhos de segurança (Netlify)
supabase/migrations/        tabelas, RLS e funções do banco
supabase/optional/          SQL extra que só deve rodar depois de conferir o app mobile
supabase/functions/         Edge Functions (assistente, pagamentos, exclusão de conta)
supabase/functions/_shared/ código comum (CORS, rate limit, Stripe e o leitor de frases quickEntry.ts, usado também pelo site)
docs/whatsapp.md            como ligar a integração com WhatsApp
```

## Pagamentos: proteção contra burla e abuso

### Como funciona agora

1. O navegador pede o checkout informando só **plano** (`basico`/`pro`) e **intervalo** (`monthly`/`yearly`).
   O servidor escolhe o preço numa lista própria (secrets `STRIPE_PRICE_*`); nenhum ID de preço vem do navegador.
2. A Stripe confirma o pagamento e avisa o webhook. O webhook confere a assinatura do evento, **relê a assinatura
   direto na Stripe** e grava em `nexo_subscriptions`. Só o servidor escreve nessa tabela.
3. O nível da conta (`free`, `basico`, `pro`) é calculado no banco por `nexo_my_tier()`. A mesma regra vale para as
   telas e para as políticas do banco: um usuário gratuito não consegue gravar lançamentos nem metas, mesmo chamando
   a API do Supabase direto. Os limites de 50 lançamentos por mês e de 10 metas do Básico também são conferidos no banco.
4. Ao voltar do checkout, o site não mostra nada como "pago" por conta própria: fica em "Confirmando seu pagamento"
   e pergunta ao servidor até a Stripe confirmar.

### Riscos encontrados e o que foi corrigido

| Gravidade | Risco encontrado | Correção |
| --- | --- | --- |
| Crítica | `nexo_transactions` e `nexo_goals` aceitavam escrita de qualquer conta logada. O bloqueio do financeiro existia só na tela: dava para usar o financeiro de graça chamando a API. | Novas políticas RLS: ler e apagar continuam do dono; criar e alterar exigem plano pago (`nexo_my_tier()`). |
| Alta | Limites do Básico (50 lançamentos por mês, 10 metas) só no navegador. | Gatilhos no banco com trava por usuário (pedidos simultâneos não passam do limite). |
| Alta | Webhook gravava o conteúdo do evento como chegava. Um `subscription.updated` atrasado depois de um `deleted` reativava uma assinatura cancelada. | O webhook relê a assinatura na Stripe; o banco ignora leituras mais antigas que a última gravada (`synced_at`). |
| Alta | Sem idempotência: reenvios da Stripe eram processados de novo. | Tabela `nexo_stripe_events` por `event.id` (novo, repetido ou em andamento). |
| Média | O plano caía para `metadata.plan` ou para "básico" quando o preço não era reconhecido. Qualquer assinatura ativa na mesma conta Stripe (outro produto, preço de teste) liberava o Básico. | Plano só a partir dos preços da lista. Preço desconhecido não libera nada e fica registrado (`unknown_price`). Preços antigos com assinantes vão em `STRIPE_LEGACY_PRICES`. |
| Média | Upgrade trocava o preço para o Pro mesmo se a cobrança da diferença falhasse (a assinatura ia para `past_due` e o cliente perdia até o Básico). | `payment_behavior: error_if_incomplete`: se a cobrança não passa, nada muda. O plano atual é conferido na Stripe, com trava contra clique duplo. |
| Média | Sem rate limit nem trava: robôs podiam criar clientes e sessões de checkout em massa, e cliques simultâneos criavam clientes duplicados. | Rate limit por IP e por usuário com bloqueio que dobra a cada reincidência, uma sessão de checkout aberta por usuário (reaproveitada), chaves de idempotência na Stripe. |
| Média | CORS `*` em todas as funções de pagamento. | CORS só para `APP_URL` (e `ALLOWED_ORIGINS`). Chamada de navegador de outra origem recebe 403. |
| Média | `stripe-prices` consultava a Stripe 4 vezes a cada visita, sem limite: dava para esgotar o limite da API da Stripe e derrubar os pagamentos. | Cache de 5 minutos e rate limit por IP. Só mostra preços ativos, recorrentes e no intervalo certo. |
| Baixa | Contas sem e-mail confirmado e anônimas podiam assinar; `APP_URL` não era validada; sem tempo limite no site; o aviso "Pagamento recebido" vinha só do parâmetro da URL. | E-mail confirmado obrigatório para cobrar, `APP_URL` só com https, timeout de 20 s com mensagens claras, nenhum estado pago sem confirmação do servidor. |

Outras proteções:

- **Erros:** as funções devolvem só mensagens prontas para o usuário (e um `code`). O detalhe técnico fica no log da função.
- **Instabilidade:** chamadas à Stripe têm tempo limite de 15 s e 2 novas tentativas automáticas. Se o controle de
  abuso ficar indisponível, o pagamento é recusado com "tente de novo" em vez de seguir sem proteção.
- **Fraude e contestação:** alertas antecipados de fraude do Radar e contestações (chargeback) ficam registrados em
  `nexo_security_events`. Com `STRIPE_FRAUD_AUTO_CANCEL=true`, a assinatura é cancelada na hora e o acesso pago sai junto.
- **Registro de tentativas suspeitas:** `nexo_security_events` guarda bloqueios por excesso de tentativas, captcha
  inválido, webhook com assinatura inválida, divergência de cliente/assinatura, preço desconhecido e falhas de cobrança
  no upgrade. Os registros são apagados após 90 dias. Nas tabelas de rate limit o IP fica só como hash.
- **Captcha (opcional):** Cloudflare Turnstile no checkout e no upgrade. Sem as chaves, fica desligado.

Limites de cada função (janela de 10 minutos; ao passar do limite, bloqueio que dobra a cada reincidência em 24 h, até 16x):

| Função | Por IP | Por usuário |
| --- | --- | --- |
| `stripe-checkout` | 20 (bloqueio de 30 min) | 8 (15 min) |
| `stripe-upgrade` | 30 (30 min) | prévia 20 (15 min), confirmação 5 (30 min) |
| `stripe-portal` | 30 (30 min) | 10 (15 min) |
| `stripe-sync` | 60 (30 min) | 15 (10 min) |
| `stripe-prices` | 60 (10 min) | — (pública) |

Riscos que continuam (aceitos):

- Exportação CSV/planilha e análises por trimestre, semestre e ano são calculadas no navegador com os dados do próprio
  usuário. Um assinante Básico que altere o JavaScript consegue vê-las. Não há perda de receita relevante; fechar
  isso exigiria gerar as exportações no servidor.
- Limites de hábitos e de compromissos por dia continuam só na tela, porque essas tabelas são do app mobile. O SQL
  pronto está em `supabase/optional/nexo_routine_limits.sql` (veja o passo 8).
- Categorias do financeiro continuam livres para todas as contas: são só rótulos e o app cria as sugeridas no primeiro acesso.
- O upgrade cobra o cartão salvo sem o cliente presente. Se o banco exigir 3D Secure, a cobrança é recusada e o
  cliente é orientado a usar "Gerenciar assinatura". Para aceitar 3DS no upgrade, libere a troca de plano no portal (passo 5).

### Passo a passo para colocar no ar

Faça tudo primeiro no **modo de teste** da Stripe e só depois repita com as chaves de produção.
A ordem importa: banco, depois funções, depois site.

**1. Banco (migration)**

Faça um backup e aplique a migration `supabase/migrations/20261021120000_nexo_billing_hardening.sql`
(com `supabase db push` ou colando no SQL Editor). Ela pode rodar mais de uma vez sem efeito colateral.

Atenção: depois dela, contas sem plano pago não gravam mais lançamentos nem metas, inclusive pelo app mobile.
Se o app mobile tiver o financeiro liberado para o plano gratuito, ele vai receber erro ao salvar.

**2. Secrets das funções** (Supabase → Edge Functions → Secrets, ou `supabase secrets set NOME=valor`)

| Secret | Obrigatório | Valor |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | sim | Chave secreta da Stripe (`sk_live_...`). Uma chave restrita (`rk_live_...`) também funciona; teste antes no modo de teste. |
| `STRIPE_WEBHOOK_SECRET` | sim | `whsec_...` do endpoint criado no passo 4. |
| `STRIPE_PRICE_BASICO_MONTHLY`, `STRIPE_PRICE_BASICO_YEARLY`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` | sim | IDs `price_...` dos quatro preços. |
| `APP_URL` | sim | Endereço do site com https, por exemplo `https://seu-dominio.com.br`. É a origem aceita no CORS e o retorno do checkout e do portal. |
| `ALLOWED_ORIGINS` | não | Outras origens aceitas, separadas por vírgula. Para testar localmente: `http://localhost:5173`. Domínios de preview da Vercel precisam entrar aqui. |
| `STRIPE_LEGACY_PRICES` | não | Preços antigos que ainda têm assinantes: `price_abc:basico,price_def:pro`. Sem isso, quem estiver num preço antigo volta ao gratuito. |
| `STRIPE_PORTAL_CONFIGURATION` | não | ID `bpc_...` de uma configuração do portal (passo 5). |
| `STRIPE_FRAUD_AUTO_CANCEL` | não (recomendado) | `true` cancela a assinatura na hora quando chega alerta de fraude do Radar ou contestação. |
| `STRIPE_REQUIRE_3DS` | não | `true` pede 3D Secure em todo checkout. Reduz fraude, mas aumenta desistência. |
| `TURNSTILE_SECRET_KEY` | não | Secret key do Turnstile (passo 7). |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem nas funções; não precisa criar.

**3. Publicar as funções** (a pasta `_shared` vai junto automaticamente)

```bash
supabase functions deploy stripe-checkout stripe-portal stripe-sync stripe-upgrade
```

```bash
supabase functions deploy stripe-prices stripe-webhook --no-verify-jwt
```

`stripe-webhook` é chamada pela Stripe, que não tem token do Supabase. `stripe-prices` é pública porque a tela de planos
aparece antes do login; ela tem rate limit próprio. As demais confirmam a sessão no próprio código. Se o projeto usa as
novas chaves do Supabase (`sb_publishable_...`) e o gateway recusar com 401, publique também com `--no-verify-jwt`:
a verificação da sessão continua dentro de cada função.

**4. Webhook na Stripe** (Developers → Webhooks → Add endpoint)

- URL: `https://SEU-PROJETO.supabase.co/functions/v1/stripe-webhook`
- Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`,
  `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `radar.early_fraud_warning.created`,
  `charge.dispute.created`.
- Copie o "Signing secret" para `STRIPE_WEBHOOK_SECRET`. Use um endpoint e um secret para teste e outros para produção:
  a função recusa evento de teste com chave de produção (e o contrário).

**5. Portal do cliente** (Settings → Billing → Customer portal)

- Ative: atualizar forma de pagamento, histórico de faturas e cancelamento **no fim do período**.
- Troca de plano: deixe desligada ou liste só os dois produtos e os quatro preços do Nexo. Nunca libere alterar quantidade.
- Para fixar essa configuração, crie-a pela API ou pelo painel e coloque o ID em `STRIPE_PORTAL_CONFIGURATION`.

**6. Stripe Radar** (Radar → Rules)

O Checkout da Stripe já coleta os sinais do dispositivo e tem proteção própria contra teste de cartões. Recomendado:

- Manter ligadas as regras padrão: bloquear risco `highest` e bloquear quando o CVC falhar.
- Adicionar: `Request 3D Secure if :risk_level: = 'elevated'`.
- Com Radar for Fraud Teams: regras de velocidade (bloquear quando o mesmo e-mail, IP ou cliente tenta vários cartões
  diferentes em pouco tempo, escolhendo os atributos no editor de regras) e uma lista de domínios de e-mail descartáveis.
- Ao receber alerta antecipado de fraude, reembolse a cobrança no painel antes que vire contestação (a função só cancela
  a assinatura; ela não devolve dinheiro).

**7. Captcha (opcional, Cloudflare Turnstile)**

1. No painel da Cloudflare: Turnstile → Add widget → domínio do site (e `localhost`, se for testar) → modo "Managed".
2. Site key: variável `VITE_TURNSTILE_SITE_KEY` na Vercel (ou no `.env`) e publique o site de novo. A política de
   conteúdo passa a liberar `challenges.cloudflare.com` sozinha.
3. Secret key: secret `TURNSTILE_SECRET_KEY` no Supabase.
4. Ligue as duas juntas. Com só a secret, todo checkout é recusado; com só a site key, o token é ignorado.
5. Se o app mobile também chama `stripe-checkout` ou `stripe-upgrade`, ele precisa enviar `captchaToken` antes de você
   ligar o Turnstile.

**8. Supabase Auth e limites de rotina**

- Authentication → Sign In / Providers → Email: mantenha **Confirm email** ligado (o pagamento exige e-mail confirmado).
- Recomendado: ligar a proteção com captcha também no cadastro (Authentication → Attack Protection). Isso exige mudar
  o `AuthModal` para enviar o token; não está feito.
- Depois de confirmar que o app mobile aplica os mesmos limites (gratuito: 3 hábitos e 2 compromissos por dia;
  Básico: 10 e 5), rode `supabase/optional/nexo_routine_limits.sql` no SQL Editor.

**9. Testes antes de ir para produção** (modo de teste)

- Assinar com o cartão `4242 4242 4242 4242`: a tela mostra "Confirmando seu pagamento" e depois o plano ativo.
- Assine o Básico, troque o cartão no portal para `4000 0000 0000 0341` (é salvo, mas recusa cobranças) e tente o
  upgrade: deve aparecer a mensagem de pagamento não aprovado e o plano continua Básico.
- Cancelar no portal e conferir que o financeiro volta a ficar bloqueado quando o período acabar.
- Clicar várias vezes em "Assinar": deve abrir sempre a mesma sessão; depois de 8 tentativas em 10 minutos, aparece o aviso de espera.
- Para conferir a entrega e a assinatura do webhook: `stripe trigger customer.subscription.updated` (com o endpoint de
  teste cadastrado). O evento chega com resposta 200; como o cliente criado pelo comando não é do Nexo, nada muda no banco.

**10. Acompanhamento**

Tentativas suspeitas mais recentes (SQL Editor):

```sql
select created_at, source, kind, user_id, ip, detail
from public.nexo_security_events
order by created_at desc
limit 100;
```

A limpeza de registros antigos roda sozinha. Ao mudar limites em `src/lib/billing.ts` (`LIMITS`), mude também a função
`public.nexo_tier_limit` no banco.

**Impacto no app mobile:** as funções aceitam chamadas sem cabeçalho `Origin` (apps), mas agora exigem e-mail confirmado
para cobrar e, se o Turnstile estiver ligado, `captchaToken`. As respostas de erro ganharam o campo `code`;
`stripe-sync` devolve também `tier`; a confirmação do upgrade devolve `{ status, plan }`.
