import { useEffect, useRef, useState } from 'react';
import { currentTier, TIER_CHANGED_EVENT, type Tier } from './billing';

/**
 * Nível da conta (free, basico ou pro), sempre informado pelo servidor. Retorna 'loading' enquanto consulta.
 * Em caso de erro, fica no gratuito: nada pago é liberado sem confirmação.
 */
export const useTier = (userId?: string): Tier | 'loading' => {
  const [tier, setTier] = useState<Tier | 'loading'>('loading');
  const [version, setVersion] = useState(0);
  const lastUser = useRef<string | undefined>(undefined);

  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1);
    window.addEventListener(TIER_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TIER_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!userId) {
      lastUser.current = undefined;
      setTier('free');
      return;
    }
    let alive = true;
    // Só mostra "carregando" ao trocar de conta; ao reconsultar a mesma conta, mantém o valor até a resposta.
    if (lastUser.current !== userId) setTier('loading');
    lastUser.current = userId;
    currentTier(userId)
      .then((value) => { if (alive) setTier(value); })
      .catch(() => { if (alive) setTier('free'); });
    return () => { alive = false; };
  }, [userId, version]);

  return tier;
};
