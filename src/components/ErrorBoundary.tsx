import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Mostra o erro na tela em vez de deixar a página em branco. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[nexo] erro na tela:', error);
  }

  componentDidUpdate(prevProps: Props) {
    // Trocar de página limpa o erro anterior.
    if (this.state.error && prevProps.children !== this.props.children) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen" style={{ paddingTop: 40 }}>
          <div className="card" style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ fontSize: 20 }}>Algo deu errado nesta tela</h2>
            {/* Detalhes técnicos só no desenvolvimento; em produção, uma mensagem simples. */}
            <p className="text-2" style={{ fontSize: 13, wordBreak: 'break-word' }}>
              {import.meta.env.DEV ? this.state.error.message : 'Recarregue a página. Se o problema continuar, fale com o suporte.'}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Recarregar</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
