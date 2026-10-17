import type { User } from '@supabase/supabase-js';

/** Nome exibido: o nome da conta Google/cadastro, ou a parte antes do @ do e-mail. */
export const displayName = (user: User | null): string => {
  if (!user) return 'Usuário';
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const full = (meta.full_name ?? meta.name) as string | undefined;
  if (full && full.trim()) return full.trim();
  return user.email?.split('@')[0] ?? 'Usuário';
};
