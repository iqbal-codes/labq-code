import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SourceDescriptor, ProjectSource } from "../domain/types.js";

const execFileAsync = promisify(execFile);

export interface SourceManagerOptions {
  managedWorkspaceRoot?: string;
  gitCloner?: (url: string, targetPath: string) => Promise<void>;
}

async function defaultGitCloner(url: string, targetPath: string): Promise<void> {
  try {
    await execFileAsync("git", ["clone", "--depth", "1", url, targetPath]);
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
  private gitCloner: (url: string, targetPath: string) => Promise<void>;

  constructor(options: SourceManagerOptions = {}) {
    this.managedRoot =
      options.managedWorkspaceRoot ||
      path.join(os.tmpdir(), "labq-orchestrator-workspaces");
    this.gitCloner = options.gitCloner || defaultGitCloner;
  }

  async validateAndAcquire(
    source: SourceDescriptor
  ): Promise<
    { ok: true; source: ProjectSource } | { ok: false; code: string; detail: string }
  > {
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
        fs.mkdirSync(workspacePath, { recursive: true });
        await this.gitCloner(url, workspacePath);
      } catch (err: unknown) {
        // Transactional cleanup on failure
        this.cleanupPath(workspacePath);
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          code: "acquisition_failed",
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
    return {
      ok: true,
      source: {
        kind: source.kind,
        status: "setup_required",
        locator: source.repo,
      },
    };
  }

  cleanupPath(targetPath: string): void {
    try {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
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
