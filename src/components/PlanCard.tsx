import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crown } from 'lucide-react';
import Plans from './Plans';
import {
  announceTierChange, LIMITS, loadSubscription, openBillingPortal, PLANS, syncSubscription, waitForPaidTier, type Subscription,
} from '../lib/billing';
import { notify } from '../lib/toast';
import { formatLongDate } from '../lib/dates';
import '../styles/plans.css';

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
  const [confirming, setConfirming] = useState(false);
  const [params, setParams] = useSearchParams();

  const refresh = () => loadSubscription(userId)
    .then((data) => setSub(data))
    .catch(() => setSub(null))
    .finally(() => setLoading(false));

  useEffect(() => {
    let alive = true;
    const checkout = params.get('checkout');
    if (checkout) setParams({}, { replace: true });

    if (checkout === 'success') {
      // O endereço de retorno não prova pagamento: o plano só aparece depois que o servidor confirma com a Stripe.
      setConfirming(true);
      void waitForPaidTier(userId).then((tier) => {
        if (!alive) return;
        setConfirming(false);
        void refresh();
        if (tier === 'free') {
          notify('A Stripe ainda está confirmando seu pagamento. Isso pode levar alguns minutos; atualize esta página depois.', 'info');
          return;
        }
        notify(`Plano ${PLANS.find((p) => p.id === tier)?.name ?? ''} ativado!`, 'success');
        announceTierChange();
      });
    } else {
      if (checkout === 'cancel') notify('Pagamento cancelado. Nenhuma cobrança foi feita.', 'info');
      // Confere o plano direto na Stripe antes de mostrar o status.
      void syncSubscription().finally(() => { if (alive) void refresh(); });
    }
    return () => { alive = false; };
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

  if (confirming) {
    return <div className="card text-2" role="status" style={{ fontSize: 13 }}>Confirmando seu pagamento com a Stripe…</div>;
  }
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
                <div style={{ fontWeight: 700, fontSize: 15 }}>{planName ? `Plano ${planName}` : 'Plano Nexo'}</div>
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
