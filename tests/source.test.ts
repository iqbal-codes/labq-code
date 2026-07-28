import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SourceManager } from "../src/source/source-manager.js";
import { SourceDescriptor } from "../src/domain/types.js";

describe("SourceManager", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tempDirs.length = 0;
  });

  test("validates local folder binding for an existing directory", async () => {
    const localDir = makeTempDir();
    const sourceManager = new SourceManager();

    const result = await sourceManager.validateAndAcquire({
      kind: "local_folder",
      path: localDir,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.kind).toBe("local_folder");
      expect(result.source.status).toBe("bound");
      expect(result.source.workspace_path).toBe(localDir);
    }
  });

  test("rejects local folder binding for non-existent path", async () => {
    const sourceManager = new SourceManager();
    const nonExistentPath = path.join(os.tmpdir(), "non-existent-dir-" + Date.now());

    const result = await sourceManager.validateAndAcquire({
      kind: "local_folder",
      path: nonExistentPath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_source_path");
    }
  });
  test("rejects local folder binding for non-string or empty path", async () => {
    const sourceManager = new SourceManager();

    const result = await sourceManager.validateAndAcquire({
      kind: "local_folder",
      path: "   " as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_source");
    }
  });
  test("rejects null or non-object source descriptor", async () => {
    const sourceManager = new SourceManager();

    const result = await sourceManager.validateAndAcquire(null as any);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_source");
    }
  });

  test("rejects unknown or unsupported source kind", async () => {
    const sourceManager = new SourceManager();

    const result = await sourceManager.validateAndAcquire({
      kind: "unsupported_kind",
    } as unknown as SourceDescriptor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_source_kind");
    }
  });

  test("rejects local folder binding for a file path (not a directory)", async () => {
    const tempDir = makeTempDir();
    const filePath = path.join(tempDir, "file.txt");
    fs.writeFileSync(filePath, "hello");

    const sourceManager = new SourceManager();
    const result = await sourceManager.validateAndAcquire({
      kind: "local_folder",
      path: filePath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_source_path");
    }
  });

  test("performs managed Git URL acquisition and cleans up on failure", async () => {
    const managedRoot = makeTempDir();
    const failingCloner = async (_url: string, _target: string) => {
      throw new Error("Git clone connection timed out");
    };

    const sourceManager = new SourceManager({
      managedWorkspaceRoot: managedRoot,
      gitCloner: failingCloner,
    });

    const result = await sourceManager.validateAndAcquire({
      kind: "git_url",
      url: "https://github.com/example/repo.git",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("acquisition_failed");
    }

    // Verify transactional cleanup (no leftover directories inside managedRoot)
    const contents = fs.readdirSync(managedRoot);
    expect(contents.length).toBe(0);
  });
  test("cleans up managed workspace artifacts when acquisition is canceled via AbortSignal", async () => {
    const managedRoot = makeTempDir();
    const controller = new AbortController();
    const slowCloner = async (_url: string, targetPath: string, options?: { signal?: AbortSignal }) => {
      fs.writeFileSync(path.join(targetPath, "temp-clone-file.txt"), "cloning...");
      controller.abort();
      if (options?.signal?.aborted) {
        throw new Error("Managed acquisition was canceled.");
      }
    };

    const sourceManager = new SourceManager({
      managedWorkspaceRoot: managedRoot,
      gitCloner: slowCloner,
    });

    const result = await sourceManager.validateAndAcquire(
      {
        kind: "git_url",
        url: "https://github.com/example/cancel-repo.git",
      },
      { signal: controller.signal }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("acquisition_canceled");
    }

    // Verify transactional cleanup after cancellation
    const contents = fs.readdirSync(managedRoot);
    expect(contents.length).toBe(0);
  });

  test("acquires valid Git URL into managed workspace", async () => {
    const managedRoot = makeTempDir();
    const mockCloner = async (_url: string, targetPath: string) => {
      fs.writeFileSync(path.join(targetPath, "README.md"), "# Mock Repo");
    };

    const sourceManager = new SourceManager({
      managedWorkspaceRoot: managedRoot,
      gitCloner: mockCloner,
    });

    const result = await sourceManager.validateAndAcquire({
      kind: "git_url",
      url: "https://github.com/example/valid-repo.git",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.kind).toBe("git_url");
      expect(result.source.status).toBe("acquired");
      expect(result.source.workspace_path).toBeDefined();
      expect(fs.existsSync(result.source.workspace_path!)).toBe(true);
    }
  });

  test("hosted sources are returned as setup_required", async () => {
    const sourceManager = new SourceManager();
    const hostedKinds = ["github", "azure_devops", "bitbucket", "gitlab"] as const;

    for (const kind of hostedKinds) {
      const result = await sourceManager.validateAndAcquire({
        kind,
        repo: "org/repo",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.source.kind).toBe(kind);
        expect(result.source.status).toBe("setup_required");
      }
    }
  });
  test("cleanupPath refuses to delete directories outside managed workspace root", async () => {
    const managedRoot = makeTempDir();
    const userLocalDir = makeTempDir();
    const userFile = path.join(userLocalDir, "user_data.txt");
    fs.writeFileSync(userFile, "important user code");

    const sourceManager = new SourceManager({ managedWorkspaceRoot: managedRoot });
    sourceManager.cleanupPath(userLocalDir);

    // User folder and file MUST remain intact
    expect(fs.existsSync(userFile)).toBe(true);
  });
});
