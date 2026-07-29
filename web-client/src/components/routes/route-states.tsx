import type { ReactNode } from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";

import { StatusPill } from "@/components/ui/status";

export function LoadingState({ message = "Connecting\u2026" }: { message?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-muted-foreground tt-mono">{message}</p>
    </div>
  );
}

export function EmptyState({
  title = "No projects",
  description,
  action,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-lg font-medium">{title}</p>
      {description ? <p className="text-muted-foreground max-w-md">{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function UnauthorizedState({ detail }: { detail?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <StatusPill label="UNAUTHORIZED" tone="hazard" />
      <p className="text-muted-foreground max-w-md">
        {detail ?? "You do not have access to this environment."}
      </p>
    </div>
  );
}

export function RecoverableErrorState({
  detail,
  onRetry,
}: {
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <StatusPill label="ERROR" tone="hazard" />
      <p className="text-muted-foreground max-w-md tt-mono">{detail ?? "Something went wrong."}</p>
      {onRetry ? (
        <Button variant="default" onClick={() => onRetry()}>
          Retry connection
        </Button>
      ) : null}
    </div>
  );
}

export function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <StatusPill label="NOT FOUND" tone="warn" />
      <p className="text-muted-foreground max-w-md">This page does not exist.</p>
      <Link to="/" className="text-primary underline-offset-4 hover:underline">
        Return to environment
      </Link>
    </div>
  );
}

/**
 * Route-level error boundary for route load errors (e.g. missing route data).
 * Rendered by createBrowserRouter's errorElement.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  let message = "Unexpected route error.";
  if (isRouteErrorResponse(error)) {
    message = `${error.status} ${error.statusText}`;
  } else if (error instanceof Error) {
    message = error.message;
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <StatusPill label="ROUTE ERROR" tone="hazard" />
      <p className="text-muted-foreground max-w-md tt-mono">{message}</p>
      <Link to="/" className="text-primary underline-offset-4 hover:underline">
        Return to environment
      </Link>
    </div>
  );
}
