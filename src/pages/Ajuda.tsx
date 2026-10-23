import { motion } from 'framer-motion';
import { Mail, Sun, CalendarDays, CheckSquare, Sparkles, Bell, Cloud, MessagesSquare } from 'lucide-react';
import { Header } from '../components/ui';

const TOPICS = [
  { icon: Sun, title: 'Organize seu dia', text: 'O resumo mostra o progresso das tarefas de hoje e das metas da rotina. Tarefas vencidas também aparecem até serem concluídas. Os compromissos são exibidos em ordem de horário.' },
  { icon: CalendarDays, title: 'Agenda', text: 'Abra Agenda para navegar pelo calendário e escolher uma data. Use o botão de adicionar para criar um compromisso; toque no dia para consultar os itens daquela data.' },
  { icon: CheckSquare, title: 'Rotina e metas', text: 'Crie hábitos em Rotina e selecione um dia da semana para conferir o histórico. Toque em uma meta para marcar como feita ou desfazer a conclusão.' },
  { icon: Sparkles, title: 'Assistente de IA', text: 'Faça perguntas gerais, peça uma pesquisa simples ou dê comandos para organizar tarefas, agenda e hábitos. Para criar ou alterar dados da conta, entre na sua conta.' },
  { icon: Bell, title: 'Lembretes', text: 'No menu, toque em Notificações (ou abra Configurações) para ligar o lembrete diário e os avisos antes dos compromissos. Na versão web, os avisos aparecem enquanto o Nexo estiver aberto em uma aba do navegador, mesmo minimizada.' },
  { icon: Cloud, title: 'Conta e sincronização', text: 'Entre na sua conta para sincronizar tarefas, agenda, rotina e conversas. Em Configurações, confira o estado da nuvem. Se houver erro, verifique a conexão.' },
  { icon: MessagesSquare, title: 'Conversas anteriores', text: 'Use o botão Histórico no topo do assistente para abrir as conversas anteriores; Nova conversa começa uma do zero. Conversas sem acesso por 15 dias são removidas automaticamente; uma conversa marcada como importante não expira.' },
];

/** Guias rápidos e canal de suporte, como na tela de Ajuda do app. */
export default function Ajuda() {
  return (
    <div className="screen">
      <Header title="Ajuda" subtitle="Guias rápidos para usar o Nexo" />

      <div className="screen-stack">
        <motion.div className="hero-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="section-title">Como podemos ajudar?</div>
          <p className="text-2" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
            Encontre instruções rápidas para organizar sua rotina e resolver dúvidas comuns.
          </p>
        </motion.div>

        {TOPICS.map((topic, index) => (
          <motion.div
            key={topic.title}
            className="card doc-card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
          >
            <div className="row gap-md">
              <div className="icon-btn sm"><topic.icon size={16} /></div>
              <h3>{topic.title}</h3>
            </div>
            <p>{topic.text}</p>
          </motion.div>
        ))}

        <div className="card card-soft" style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
          <div className="section-title" style={{ fontSize: 16 }}>Ainda precisa de ajuda?</div>
          <p className="text-2" style={{ fontSize: 13 }}>Fale com o suporte por e-mail.</p>
          <motion.a
            href="mailto:contato@app-nexo.online?subject=Ajuda%20com%20o%20Nexo"
            className="btn btn-primary btn-sm"
            whileTap={{ scale: 0.97 }}
            style={{ textDecoration: 'none' }}
          >
            <Mail size={16} /> Enviar e-mail
          </motion.a>
        </div>
      </div>
    </div>
  );
}
