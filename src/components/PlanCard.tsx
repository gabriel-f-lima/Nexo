import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CreditCard, Crown } from 'lucide-react';
import { loadSubscription, openBillingPortal, startCheckout, type Interval, type Subscription } from '../lib/billing';
import { notify } from '../lib/toast';
import { formatLongDate } from '../lib/dates';

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  trialing: 'Período de teste',
  past_due: 'Pagamento pendente',
  unpaid: 'Não pago',
  canceled: 'Cancelado',
  incomplete: 'Pagamento não concluído',
  none: 'Gratuito',
};

/** Estado do plano e botões para assinar ou gerenciar a assinatura. */
export default function PlanCard({ userId }: { userId: string }) {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Interval | 'portal' | null>(null);
  const [params, setParams] = useSearchParams();

  const refresh = () => loadSubscription(userId)
    .then((data) => setSub(data))
    .catch(() => setSub(null))
    .finally(() => setLoading(false));

  useEffect(() => {
    void refresh();
    const checkout = params.get('checkout');
    if (checkout) {
      if (checkout === 'success') notify('Pagamento recebido. Seu plano será atualizado em instantes.', 'success');
      if (checkout === 'cancel') notify('Pagamento cancelado. Nenhuma cobrança foi feita.', 'info');
      setParams({}, { replace: true });
      // Dá um tempo para o webhook da Stripe atualizar o status.
      window.setTimeout(() => { void refresh(); }, 3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const active = sub?.status === 'active' || sub?.status === 'trialing';
  const label = STATUS_LABEL[sub?.status ?? 'none'] ?? sub?.status ?? 'Gratuito';

  const pick = async (interval: Interval) => {
    setBusy(interval);
    try {
      await startCheckout(interval);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível iniciar o pagamento.', 'error');
      setBusy(null);
    }
  };

  const manage = async () => {
    setBusy('portal');
    try {
      await openBillingPortal();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível abrir o portal.', 'error');
      setBusy(null);
    }
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="row between">
        <div className="row gap-md">
          <div className="icon-btn sm"><Crown size={16} /></div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Plano Nuvora</div>
            <div className="text-2" style={{ fontSize: 12 }}>{loading ? 'Carregando…' : label}</div>
          </div>
        </div>
        {active && sub?.interval ? (
          <span className="tag-soon" style={{ marginLeft: 0 }}>{sub.interval === 'year' ? 'Anual' : 'Mensal'}</span>
        ) : null}
      </div>

      {active && sub?.current_period_end ? (
        <p className="text-2" style={{ fontSize: 13, lineHeight: 1.5 }}>
          {sub.cancel_at_period_end
            ? `Assinatura encerra em ${formatLongDate(new Date(sub.current_period_end))}.`
            : `Próxima renovação em ${formatLongDate(new Date(sub.current_period_end))}.`}
        </p>
      ) : null}

      {!loading && !active ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <motion.button type="button" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block" disabled={busy !== null} onClick={() => pick('monthly')}>
            <CreditCard size={17} /> {busy === 'monthly' ? 'Abrindo pagamento…' : 'Assinar mensal'}
          </motion.button>
          <motion.button type="button" whileTap={{ scale: 0.98 }} className="btn btn-ghost btn-block" disabled={busy !== null} onClick={() => pick('yearly')}>
            {busy === 'yearly' ? 'Abrindo pagamento…' : 'Assinar anual'}
          </motion.button>
        </div>
      ) : null}

      {!loading && sub && sub.status !== 'none' ? (
        <motion.button type="button" whileTap={{ scale: 0.98 }} className="btn btn-ghost btn-block" disabled={busy !== null} onClick={manage}>
          {busy === 'portal' ? 'Abrindo…' : 'Gerenciar assinatura e faturas'}
        </motion.button>
      ) : null}
    </div>
  );
}
