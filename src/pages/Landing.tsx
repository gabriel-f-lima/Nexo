import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Bell, CalendarDays, CheckSquare, Sparkles, Wallet, LayoutDashboard, ArrowRight, Check } from 'lucide-react';

const FEATURES = [
  { icon: Sparkles, title: 'Assistente com IA', text: 'Crie, consulte e remova compromissos, hábitos e tarefas conversando. Também pesquisa na web e indica as fontes.' },
  { icon: CalendarDays, title: 'Agenda', text: 'Veja os compromissos do dia, adicione novos e identifique os dias livres em um calendário mensal.' },
  { icon: CheckSquare, title: 'Rotina e hábitos', text: 'Crie hábitos simples, marque o que já foi feito e acompanhe a sequência de dias seguidos.' },
  { icon: LayoutDashboard, title: 'Seu dia em foco', text: 'Um resumo com o progresso das tarefas, os próximos compromissos e as metas da rotina.' },
  { icon: Bell, title: 'Lembretes diários', text: 'Escolha um horário e receba um aviso para conferir o seu dia.' },
  { icon: Wallet, title: 'Controle financeiro', text: 'Previsto para uma próxima versão.', soon: true },
];

const STEPS = [
  { title: 'Converse', text: 'Peça em linguagem natural: “adiciona uma reunião amanhã às 10h”.' },
  { title: 'Organize', text: 'O Nuvora cria, consulta e atualiza sua agenda, rotina e tarefas.' },
  { title: 'Acompanhe', text: 'Veja seu progresso no início e receba o lembrete do dia.' },
];

const reveal = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
};

/** Página inicial pública: apresenta o Nuvora e leva para o app e para os termos. */
export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link to="/" className="brand">
            <img src="/nexo-logo.png" alt="" width={34} height={34} />
            <span>Nuvora</span>
          </Link>
          <nav className="landing-links" aria-label="Seções">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#status">Status</a>
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
            O Nuvora cuida da sua agenda, da sua rotina e das suas tarefas. Diga o que precisa e ele organiza para você.
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
              <span>Nuvora</span>
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
              className={`feature-card${feature.soon ? ' soon' : ''}`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.06, duration: 0.45 }}
              whileHover={{ y: -4 }}
            >
              <div className="feature-icon"><feature.icon size={20} /></div>
              <h3>{feature.title} {feature.soon ? <span className="tag-soon">em breve</span> : null}</h3>
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

      <section id="status" className="landing-section">
        <motion.div {...reveal}>
          <span className="eyebrow">Status do projeto</span>
          <h2>Onde estamos</h2>
        </motion.div>
        <div className="status-grid">
          <motion.div className="card" {...reveal}>
            <h3 className="row gap-sm"><span className="dot-live" /> Pronto</h3>
            <ul className="check-list">
              <li><Check size={15} /> Login com e-mail, código por e-mail e Google</li>
              <li><Check size={15} /> Agenda, rotina, início e assistente com IA</li>
              <li><Check size={15} /> Lembrete diário e sincronização na nuvem</li>
            </ul>
          </motion.div>
          <motion.div className="card" {...reveal} transition={{ ...reveal.transition, delay: 0.1 }}>
            <h3 className="row gap-sm"><span className="dot-wait" /> Em andamento</h3>
            <p className="text-2" style={{ fontSize: 14, lineHeight: 1.6 }}>Ajustes finos de experiência e testes em diferentes dispositivos e navegadores.</p>
          </motion.div>
          <motion.div className="card" {...reveal} transition={{ ...reveal.transition, delay: 0.2 }}>
            <h3 className="row gap-sm"><span className="dot-wait" /> Próximas versões</h3>
            <p className="text-2" style={{ fontSize: 14, lineHeight: 1.6 }}>Módulo de controle financeiro e a versão mobile.</p>
          </motion.div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span>© 2026 Nuvora. Todos os direitos reservados.</span>
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
