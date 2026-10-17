import { supabase } from './supabase';

/** Para onde o Supabase devolve o usuário depois do Google ou de um link de e-mail. */
export const appRedirectUrl = (): string => `${window.location.origin}/app`;

/** Operações de conta. Os erros são repassados para a tela, que os traduz. */
export const authService = {
  async signInWithEmail(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  /** Envia um código de acesso para uma conta já existente. */
  async sendLoginCode(email: string): Promise<void> {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) throw error;
  },

  async verifyLoginCode(email: string, token: string): Promise<void> {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
  },

  /** Retorna needsEmailConfirmation quando o projeto exige confirmar o e-mail. */
  async signUpWithEmail(email: string, password: string, name?: string): Promise<{ needsEmailConfirmation: boolean }> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: appRedirectUrl(),
        data: name ? { full_name: name } : undefined,
      },
    });
    if (error) throw error;

    // Com confirmação ligada, e-mail já cadastrado não gera erro: o usuário vem sem identidades.
    if (data.user && data.user.identities?.length === 0) {
      throw Object.assign(new Error('User already registered'), { code: 'user_already_exists' });
    }
    return { needsEmailConfirmation: !data.session };
  },

  async verifyEmailCode(email: string, token: string): Promise<void> {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
  },

  /** O Supabase limita o reenvio a um pedido por minuto. */
  async resendSignupCode(email: string): Promise<void> {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) throw error;
  },

  /** Na web o login com Google é um redirecionamento completo; ao voltar, a sessão é criada sozinha. */
  async signInWithGoogle(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: appRedirectUrl() },
    });
    if (error) throw error;
  },

  async updatePassword(password: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  },

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
};
