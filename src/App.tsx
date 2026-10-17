import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { useAuthStore } from './store/auth';
import Landing from './pages/Landing';
import Termos from './pages/Termos';
import Chat from './pages/Chat';
import Home from './pages/Home';
import Agenda from './pages/Agenda';
import Rotina from './pages/Rotina';
import Financas from './pages/Financas';
import Configuracoes from './pages/Configuracoes';
import Ajuda from './pages/Ajuda';
import Perfil from './pages/Perfil';
import NotFound from './pages/NotFound';

export default function App() {
  // Escuta a sessão desde a primeira tela (também necessário para o retorno do login com Google).
  useEffect(() => useAuthStore.getState().init(), []);

  return (
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
  );
}
