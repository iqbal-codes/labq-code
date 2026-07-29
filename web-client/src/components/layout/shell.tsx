import { useEffect } from "react";
import { Outlet } from "react-router";
import { useOrchestratorStore, useClientActions } from "@/orchestrator/StoreContext";
import { StatusPill, ConnectionPill, SyncPill } from "@/components/ui/status";
import { RecoverableErrorState } from "@/components/routes/route-states";

export function Shell() {
  const { connect, retry } = useClientActions();
  const bootstrapStatus = useOrchestratorStore((s) => s.bootstrapStatus);
  const connection = useOrchestratorStore((s) => s.connection);
  const sync = useOrchestratorStore((s) => s.sync);
  const error = useOrchestratorStore((s) => s.error);

  // Bootstrap on mount.
  useEffect(() => {
    if (bootstrapStatus === "idle") {
      void connect();
    }
  }, [bootstrapStatus, connect]);

  return (
    <div className="mx-auto flex min-h-full flex-col">
      {/* Status bar */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2 text-xs">
        <div className="flex items-center gap-3">
          <span className="tt-mono text-primary font-semibold tracking-widest">LABQ</span>
          <span className="text-muted-foreground tt-mono">ENV: local</span>
        </div>
        <div className="flex items-center gap-2" role="status">
          {bootstrapStatus === "error" || bootstrapStatus === "unauthorized" ? (
            <StatusPill
              label={bootstrapStatus.toUpperCase()}
              tone={bootstrapStatus === "unauthorized" ? "hazard" : "hazard"}
            />
          ) : (
            <>
              <ConnectionPill connection={connection} />
              <SyncPill sync={sync} />
            </>
          )}
        </div>
      </header>

      {/* Error recovery banner */}
      {bootstrapStatus === "error" && error ? (
        <RecoverableErrorState detail={error.detail} onRetry={() => void retry()} />
      ) : bootstrapStatus === "unauthorized" ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <StatusPill label="UNAUTHORIZED" tone="hazard" />
          <p className="text-muted-foreground ml-3">{error?.detail}</p>
        </div>
      ) : null}

      {/* Main content */}
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
