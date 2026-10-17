import { Header } from '../components/ui';
import { useAuthStore } from '../store/auth';
import { displayName } from '../lib/user';

export default function Perfil() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="screen">
      <Header title="Perfil" />
      <div className="screen-stack">
        <div className="card kv">
          <span className="k">Nome</span>
          <span className="v">{displayName(user)}</span>
          {user?.email ? (
            <>
              <span className="k">E-mail</span>
              <span className="v">{user.email}</span>
            </>
          ) : null}
          {!user ? <p className="text-2" style={{ fontSize: 13, marginTop: 10 }}>Entre na sua conta para ver os seus dados.</p> : null}
        </div>
      </div>
    </div>
  );
}
