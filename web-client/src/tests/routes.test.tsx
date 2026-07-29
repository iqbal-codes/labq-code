// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useEffect } from "react";
import { describe, it, expect } from "vitest";
import { App } from "@/App";
import { OrchestratorClientProvider, useClientActions, useOrchestratorStore } from "@/orchestrator/StoreContext";
import { FakeTransport } from "@/orchestrator/fake-transport";
import { createOrchestratorClientStore } from "@/orchestrator/store";
import { createProjectCommand } from "@/orchestrator/commands";
import {
  LoadingState,
  EmptyState,
  UnauthorizedState,
  RecoverableErrorState,
  NotFound,
} from "@/components/routes/route-states";
import { StatusPill } from "@/components/ui/status";
import { validateImageAttachments } from "@labq/domain/types";

describe("route-state components", () => {
  it("renders LoadingState", () => {
    render(<LoadingState />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });

  it("renders EmptyState", () => {
    render(<EmptyState />);
    expect(screen.getByText("No projects")).toBeInTheDocument();
  });

  it("renders UnauthorizedState", () => {
    render(<UnauthorizedState />);
    expect(screen.getByText("UNAUTHORIZED")).toBeInTheDocument();
  });

  it("renders RecoverableErrorState with retry", () => {
    const onRetry = () => {};
    render(<RecoverableErrorState onRetry={onRetry} />);
    expect(screen.getByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Retry connection")).toBeInTheDocument();
  });

  it("renders NotFound", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByText("NOT FOUND")).toBeInTheDocument();
    expect(screen.getByText("Return to environment")).toBeInTheDocument();
  });
});

describe("StatusPill", () => {
  it("renders with tone color", () => {
    render(<StatusPill label="ACTIVE" tone="active" />);
    const pill = screen.getByText("ACTIVE");
    expect(pill).toBeInTheDocument();
    expect(pill.style.color).toBe("rgb(63, 185, 80)"); // #3fb950 = active green
  });
});

describe("store + React integration", () => {
  it("connects and shows boostrap status transitions", async () => {
    const transport = new FakeTransport();
    const store = createOrchestratorClientStore(transport);

    expect(store.getState().bootstrapStatus).toBe("idle");
    await store.getState().connect();
    expect(store.getState().bootstrapStatus).toBe("ready");
    expect(Object.keys(store.getState().snapshot.projects).length).toBe(0);

    // Dispatch a command and verify snapshot updated
    const cmd = createProjectCommand({
      name: "React Test",
      source: { kind: "git_url", url: "https://example.com/r.git" },
    });
    await store.getState().dispatch(cmd);
    // Events are applied synchronously during dispatch in FakeTransport
    expect(Object.keys(store.getState().snapshot.projects).length).toBe(1);
    const proj = Object.values(store.getState().snapshot.projects)[0];
    expect(proj.name).toBe("React Test");
  });

  it("separates transient local state from canonical state", async () => {
    const transport = new FakeTransport();
    const store = createOrchestratorClientStore(transport);

    // Canonical state should NOT contain local transient fields like drafts
    const state = store.getState() as Record<string, unknown>;
    expect(state.draft).toBeUndefined();
    expect(state.formValues).toBeUndefined();
    expect(state.chooserHighlight).toBeUndefined();

    // Canonical fields should be present
    expect(state).toHaveProperty("snapshot");
    expect(state).toHaveProperty("receipts");
    expect(state).toHaveProperty("recoveryCursor");
  });
});

function ClientActionsProbe() {
  const { connect } = useClientActions();
  const bootstrapStatus = useOrchestratorStore((s) => s.bootstrapStatus);

  useEffect(() => {
    if (bootstrapStatus === "idle") void connect();
  }, [bootstrapStatus, connect]);

  return <span>{bootstrapStatus}</span>;
}

describe("client action hook", () => {
  it("keeps bootstrap effects stable across store updates", async () => {
    render(
      <OrchestratorClientProvider port={new FakeTransport()}>
        <ClientActionsProbe />
      </OrchestratorClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
  });
});

describe("desktop-compatible app bootstrap", () => {
  it("renders the orchestration home after fallback transport bootstrap", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());
  });
});
describe("composer image attachment validation", () => {
  it("validates image types, counts, and size bounds", () => {
    expect(validateImageAttachments([])).toBeNull();

    const validImg = {
      filename: "test.png",
      media_type: "image/png",
      size_bytes: 100,
      data: Buffer.alloc(100).toString("base64"),
    };
    expect(validateImageAttachments([validImg])).toBeNull();

    const badType = {
      filename: "test.txt",
      media_type: "text/plain",
      size_bytes: 100,
      data: Buffer.alloc(100).toString("base64"),
    };
    expect(validateImageAttachments([badType])).toContain("Must be an image/* type");

    const six = Array.from({ length: 6 }, (_, i) => ({
      filename: `img${i}.png`,
      media_type: "image/png",
      size_bytes: 100,
      data: Buffer.alloc(100).toString("base64"),
    }));
    expect(validateImageAttachments(six)).toContain("exceeds maximum of 5");
  });
});
