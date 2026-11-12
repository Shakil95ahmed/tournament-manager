import { useEffect, useRef, useState } from 'react';
import { AppErrorBoundary } from './components/layout/AppErrorBoundary';
import { AppFooter } from './components/layout/AppFooter';
import { AppHeader } from './components/layout/AppHeader';
import { APP_NAME } from './config';
import { openDatabase } from './db/db';
import { describeStorageError } from './db/errors';
import { useRoute, type Route } from './router';
import { CreatePage } from './pages/CreatePage';
import { DashboardPage } from './pages/DashboardPage';
import { DataPage } from './pages/DataPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { TournamentPage } from './pages/TournamentPage';

function titleFor(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return `Tournaments · ${APP_NAME}`;
    case 'create':
      return `New tournament · ${APP_NAME}`;
    case 'data':
      return `Data & backups · ${APP_NAME}`;
    case 'tournament':
      return `Tournament · ${APP_NAME}`;
    case 'notFound':
      return `Not found · ${APP_NAME}`;
  }
}

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'dashboard':
      return <DashboardPage />;
    case 'create':
      return <CreatePage />;
    case 'data':
      return <DataPage />;
    case 'tournament':
      return <TournamentPage id={route.id} />;
    case 'notFound':
      return <NotFoundPage />;
  }
}

export default function App() {
  const route = useRoute();
  const routeKey = route.name === 'tournament' ? `${route.name}:${route.id}` : route.name;
  const [storageError, setStorageError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);

  useEffect(() => {
    let active = true;
    openDatabase().catch((error: unknown) => {
      if (active) setStorageError(describeStorageError(error));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.title = titleFor(route);
  }, [route]);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [routeKey]);

  return (
    <div className="app">
      <button
        type="button"
        className="skip-link"
        onClick={() => document.getElementById('main')?.focus()}
      >
        Skip to content
      </button>
      <AppHeader route={route} />
      <main className="app-main" id="main" tabIndex={-1} ref={mainRef}>
        {storageError ? (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner banner--danger" role="alert">
              <div>
                <div className="banner__title">Local storage is unavailable</div>
                <div>{storageError}</div>
              </div>
            </div>
          </div>
        ) : null}
        <AppErrorBoundary resetKey={routeKey}>
          <RouteView route={route} />
        </AppErrorBoundary>
      </main>
      <AppFooter />
    </div>
  );
}
