import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { registerNotificationWorker } from './lib/reminder';
// Estilos de todas as telas, nesta ordem. Cada página e componente maior importa os próprios.
import './styles/base.css';
import './styles/layout.css';
import './styles/controls.css';
import './styles/lists.css';
import './styles/overlays.css';
import './styles/responsive.css';

registerNotificationWorker();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
