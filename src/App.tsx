import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { useAuthStore } from './store/auth';
import { lazyPage } from './lib/lazyPage';
import { appPages } from './pages/appPages';

const Landing = lazyPage(() => import('./pages/Landing'));
const Termos = lazyPage(() => import('./pages/Termos'));
const NotFound = lazyPage(() => import('./pages/NotFound'));
const { Chat, Home, Agenda, Rotina, Financas, Configuracoes, Ajuda, Perfil } = appPages;

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
          <Route path="configuracoes" element={<Configuracoes />} />
          <Route path="ajuda" element={<Ajuda />} />
          <Route path="perfil" element={<Perfil />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
