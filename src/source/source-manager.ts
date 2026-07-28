import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SourceDescriptor, ProjectSource } from "../domain/types.js";

const execFileAsync = promisify(execFile);

export interface SourceManagerOptions {
  managedWorkspaceRoot?: string;
  gitCloner?: (url: string, targetPath: string, options?: { signal?: AbortSignal }) => Promise<void>;
}

async function defaultGitCloner(
  url: string,
  targetPath: string,
  options?: { signal?: AbortSignal }
): Promise<void> {
  try {
    await execFileAsync("git", ["clone", "--depth", "1", url, targetPath], {
      signal: options?.signal,
    });
  } catch (err: unknown) {
    const execErr = err as { stderr?: string | Buffer; message?: string };
    const stderr =
      typeof execErr.stderr === "string"
        ? execErr.stderr.trim()
        : execErr.stderr
        ? String(execErr.stderr).trim()
        : "";
    const message = stderr || (err instanceof Error ? err.message : String(err));
    throw new Error(`Git clone failed: ${message}`);
  }
}
export class SourceManager {
  private managedRoot: string;
  private gitCloner: (url: string, targetPath: string, options?: { signal?: AbortSignal }) => Promise<void>;

  constructor(options: SourceManagerOptions = {}) {
    this.managedRoot =
      options.managedWorkspaceRoot ||
      path.join(os.tmpdir(), "labq-orchestrator-workspaces");
    this.gitCloner = options.gitCloner || defaultGitCloner;
  }
  async validateAndAcquire(
    source: SourceDescriptor,
    options?: { signal?: AbortSignal }
  ): Promise<
    { ok: true; source: ProjectSource } | { ok: false; code: string; detail: string }
  > {
    if (options?.signal?.aborted) {
      return {
        ok: false,
        code: "acquisition_canceled",
        detail: "Managed acquisition was canceled.",
      };
    }

    if (source.kind === "local_folder") {
      const targetPath = path.resolve(source.path);
      try {
        const stat = fs.statSync(targetPath);
        if (!stat.isDirectory()) {
          return {
            ok: false,
            code: "invalid_source_path",
            detail: `Path is not a directory: ${source.path}`,
          };
        }
      } catch (err) {
        return {
          ok: false,
          code: "invalid_source_path",
          detail: `Local folder path does not exist: ${source.path}`,
        };
      }

      return {
        ok: true,
        source: {
          kind: "local_folder",
          status: "bound",
          locator: targetPath,
          workspace_path: targetPath,
        },
      };
    }

    if (source.kind === "git_url") {
      const url = source.url.trim();
      if (!this.isValidGitUrl(url)) {
        return {
          ok: false,
          code: "invalid_git_url",
          detail: `Invalid Git repository URL: ${source.url}`,
        };
      }

      const workspaceId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const workspacePath = path.join(this.managedRoot, workspaceId);

      try {
        if (options?.signal?.aborted) {
          throw new Error("Managed acquisition was canceled.");
        }
        fs.mkdirSync(workspacePath, { recursive: true });
        await this.gitCloner(url, workspacePath, options);
        if (options?.signal?.aborted) {
          throw new Error("Managed acquisition was canceled.");
        }
      } catch (err: unknown) {
        // Transactional cleanup on failure or cancellation
        this.cleanupPath(workspacePath);
        const message = err instanceof Error ? err.message : String(err);
        const code = message.includes("canceled") ? "acquisition_canceled" : "acquisition_failed";
        return {
          ok: false,
          code,
          detail: `Failed to acquire Git repository (${url}): ${message}`,
        };
      }

      return {
        ok: true,
        source: {
          kind: "git_url",
          status: "acquired",
          locator: url,
          workspace_path: workspacePath,
        },
      };
    }

    // Hosted source kinds remain visible as setup-required until configured
    const repoLocator = typeof source.repo === "string" ? source.repo.trim() : "";
    if (!repoLocator) {
      return {
        ok: false,
        code: "invalid_source",
        detail: `Hosted source '${source.kind}' requires a non-empty repository locator string.`,
      };
    }

    return {
      ok: true,
      source: {
        kind: source.kind,
        status: "setup_required",
        locator: repoLocator,
      },
    };
  }

  cleanupPath(targetPath: string): void {
    try {
      const resolvedTarget = path.resolve(targetPath);
      const resolvedRoot = path.resolve(this.managedRoot);
      const relative = path.relative(resolvedRoot, resolvedTarget);

      if (
        relative &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative) &&
        fs.existsSync(resolvedTarget)
      ) {
        fs.rmSync(resolvedTarget, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private isValidGitUrl(url: string): boolean {
    if (!url || typeof url !== "string") return false;
    const trimmed = url.trim();
    if (trimmed.startsWith("https://") && trimmed.length > 8) return true;
    if (trimmed.startsWith("http://") && trimmed.length > 7) return true;
    if (trimmed.startsWith("git@") && trimmed.length > 4 && trimmed.includes(":")) return true;
    if (trimmed.startsWith("ssh://") && trimmed.length > 6) return true;
    return false;
  }
}
