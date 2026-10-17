import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function NotFound() {
  return (
    <div className="loading" style={{ padding: 24 }}>
      <motion.div className="card" style={{ maxWidth: 380, textAlign: 'center', display: 'grid', gap: 12, justifyItems: 'center' }} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
        <span className="eyebrow">Erro 404</span>
        <h1 style={{ fontSize: 24 }}>Página não encontrada</h1>
        <p className="text-2" style={{ fontSize: 14 }}>O endereço que você abriu não existe ou foi movido.</p>
        <Link to="/" className="btn btn-primary">Voltar para o início</Link>
      </motion.div>
    </div>
  );
}
