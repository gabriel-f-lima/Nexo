import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crown } from 'lucide-react';
import Plans from './Plans';
import { LIMITS, loadSubscription, openBillingPortal, PLANS, syncSubscription, type Subscription } from '../lib/billing';
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

/** Estado do plano: status da assinatura atual, ou a escolha de planos para quem está no gratuito. */
export default function PlanCard({ userId }: { userId: string }) {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalBusy, setPortalBusy] = useState(false);
  const [params, setParams] = useSearchParams();

  const refresh = () => loadSubscription(userId)
    .then((data) => setSub(data))
    .catch(() => setSub(null))
    .finally(() => setLoading(false));

  useEffect(() => {
    // Confere o plano direto na Stripe antes de mostrar o status.
    void syncSubscription().finally(() => { void refresh(); });
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
  const hasSubscription = !!sub && sub.status !== 'none';
  const label = STATUS_LABEL[sub?.status ?? 'none'] ?? sub?.status ?? 'Gratuito';
  const planName = PLANS.find((item) => item.id === sub?.plan)?.name;

  const manage = async () => {
    setPortalBusy(true);
    try {
      await openBillingPortal();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível abrir o portal.', 'error');
      setPortalBusy(false);
    }
  };

  if (loading) {
    return <div className="card text-2" style={{ fontSize: 13 }}>Carregando seu plano…</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {hasSubscription ? (
        <div className="card plan-status">
          <div className="row between">
            <div className="row gap-md">
              <div className="icon-btn sm"><Crown size={16} /></div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{planName ? `Plano ${planName}` : 'Plano Nuvora'}</div>
                <div className="text-2" style={{ fontSize: 12 }}>{label}</div>
              </div>
            </div>
            {active && sub?.interval ? (
              <span className="plan-chip">{sub.interval === 'year' ? 'Anual' : 'Mensal'}</span>
            ) : null}
          </div>

          {active && sub?.current_period_end ? (
            <p className="text-2" style={{ fontSize: 13, lineHeight: 1.5 }}>
              {sub.cancel_at_period_end
                ? `Assinatura encerra em ${formatLongDate(new Date(sub.current_period_end))}.`
                : `Próxima renovação em ${formatLongDate(new Date(sub.current_period_end))}.`}
            </p>
          ) : null}

          <button type="button" className="btn btn-ghost btn-block" disabled={portalBusy} onClick={manage}>
            {portalBusy ? 'Abrindo…' : 'Gerenciar assinatura e faturas'}
          </button>
        </div>
      ) : null}

      {!active ? (
        <>
          {!hasSubscription ? (
            <div>
              <div className="section-title">Escolha seu plano</div>
              <div className="section-hint">
                No plano gratuito você tem até {LIMITS.free.habits} metas de rotina e {LIMITS.free.eventsPerDay} compromissos por dia. A gestão financeira é dos planos pagos.
              </div>
            </div>
          ) : null}
          <Plans />
        </>
      ) : null}
    </div>
  );
}
