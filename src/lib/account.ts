import { supabase } from './supabase';

/** Envia um código de confirmação para o e-mail da conta. */
export const sendDeletionCode = async (email: string): Promise<void> => {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw error;
};

/** Confirma o código. Isso renova a sessão e registra um login recente. */
export const confirmDeletionCode = async (email: string, token: string): Promise<void> => {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
};

/** Chama a função que apaga a conta e todos os dados vinculados. */
export const deleteAccountNow = async (): Promise<void> => {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (!error) return;
  let message = 'Não foi possível excluir a conta. Tente novamente.';
  const response = (error as { context?: Response }).context;
  if (response) {
    try {
      const body = (await response.clone().json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Sem JSON na resposta: mantém a mensagem padrão.
    }
  }
  void data;
  throw new Error(message);
};
