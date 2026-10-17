import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { Modal } from './ui';
import { useAuthStore } from '../store/auth';
import { useFinanceStore } from '../store/finance';
import { CATEGORY_COLORS, type TransactionType } from '../lib/finance';
import { confirmAction } from '../lib/confirm';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Lista, cria e apaga as categorias do usuário. */
export default function CategoryManager({ open, onClose }: Props) {
  const categories = useFinanceStore((s) => s.categories);
  const addCategory = useFinanceStore((s) => s.addCategory);
  const removeCategory = useFinanceStore((s) => s.removeCategory);
  const requireAuth = useAuthStore((s) => s.requireAuth);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<TransactionType>('expense');
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [error, setError] = useState('');

  const add = (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) { setError('Dê um nome para a categoria.'); return; }
    if (categories.some((c) => c.name.toLowerCase() === clean.toLowerCase() && c.kind === kind)) {
      setError('Já existe uma categoria com esse nome.');
      return;
    }
    if (categories.length >= 40) { setError('Você atingiu o limite de 40 categorias.'); return; }
    requireAuth(() => {
      addCategory(clean, color, kind);
      setName('');
      setError('');
    });
  };

  const remove = async (id: string, label: string) => {
    const ok = await confirmAction({
      title: 'Apagar categoria?',
      message: `“${label}” será removida. Os lançamentos dessa categoria continuam salvos, mas ficam sem categoria.`,
      confirmText: 'Apagar',
      danger: true,
    });
    if (ok) requireAuth(() => removeCategory(id));
  };

  return (
    <Modal open={open} onClose={onClose} title="Categorias">
      {open ? (
        <>
          <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
            {categories.map((c) => (
              <div key={c.id} className="row gap-md" style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                <span className="grow" style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>{c.kind === 'income' ? 'Receita' : 'Despesa'}</span>
                <button type="button" className="icon-btn ghost sm" onClick={() => { void remove(c.id, c.name); }} aria-label={`Apagar categoria ${c.name}`}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {categories.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>Nenhuma categoria ainda.</p> : null}
          </div>

          <form onSubmit={add} style={{ display: 'grid', gap: 10, marginTop: 6 }}>
            <p className="section-title" style={{ fontSize: 15 }}>Nova categoria</p>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" maxLength={40} />
            <div className="row gap-sm">
              {(['expense', 'income'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="grow"
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
                  style={{
                    minHeight: 40, borderRadius: 11, fontWeight: 600, fontSize: 14,
                    background: kind === value ? 'var(--accent-soft)' : 'var(--bg)',
                    border: `1px solid ${kind === value ? 'var(--accent)' : 'var(--border)'}`,
                    color: kind === value ? 'var(--accent)' : 'var(--text-2)',
                  }}
                >
                  {value === 'income' ? 'Receita' : 'Despesa'}
                </button>
              ))}
            </div>
            <div className="row gap-sm" style={{ flexWrap: 'wrap' }} role="radiogroup" aria-label="Cor">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Cor ${c}`}
                  onClick={() => setColor(c)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', background: c,
                    border: color === c ? '3px solid var(--text)' : '2px solid var(--border)',
                  }}
                />
              ))}
            </div>
            {error ? <p className="error">{error}</p> : null}
            <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Criar categoria</motion.button>
          </form>
        </>
      ) : null}
    </Modal>
  );
}
