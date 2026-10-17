import { useEffect, useState } from 'react';
import { Modal } from './ui';
import Plans from './Plans';
import { confirmUpgrade, loadPlanPrices, previewUpgrade, type PlanPrice, type UpgradePreview } from '../lib/billing';
import { formatMoney, type Currency } from '../lib/finance';
import { useTier } from '../lib/useTier';
import { notify } from '../lib/toast';
import { useAuthStore } from '../store/auth';

/** Aviso de limite. No Básico oferece o upgrade para o Pro; nos demais, mostra os planos. */
export default function Paywall({ open, onClose, title, message }: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
}) {
  const userId = useAuthStore((s) => s.user?.id);
  const tier = useTier(userId);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-2" style={{ fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>{message}</p>
      {tier === 'basico' ? <UpgradeToPro onDone={onClose} /> : <Plans />}
    </Modal>
  );
}

function UpgradeToPro({ onDone }: { onDone: () => void }) {
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [proPrice, setProPrice] = useState<PlanPrice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([previewUpgrade(), loadPlanPrices()])
      .then(([value, prices]) => {
        if (!alive) return;
        setPreview(value);
        const wanted = value.interval === 'year' ? 'yearly' : 'monthly';
        setProPrice(prices.find((p) => p.plan === 'pro' && p.interval === wanted) ?? null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Não foi possível calcular o valor.');
      });
    return () => { alive = false; };
  }, []);

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await confirmUpgrade();
      if (result.status === 'active' || result.status === 'trialing') {
        notify('Plano atualizado para o Pro!', 'success');
        onDone();
        window.location.reload();
      } else {
        notify('O pagamento não foi aprovado. Verifique o cartão e tente de novo.', 'error');
        setBusy(false);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível atualizar o plano.', 'error');
      setBusy(false);
    }
  };

  if (error) return <p className="plans-note">{error}</p>;
  if (!preview || !proPrice) return <div className="card text-2" style={{ fontSize: 13 }}>Calculando o valor…</div>;

  const currency = preview.currency as Currency;
  const period = preview.interval === 'year' ? 'ano' : 'mês';

  return (
    <div className="plan-card is-featured" style={{ gap: 14 }}>
      <div>
        <h3 className="plan-name">Atualize para o Pro</h3>
        <p className="plan-tagline">Você já é Básico. Pague só a diferença agora.</p>
      </div>
      <div className="upgrade-lines">
        <div className="upgrade-line">
          <span>Pagar hoje</span>
          <strong>{formatMoney(preview.amountNowCents, currency)}</strong>
        </div>
        <div className="upgrade-line">
          <span>Depois, a cada {period}</span>
          <strong>{formatMoney(proPrice.amountCents, currency)}</strong>
        </div>
      </div>
      <p className="plans-note" style={{ textAlign: 'left' }}>
        O valor de hoje é proporcional ao tempo que falta até a próxima renovação. A partir daí, você paga o valor cheio do Pro.
      </p>
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={confirm}>
        {busy ? 'Atualizando…' : 'Atualizar para o Pro'}
      </button>
    </div>
  );
}
