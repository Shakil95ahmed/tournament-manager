import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { describeStorageError } from '../../db/errors';

interface AppErrorBoundaryProps {
  /** Changing this value clears the error, so navigation can recover. */
  resetKey: string;
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time failures (mostly IndexedDB live queries) so a storage
 * problem shows a recovery screen instead of a blank page. The header and
 * footer stay usable because this boundary wraps only the routed screen.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Tournament Manager screen failed to render', error, info);
  }

  override componentDidUpdate(previous: AppErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="page">
        <div className="banner banner--danger" role="alert">
          <div>
            <div className="banner__title">This screen could not load</div>
            <p>{describeStorageError(this.state.error)}</p>
            <p className="small">
              Your saved tournaments are still on this device. Reload the app to try again, or open
              another screen from the header.
            </p>
            <div className="data-actions" style={{ marginTop: 'var(--s3)' }}>
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload app
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
