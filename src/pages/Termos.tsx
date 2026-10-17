import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import legalHtml from '../legal/termos.html?raw';

/** Termos de Uso e Política de Privacidade, como rota do site. */
export default function Termos() {
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    document.title = 'Termos de Uso e Privacidade · Nuvora';

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.legal #toc a'));
    const targets = links
      .map((a) => document.querySelector(a.getAttribute('href') ?? ''))
      .filter((el): el is Element => el !== null);

    // Destaca no índice a seção que está visível.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`));
        });
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    targets.forEach((target) => observer.observe(target));

    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      document.title = 'Nuvora · Seu assistente pessoal';
    };
  }, []);

  return (
    <div className="legal">
      <header className="legal-top">
        <div className="legal-top-inner">
          <Link to="/" className="brand">
            <img src="/nexo-logo.png" alt="" width={34} height={34} />
            <span>Nuvora</span>
          </Link>
          <nav className="row gap-sm">
            <Link to="/" className="legal-back">Início</Link>
            <Link to="/app" className="btn btn-primary btn-sm">Abrir o app</Link>
          </nav>
        </div>
      </header>

      <div dangerouslySetInnerHTML={{ __html: legalHtml }} />

      <footer className="legal-footer">
        <div className="legal-footer-inner">
          <span>© 2026 Nuvora. Todos os direitos reservados.</span>
          <span className="footer-links">
            <Link to="/">Início</Link>
            <Link to="/app">Abrir o app</Link>
            <a href="mailto:g.ferreira.ldev@gmail.com">Contato</a>
          </span>
        </div>
      </footer>

      <button
        type="button"
        className={`to-top${showTop ? ' show' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Voltar ao topo"
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
}
