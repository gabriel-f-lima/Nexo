import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import {
  Agenda, Ajuda, AppShell, Chat, Configuracoes, Conquistas, Financas, Home, Landing, Metas, NotFound, Perfil, Rotina, Termos,
} from './routes';

/** Enquanto o arquivo da página é baixado. */
const PageLoading = () => (
  <div className="loading" role="status" aria-label="Carregando">
    <div className="spinner" />
  </div>
);

export default function App() {
  // Escuta a sessão desde a primeira tela (também necessário para o retorno do login com Google).
  useEffect(() => useAuthStore.getState().init(), []);

  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/termos" element={<Termos />} />

        <Route path="/app" element={<AppShell />}>
          <Route index element={<Navigate to="chat" replace />} />
          <Route path="chat" element={<Chat />} />
          <Route path="home" element={<Home />} />
          <Route path="agenda" element={<Agenda />} />
          <Route path="rotina" element={<Rotina />} />
          <Route path="financas" element={<Financas />} />
          <Route path="metas" element={<Metas />} />
          <Route path="conquistas" element={<Conquistas />} />
          <Route path="configuracoes" element={<Configuracoes />} />
          <Route path="ajuda" element={<Ajuda />} />
          <Route path="perfil" element={<Perfil />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
