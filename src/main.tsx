import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { BuzzerPhone } from './components/BuzzerPhone';

function parseHashRoute(hash: string): { path: string; params: URLSearchParams } {
  if (!hash || hash === '#') {
    return { path: '/', params: new URLSearchParams() };
  }
  const [pathPart, queryPart] = hash.slice(1).split('?');
  return {
    path: pathPart || '/',
    params: new URLSearchParams(queryPart || ''),
  };
}

function Root() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const { path, params } = parseHashRoute(hash);

  if (path === '/buzz') {
    const roomCode = params.get('room');
    if (roomCode) {
      return <BuzzerPhone roomCode={roomCode.toUpperCase()} />;
    }
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>
        <h1>Missing room code</h1>
        <p>Scan the QR code or use the link from the host's screen.</p>
      </div>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
