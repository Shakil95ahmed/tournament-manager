import { LinkButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';

export function NotFoundPage() {
  return (
    <div className="page">
      <div className="card">
        <EmptyState
          title="Page not found"
          icon="bracket"
          titleLevel={1}
          actions={
            <LinkButton to="/" variant="primary">
              Back to dashboard
            </LinkButton>
          }
        >
          That address does not match any screen in this app.
        </EmptyState>
      </div>
    </div>
  );
}
