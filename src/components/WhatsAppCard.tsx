import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, MessageCircle, RefreshCw, Unlink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { confirmAction } from '../lib/confirm';
import { notify } from '../lib/toast';
import { LIMITS } from '../lib/billing';
import { useTier } from '../lib/useTier';
import { NEXO_WHATSAPP_NUMBER as NEXO_NUMBER, whatsappEnabled } from '../lib/whatsapp';
import Paywall from './Paywall';

interface LinkState { phone: string | null; verifiedAt: string | null }

const maskPhone = (phone: string) => `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) •••••-${phone.slice(-4)}`;

/**
 * Vincula o WhatsApp à conta: gera um código de 6 dígitos (vale 10 minutos) que a pessoa envia ao número do Nexo.
 * Assim o número é comprovado pelo próprio WhatsApp, sem SMS. Só nos planos pagos (o servidor confere também).
 */
export default function WhatsAppCard() {
  const user = useAuthStore((s) => s.user);
  const tier = useTier(user?.id);
  const [paywall, setPaywall] = useState(false);
  const [link, setLink] = useState<LinkState | null>(null);
  const [code, setCode] = useState<{ value: string; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('nexo_whatsapp_links').select('phone,verified_at').eq('user_id', user.id).maybeSingle();
    const row = data as { phone: string | null; verified_at: string | null } | null;
    setLink({ phone: row?.phone ?? null, verifiedAt: row?.verified_at ?? null });
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Enquanto há um código na tela, confere a cada 5 s se o vínculo já foi feito.
  useEffect(() => {
    if (!code) return undefined;
    const id = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 5000);
    return () => window.clearInterval(id);
  }, [code, refresh]);
  useEffect(() => {
    if (link?.verifiedAt && code) { setCode(null); notify('WhatsApp vinculado à sua conta.', 'success'); }
  }, [link, code]);

  const generate = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('nexo_whatsapp_start_link');
    setBusy(false);
    if (error?.message.includes('nexo_plan_required')) { setPaywall(true); return; }
    if (error || typeof data !== 'string') {
      notify(error?.message.includes('nexo_whatsapp_wait') ? 'Aguarde alguns segundos para gerar outro código.' : 'Não foi possível gerar o código agora.', 'error');
      return;
    }
    setNow(Date.now());
    setCode({ value: data, until: Date.now() + 10 * 60_000 });
  };

  const unlink = async () => {
    if (!user) return;
    const ok = await confirmAction({ title: 'Desvincular WhatsApp?', message: 'As mensagens deste número deixam de chegar à sua conta.', confirmText: 'Desvincular', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('nexo_whatsapp_links').delete().eq('user_id', user.id);
    if (error) { notify('Não foi possível desvincular agora.', 'error'); return; }
    setLink({ phone: null, verifiedAt: null });
    notify('WhatsApp desvinculado.', 'info');
  };

  if (!whatsappEnabled || !user || tier === 'loading') return null;
  const linked = !!link?.phone && !!link.verifiedAt;
  const allowed = LIMITS[tier].whatsapp;
  const message = code ? `vincular ${code.value}` : '';
  const left = code ? Math.max(0, Math.ceil((code.until - now) / 60_000)) : 0;

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="setting-row">
        <span className="icon-btn" style={{ background: 'rgba(37, 211, 102, 0.12)', borderColor: 'rgba(37, 211, 102, 0.35)', color: '#25D366' }}><MessageCircle size={19} /></span>
        <div className="grow">
          <div className="title">WhatsApp{allowed ? null : <span className="tag-soon"><Lock size={10} style={{ verticalAlign: -1 }} /> Planos pagos</span>}</div>
          <div className="desc">{linked ? `Vinculado: ${maskPhone(link.phone as string)}` : 'Anote gastos e compromissos mandando mensagem ao Nexo.'}</div>
        </div>
      </div>
      {!allowed ? (
        <>
          <p className="text-2" style={{ fontSize: 13 }}>
            {linked
              ? 'O WhatsApp faz parte dos planos Básico e Pro. As mensagens deste número estão pausadas até você assinar de novo.'
              : 'Disponível nos planos Básico e Pro: mande “gastei 45 no mercado” ou “dentista terça às 15h” e o Nexo anota na sua conta.'}
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setPaywall(true)}>Ver planos</button>
          {linked ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void unlink(); }}><Unlink size={15} /> Desvincular</button> : null}
        </>
      ) : linked ? (
        <>
          <p className="text-2" style={{ fontSize: 13 }}>Mande, por exemplo: “gastei 45 no mercado” ou “dentista terça às 15h”.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void unlink(); }}><Unlink size={15} /> Desvincular</button>
        </>
      ) : code && left > 0 ? (
        <>
          <p className="text-2" style={{ fontSize: 13.5 }}>Envie esta mensagem para o Nexo pelo WhatsApp do seu celular. O código vale por {left} {left === 1 ? 'minuto' : 'minutos'}.</p>
          <div className="code-input" style={{ padding: 12, borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--border-strong)' }}>{message}</div>
          <a className="btn btn-primary" href={`https://wa.me/${NEXO_NUMBER}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Abrir o WhatsApp</a>
          <button type="button" className="link-btn" onClick={() => { void generate(); }} disabled={busy}><RefreshCw size={13} /> Gerar outro código</button>
        </>
      ) : (
        <motion.button type="button" className="btn btn-primary btn-sm" whileTap={{ scale: 0.98 }} onClick={() => { void generate(); }} disabled={busy}>
          Vincular meu WhatsApp
        </motion.button>
      )}
      <Paywall open={paywall} onClose={() => setPaywall(false)} title="WhatsApp nos planos pagos" message="Registrar gastos e compromissos pelo WhatsApp faz parte dos planos Básico e Pro." />
    </div>
  );
}
