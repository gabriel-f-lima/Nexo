import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { LIMITS, loadPlanPrices, PLANS, startCheckout, type Interval, type PlanId, type PlanPrice } from '../lib/billing';
import { formatMoney, type Currency } from '../lib/finance';
import { notify } from '../lib/toast';

/** Escolha de plano: alterna mensal e anual, mostra os valores da Stripe e os benefícios. */
export default function Plans() {
  const [prices, setPrices] = useState<PlanPrice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [cycle, setCycle] = useState<Interval>('yearly');
  const [busy, setBusy] = useState<PlanId | null>(null);

  useEffect(() => {
    let alive = true;
    loadPlanPrices()
      .then((list) => { if (alive) setPrices(list); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const find = (plan: PlanId, interval: Interval) =>
    prices?.find((p) => p.plan === plan && p.interval === interval) ?? null;

  const choose = async (plan: PlanId) => {
    setBusy(plan);
    try {
      await startCheckout(plan, cycle);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível iniciar o pagamento.', 'error');
      setBusy(null);
    }
  };

  return (
    <div className="plans">
      <p className="plans-note">No plano gratuito: até {LIMITS.free.habits} metas de rotina e {LIMITS.free.eventsPerDay} compromissos por dia.</p>
      <div className="plans-toggle" role="tablist" aria-label="Período de cobrança">
        {(['monthly', 'yearly'] as Interval[]).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={cycle === option}
            className={`plans-toggle-btn${cycle === option ? ' is-active' : ''}`}
            onClick={() => setCycle(option)}
          >
            {option === 'monthly' ? 'Mensal' : 'Anual'}
          </button>
        ))}
      </div>

      {failed ? <p className="plans-note">Não foi possível carregar os planos agora. Tente novamente em instantes.</p> : null}

      {!failed && !prices ? (
        <div className="plans-grid">
          {PLANS.map((plan) => <div key={plan.id} className="plan-card plan-skeleton" />)}
        </div>
      ) : null}

      {prices ? (
        <div className="plans-grid">
          {PLANS.map((plan, index) => {
            const option = find(plan.id, cycle);
            const monthly = find(plan.id, 'monthly');
            const yearly = find(plan.id, 'yearly');
            const save = monthly && yearly
              ? Math.round((1 - yearly.amountCents / (monthly.amountCents * 12)) * 100)
              : 0;
            const currency = (option?.currency ?? 'BRL') as Currency;

            return (
              <motion.article
                key={plan.id}
                className={`plan-card${plan.highlight ? ' is-featured' : ''}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                {plan.highlight ? <span className="plan-badge">Mais escolhido</span> : null}

                <div>
                  <h3 className="plan-name">{plan.name}</h3>
                  <p className="plan-tagline">{plan.tagline}</p>
                </div>

                <div className="plan-price-row">
                  <span className="plan-price">{option ? formatMoney(option.amountCents, currency) : '—'}</span>
                  {option ? <span className="plan-period">{cycle === 'yearly' ? '/ano' : '/mês'}</span> : null}
                </div>

                <div className="plan-meta">
                  {cycle === 'yearly' && option
                    ? <span>≈ {formatMoney(Math.round(option.amountCents / 12), currency)} por mês</span>
                    : <span>Cobrado todo mês</span>}
                  {cycle === 'yearly' && save > 0 ? <span className="plan-chip">Economize {save}%</span> : null}
                </div>

                <ul className="plan-benefits">
                  {plan.benefits.map((item) => (
                    <li key={item}><Check size={15} /><span>{item}</span></li>
                  ))}
                </ul>

                <button
                  type="button"
                  disabled={!option || busy !== null}
                  className={`btn btn-block ${plan.highlight ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => choose(plan.id)}
                >
                  {!option ? 'Indisponível' : busy === plan.id ? 'Abrindo pagamento…' : `Assinar ${plan.name}`}
                </button>
              </motion.article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
