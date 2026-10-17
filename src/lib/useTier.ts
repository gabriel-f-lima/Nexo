import { useEffect, useState } from 'react';
import { currentTier, type Tier } from './billing';

/** Nível da conta (free, basico ou pro). Retorna 'loading' enquanto consulta. */
export const useTier = (userId?: string): Tier | 'loading' => {
  const [tier, setTier] = useState<Tier | 'loading'>('loading');

  useEffect(() => {
    if (!userId) {
      setTier('free');
      return;
    }
    let alive = true;
    setTier('loading');
    currentTier(userId)
      .then((value) => { if (alive) setTier(value); })
      .catch(() => { if (alive) setTier('free'); });
    return () => { alive = false; };
  }, [userId]);

  return tier;
};
