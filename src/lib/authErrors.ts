/** Converte erros do Supabase em mensagens amigáveis em português. */
export const translateAuthError = (
  error: unknown,
  fallback = 'Não foi possível concluir. Tente novamente.',
): string => {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.';
    case 'email_not_confirmed':
      return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
    case 'user_not_found':
      return 'Não encontramos uma conta com este e-mail. Crie uma conta primeiro.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Já existe uma conta com esse e-mail. Tente entrar.';
    case 'otp_expired':
      return 'Código inválido ou expirado. Confira os números ou peça um novo código.';
    case 'weak_password':
      return 'Senha fraca. Escolha uma senha mais forte.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    case 'signup_disabled':
      return 'O cadastro está desativado no momento.';
  }

  if (e?.message?.toLowerCase().includes('network') || e?.message?.toLowerCase().includes('fetch')) {
    return 'Sem conexão. Verifique sua internet e tente novamente.';
  }
  return fallback;
};
