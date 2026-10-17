# Nuvora Web

Versão web do Nuvora, com a mesma experiência do aplicativo mobile. Usa o mesmo projeto Supabase
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
| `/app/financas` | Em breve |
| `/app/configuracoes` | Conta, sincronização e segurança |
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

## Diferenças em relação ao aplicativo

- **Lembrete diário:** no navegador o aviso só aparece enquanto o site estiver aberto. No app, ele é agendado no celular.
- **Login com Google:** na web é um redirecionamento da própria página; no app abre um navegador interno.
- **Dados sem conta:** como no app, para salvar agenda, rotina, tarefas e conversas é preciso entrar na conta.

## Estrutura

```
src/
├── App.tsx                 rotas
├── main.tsx                ponto de entrada
├── components/             menu lateral, modal de login, casca do app, caixas de diálogo
├── pages/                  telas (Chat, Home, Agenda, Rotina, Configurações, Termos...)
├── store/                  auth.ts (sessão), data.ts (dados e sincronização), ui.ts (menu)
├── lib/                    Supabase, assistente, datas, lembretes, autenticação
├── legal/termos.html       conteúdo dos Termos e da Política de Privacidade
└── styles/                 tema (cores do app), estilos gerais e da página de termos
public/nexo-logo.png        logo do Nuvora
```
