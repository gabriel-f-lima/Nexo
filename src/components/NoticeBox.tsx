import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

/** Caixa de aviso com destaque, para regras que o usuário precisa conhecer antes de salvar. */
export default function NoticeBox({ children }: { children: ReactNode }) {
  return (
    <div className="notice-box" role="note">
      <Info size={17} />
      <p>{children}</p>
    </div>
  );
}
