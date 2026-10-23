# Integração com WhatsApp (base)

A base já está no projeto, desligada. É um recurso dos planos pagos (Básico e Pro). Com ela ligada, quem tem plano pago pode:

- vincular o próprio número à conta (sem SMS: o código sai do site e volta pelo WhatsApp);
- mandar mensagens como “gastei 45 no mercado ontem”, “recebi 3000 de salário” ou “dentista terça às 15h”, que viram lançamento ou compromisso na conta;
- receber uma resposta confirmando o que foi anotado.

Compras no cartão de crédito, lembretes enviados pelo Nexo e conversa com o assistente de IA ainda não passam pelo WhatsApp (veja “Próximos passos”).

## Como funciona

| Peça | Onde |
| --- | --- |
| Tabelas `nexo_whatsapp_links` (número ↔ conta) e `nexo_whatsapp_messages` (só metadados, sem o texto) | `supabase/migrations/20261023130000_nexo_whatsapp.sql` |
| Gerar código de vínculo (`nexo_whatsapp_start_link`) e confirmar (`nexo_whatsapp_confirm_link`), só com plano pago | mesma migration e `20261024120000_nexo_whatsapp_paid.sql` |
| Webhook da Meta: verificação, assinatura, idempotência, vínculo e registro | `supabase/functions/whatsapp-webhook/index.ts` |
| Leitura das frases em português (a mesma do registro rápido do site) | `supabase/functions/_shared/quickEntry.ts` |
| Cartão “WhatsApp” em Configurações | `src/components/WhatsAppCard.tsx` |

Segurança:

- Toda requisição da Meta tem a assinatura `X-Hub-Signature-256` conferida com o App Secret. Assinatura inválida recebe 401 e fica registrada em `nexo_security_events`.
- Cada mensagem é processada uma vez (o id da Meta é a chave). Mensagens com mais de 10 minutos são ignoradas.
- Rate limit por número: 20 mensagens a cada 10 minutos; 5 tentativas de vínculo a cada 10 minutos.
- O código de vínculo tem 6 dígitos, vale 10 minutos, é guardado só como hash e só pode ser gerado a cada 30 segundos.
- Só planos pagos: gerar o código e confirmar o vínculo exigem plano Básico ou Pro (no banco), e a função confere o plano a cada mensagem. Quem cancelar depois de vincular recebe um aviso e nada é registrado; o vínculo continua e volta a funcionar se assinar de novo.
- Os limites do plano continuam valendo: o limite mensal de lançamentos do Básico e os compromissos por dia são conferidos pela função.

## Para ligar

1. Na Meta for Developers, crie um app do tipo Business com o produto WhatsApp e um número (pode ser o de teste).
2. Aplique as migrations `20261023130000_nexo_whatsapp.sql` e `20261024120000_nexo_whatsapp_paid.sql` (`supabase db push`).
3. Configure os segredos da função:

   ```bash
   supabase secrets set WHATSAPP_ENABLED=true WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=um-texto-longo-aleatorio WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...
   ```

   `WHATSAPP_GRAPH_VERSION` é opcional (padrão `v21.0`).

4. Publique a função sem verificação de JWT (a Meta não envia JWT; a segurança é a assinatura):

   ```bash
   supabase functions deploy whatsapp-webhook --no-verify-jwt
   ```

5. No painel da Meta, em WhatsApp > Configuração, informe a URL `https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-webhook` e o mesmo `WHATSAPP_VERIFY_TOKEN`. Assine o campo `messages`.
6. No site, defina `VITE_WHATSAPP_ENABLED=true` e `VITE_WHATSAPP_NUMBER` (só dígitos, com DDI) e publique de novo. O cartão “WhatsApp” aparece em Configurações (travado no plano gratuito) e o benefício entra na lista dos planos.

## Próximos passos sugeridos

- Lembretes e resumo semanal pelo WhatsApp: exigem modelos de mensagem aprovados pela Meta (mensagens iniciadas pela empresa fora da janela de 24 horas) e um agendador (cron do Supabase). A coluna `reminders_opt_in` já existe para o consentimento.
- Compras no cartão: levar `invoiceMonthFor` e `planInstallments` (`src/lib/cards.ts`) para `_shared`, como foi feito com o leitor de frases.
- Conversa com o assistente: encaminhar para a mesma lógica da função `nexo-assistant`, executando as ferramentas no servidor.
- Áudio: transcrever mensagens de voz antes de ler a frase.
