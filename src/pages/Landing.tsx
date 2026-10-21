import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Bell, CalendarDays, CheckSquare, Sparkles, Wallet, LayoutDashboard, ArrowRight, ChevronDown } from 'lucide-react';

const FEATURES = [
  { icon: Sparkles, title: 'Assistente com IA', text: 'Crie, consulte e remova compromissos, hábitos e tarefas conversando. Também pesquisa na web e indica as fontes.' },
  { icon: CalendarDays, title: 'Agenda', text: 'Veja os compromissos do dia, adicione novos e identifique os dias livres em um calendário mensal.' },
  { icon: CheckSquare, title: 'Rotina e hábitos', text: 'Crie hábitos simples, marque o que já foi feito e acompanhe a sequência de dias seguidos.' },
  { icon: LayoutDashboard, title: 'Seu dia em foco', text: 'Um resumo com o progresso das tarefas, os próximos compromissos e as metas da rotina.' },
  { icon: Bell, title: 'Lembretes e avisos', text: 'Receba um lembrete diário e avisos antes dos seus compromissos.' },
  { icon: Wallet, title: 'Controle financeiro', text: 'Registre receitas e despesas, acompanhe gráficos, crie metas e exporte para planilha. Nos planos pagos.' },
];

const STEPS = [
  { title: 'Converse', text: 'Peça em linguagem natural: “adiciona uma reunião amanhã às 10h”.' },
  { title: 'Organize', text: 'O Nexo cria, consulta e atualiza sua agenda, rotina e tarefas.' },
  { title: 'Acompanhe', text: 'Veja seu progresso no início e receba o lembrete do dia.' },
];

const FAQ = [
  { q: 'O Nexo é gratuito?', a: 'Sim. O plano gratuito inclui o assistente, a agenda, a rotina e os lembretes, com alguns limites. Os planos pagos liberam o controle financeiro e mais metas e compromissos.' },
  { q: 'Como o assistente cria tarefas e compromissos?', a: 'É só pedir na conversa, com os detalhes: “cria a tarefa comprar pão” ou “marca dentista amanhã às 15h”. Se faltar alguma informação, ele pergunta antes de salvar.' },
  { q: 'Meus dados ficam seguros?', a: 'Seus dados ficam na sua conta, protegidos por login, e só você tem acesso a eles. Conversas sem uso por 15 dias são apagadas automaticamente. Os detalhes estão nos Termos e na Política de Privacidade.' },
  { q: 'As notificações funcionam no navegador?', a: 'Sim, enquanto o Nexo estiver aberto em uma aba, mesmo minimizada. Você escolhe o horário do lembrete diário e quanto tempo antes dos compromissos quer ser avisado.' },
  { q: 'Posso usar no celular?', a: 'Pode. O site se adapta à tela do celular. O aplicativo para as lojas ainda não foi publicado.' },
];

const reveal = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
};

/** Página inicial pública: apresenta o Nexo e leva para o app e para os termos. */
export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link to="/" className="brand">
            <img src="/nexo-logo.png" alt="" width={34} height={34} />
            <span>Nexo</span>
          </Link>
          <nav className="landing-links" aria-label="Seções">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#perguntas">Perguntas</a>
            <Link to="/termos">Termos</Link>
          </nav>
          <Link to="/app" className="btn btn-primary btn-sm">Abrir o app</Link>
        </div>
      </header>

      <section className="landing-hero">
        <motion.div className="hero-copy" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          <span className="eyebrow">Assistente pessoal com IA</span>
          <h1>Seu dia organizado, <span className="accent-text">em uma conversa</span></h1>
          <p className="lead">
            O Nexo cuida da sua agenda, da sua rotina e das suas tarefas. Diga o que precisa e ele organiza para você.
          </p>
          <div className="hero-cta">
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
              <Link to="/app" className="btn btn-primary">Começar agora <ArrowRight size={18} /></Link>
            </motion.div>
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
              <Link to="/termos" className="btn btn-ghost">Termos e privacidade</Link>
            </motion.div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>Versão web. O aplicativo para celular ainda não foi publicado nas lojas.</p>
        </motion.div>

        <motion.div className="hero-preview" initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
          <div className="preview-card">
            <div className="preview-head">
              <img src="/nexo-logo.png" alt="" width={30} height={30} />
              <span>Nexo</span>
            </div>
            <motion.div className="pv-bubble user" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
              Quais compromissos tenho hoje?
            </motion.div>
            <motion.div className="pv-bubble ai" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.1 }}>
              Você tem reunião às 10h e dentista às 16h. Quer que eu adicione um lembrete?
            </motion.div>
            <motion.div className="pv-progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }}>
              <div className="row between" style={{ fontSize: 13 }}>
                <span className="text-2">Seu dia em foco</span>
                <strong style={{ color: 'var(--accent)' }}>3 / 5</strong>
              </div>
              <div className="track" style={{ marginTop: 8 }}>
                <motion.div className="fill" initial={{ width: 0 }} animate={{ width: '60%' }} transition={{ delay: 1.8, duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
              </div>
            </motion.div>
          </div>
        </motion.div>
      </section>

      <section id="recursos" className="landing-section">
        <motion.div {...reveal}>
          <span className="eyebrow">Recursos</span>
          <h2>Tudo o que você precisa para o dia</h2>
          <p className="lead">Use pela conversa com o assistente ou pelas telas do app.</p>
        </motion.div>
        <div className="feature-grid">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              className="feature-card"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.06, duration: 0.45 }}
              whileHover={{ y: -4 }}
            >
              <div className="feature-icon"><feature.icon size={20} /></div>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="landing-section">
        <motion.div {...reveal}>
          <span className="eyebrow">Como funciona</span>
          <h2>Três passos simples</h2>
        </motion.div>
        <ol className="steps">
          {STEPS.map((step, index) => (
            <motion.li
              key={step.title}
              className="step"
              initial={{ opacity: 0, x: -14 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.45 }}
            >
              <span className="step-num">{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </section>

      <section id="perguntas" className="landing-section">
        <motion.div {...reveal}>
          <span className="eyebrow">Perguntas frequentes</span>
          <h2>Tire suas dúvidas</h2>
        </motion.div>
        <div className="faq">
          {FAQ.map((item, index) => (
            <motion.details
              key={item.q}
              className="faq-item"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05, duration: 0.4 }}
            >
              <summary>
                <span>{item.q}</span>
                <ChevronDown size={18} className="faq-chev" aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </motion.details>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <motion.div className="cta-card" {...reveal}>
          <img src="/nexo-logo.png" alt="" width={56} height={56} />
          <div className="grow">
            <h2>Comece a organizar seu dia agora</h2>
            <p className="lead">Crie sua conta grátis e converse com o Nexo em poucos segundos.</p>
          </div>
          <Link to="/app" className="btn btn-primary">Abrir o Nexo <ArrowRight size={18} /></Link>
        </motion.div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span>© 2026 Nexo. Todos os direitos reservados.</span>
          <span className="footer-links">
            <Link to="/app">Abrir o app</Link>
            <Link to="/termos">Termos e privacidade</Link>
            <a href="mailto:g.ferreira.ldev@gmail.com">Contato</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
