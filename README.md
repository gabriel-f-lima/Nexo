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
| `/app/home` | Visão geral do dia |
| `/app/agenda` | Agenda mensal |
| `/app/rotina` | Hábitos, semana e sequências |
| `/app/financas` | Controle financeiro (planos pagos) |
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

## Build e publicação

```bash
npm run build      # gera a pasta dist/
```

A pasta `dist/` pode ser publicada na Vercel (já há `vercel.json`) ou na Netlify (já há `public/_redirects`).
Em ambos, as rotas são reescritas para `index.html`, o que permite abrir `/app/chat` ou `/termos` diretamente.

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
- **Pagamentos:** o app só redireciona para `checkout.stripe.com` e `billing.stripe.com`.
- **Exportação:** células do CSV que começam com `=`, `+`, `-` ou `@` são gravadas como texto (evita fórmulas maliciosas no Excel).

## Notificações na web

Em Configurações (ou no cartão Notificações do menu) dá para ligar o **lembrete diário**, escolher o horário
e receber **avisos antes dos compromissos**. Sem um servidor de push, os avisos só chegam enquanto o Nexo
estiver aberto em alguma aba do navegador (pode estar minimizada). O `public/sw.js` exibe a notificação do
sistema e, ao clicar nela, abre a tela certa do app. As preferências ficam salvas só naquele navegador.

## Diferenças em relação ao aplicativo

- **Lembretes:** no navegador os avisos só aparecem enquanto o site estiver aberto. No app, eles são agendados no celular.
- **Login com Google:** na web é um redirecionamento da própria página; no app abre um navegador interno.
- **Dados sem conta:** como no app, para salvar agenda, rotina, tarefas e conversas é preciso entrar na conta.

## Estrutura

```
src/
├── App.tsx                 rotas
├── main.tsx                ponto de entrada
├── components/             menu lateral, modal de login, casca do app, caixas de diálogo
├── pages/                  telas (Chat, Home, Agenda, Rotina, Configurações, Termos...)
├── store/                  auth.ts (sessão), data.ts (dados e sincronização), ui.ts (menu e janelas)
├── lib/                    Supabase, assistente (streaming), datas, notificações, autenticação
├── legal/termos.html       conteúdo dos Termos e da Política de Privacidade
└── styles/                 tema (cores do app), estilos gerais e da página de termos
public/nexo-logo.png        logo do Nexo
public/sw.js                service worker das notificações
public/_headers             cabeçalhos de segurança (Netlify)
```
