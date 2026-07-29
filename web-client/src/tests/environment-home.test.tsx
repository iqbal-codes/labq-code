// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, it, expect } from "vitest";
import { OrchestratorClientProvider, useClientActions, useOrchestratorStore } from "@/orchestrator/StoreContext";
import { FakeTransport } from "@/orchestrator/fake-transport";
import { EnvironmentHome } from "@/components/routes/environment-home";
import { useEffect } from "react";

function ConnectedEnvironmentHome() {
  const { connect } = useClientActions();
  const bootstrapStatus = useOrchestratorStore((s) => s.bootstrapStatus);

  useEffect(() => {
    if (bootstrapStatus === "idle") {
      void connect();
    }
  }, [bootstrapStatus, connect]);

  return <EnvironmentHome />;
}

function renderEnvironmentHome(transport = new FakeTransport()) {
  const user = userEvent.setup();
  const utils = render(
    <OrchestratorClientProvider port={transport}>
      <MemoryRouter>
        <ConnectedEnvironmentHome />
      </MemoryRouter>
    </OrchestratorClientProvider>
  );
  return { ...utils, user, transport };
}

describe("EnvironmentHome - Source-Aware Project Onboarding", () => {
  it("renders Add project dialog with six canonical source rows in order", async () => {
    const { user } = renderEnvironmentHome();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());

    const addButton = screen.getAllByRole("button", { name: "Add project" })[0];
    await user.click(addButton);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Add project" })).toBeInTheDocument());

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(6);

    expect(options[0]).toHaveTextContent("Local folder");
    expect(options[1]).toHaveTextContent("Git URL");
    expect(options[2]).toHaveTextContent("GitHub repository");
    expect(options[3]).toHaveTextContent("Azure DevOps repository");
    expect(options[4]).toHaveTextContent("Bitbucket repository");
    expect(options[5]).toHaveTextContent("GitLab repository");

    // Hosted rows (2, 3, 4, 5) must show Setup required
    for (let i = 2; i < 6; i++) {
      expect(options[i]).toHaveTextContent("Setup required");
      expect(options[i]).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("prevents hosted rows from opening form or dispatching", async () => {
    const { user } = renderEnvironmentHome();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Add project" })[0]);

    const githubOption = screen.getByText("GitHub repository");
    await user.click(githubOption);

    // Should remain on the chooser step and NOT transition to form
    expect(screen.getByRole("heading", { name: "Add project" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("GitHub repository requires setup before use");
  });

  it("supports keyboard search and arrow-key navigation in source chooser", async () => {
    const { user } = renderEnvironmentHome();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Add project" })[0]);

    const searchInput = screen.getByPlaceholderText("Search sources…");

    // Filter to "Local"
    await user.type(searchInput, "Local");

    const filteredOptions = screen.getAllByRole("option");
    expect(filteredOptions.length).toBe(1);
    expect(filteredOptions[0]).toHaveTextContent("Local folder");

    // Press Enter to select highlighted "Local folder"
    fireEvent.keyDown(searchInput, { key: "Enter" });

    // Selecting Local folder should transition to form
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Add project – Local folder/ })).toBeInTheDocument();
    });
  });

  it("requires non-empty real values and forbids demo fallback values", async () => {
    const { user, transport } = renderEnvironmentHome();

    let dispatchedCount = 0;
    const originalDispatchCommand = transport.dispatchCommand.bind(transport);
    transport.dispatchCommand = async (cmd) => {
      if (cmd.kind === "create_project") dispatchedCount++;
      return originalDispatchCommand(cmd);
    };

    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Add project" })[0]);

    // Select Local folder
    const localOption = screen.getByText("Local folder");
    await user.click(localOption);

    await waitFor(() => expect(screen.getByLabelText("Project name")).toBeInTheDocument());

    const nameInput = screen.getByLabelText("Project name");
    const pathInput = screen.getByLabelText("Folder path");

    // Initially empty
    expect(nameInput).toHaveValue("");
    expect(pathInput).toHaveValue("");

    // Create button should be disabled when fields are empty
    const createButton = screen.getByRole("button", { name: "Create project" });
    expect(createButton).toBeDisabled();

    // Type only name
    await user.type(nameInput, "test-no-fallback");
    expect(createButton).toBeDisabled();

    // Submit via form should fail validation without dispatching
    fireEvent.submit(nameInput.closest("form")!);
    expect(dispatchedCount).toBe(0);
  });

  it("retains input values and leaves dialog open on failed dispatch", async () => {
    const { user, transport } = renderEnvironmentHome();

    transport.dispatchCommand = async (cmd) => {
      if (cmd.kind === "create_project") {
        return {
          ok: false,
          command_id: cmd.command_id,
          code: "INVALID_SOURCE",
          detail: "Directory does not exist on target host.",
        };
      }
      return { ok: true, command_id: cmd.command_id, events: [] };
    };

    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Add project" })[0]);

    await user.click(screen.getByText("Local folder"));

    const nameInput = screen.getByLabelText("Project name");
    const pathInput = screen.getByLabelText("Folder path");

    await user.type(nameInput, "my-invalid-project");
    await user.type(pathInput, "/nonexistent/path");

    const createButton = screen.getByRole("button", { name: "Create project" });
    expect(createButton).not.toBeDisabled();

    await user.click(createButton);

    // Dialog should stay open and error message should be displayed
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Directory does not exist on target host.");
    });

    // Form inputs must retain their values!
    expect(nameInput).toHaveValue("my-invalid-project");
    expect(pathInput).toHaveValue("/nonexistent/path");
  });

  it("reuses the command identity when a recoverable create is retried", async () => {
    const { user, transport } = renderEnvironmentHome();
    const commandIds: string[] = [];

    transport.dispatchCommand = async (cmd) => {
      if (cmd.kind === "create_project") {
        commandIds.push(cmd.command_id);
        return {
          ok: false,
          code: "ACQUISITION_FAILED",
          detail: "Repository is temporarily unavailable.",
        };
      }
      return { ok: false, code: "UNEXPECTED", detail: "Unexpected command." };
    };

    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Add project" })[0]);
    await user.click(screen.getByText("Git URL"));
    await user.type(screen.getByLabelText("Project name"), "retry-project");
    await user.type(screen.getByLabelText("Repository URL"), "https://example.com/retry.git");

    const createButton = screen.getByRole("button", { name: "Create project" });
    await user.click(createButton);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable"));
    await user.click(createButton);
    await waitFor(() => expect(commandIds).toHaveLength(2));

    expect(commandIds[1]).toBe(commandIds[0]);
  });

  it("clears form and closes dialog on successful dispatch", async () => {
    const { user } = renderEnvironmentHome();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Add project" })[0]);

    await user.click(screen.getByText("Local folder"));

    const nameInput = screen.getByLabelText("Project name");
    const pathInput = screen.getByLabelText("Folder path");

    await user.type(nameInput, "valid-project");
    await user.type(pathInput, "/valid/path");

    const createButton = screen.getByRole("button", { name: "Create project" });
    await user.click(createButton);

    // Dialog should close after success
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /Add project/ })).not.toBeInTheDocument();
    });
  });

  it("supports Backspace return to source chooser step when input is empty", async () => {
    const { user } = renderEnvironmentHome();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Add project" })[0]);

    await user.click(screen.getByText("Local folder"));

    const nameInput = screen.getByLabelText("Project name");

    // Pressing backspace when empty returns to chooser
    fireEvent.keyDown(nameInput, { key: "Backspace" });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search sources…")).toBeInTheDocument();
    });
  });
  it("renders Browse button for local folder source", async () => {
    const { user } = renderEnvironmentHome();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Add project" })[0]);
    await user.click(screen.getByText("Local folder"));

    const browseButton = screen.getByRole("button", { name: /Browse…/i });
    expect(browseButton).toBeInTheDocument();
  });
});
