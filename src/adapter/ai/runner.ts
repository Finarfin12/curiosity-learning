import type { CliKind } from "../../domain/ai/types";

declare const require: (id: string) => unknown;
const native = (id: string): unknown => require(id);

export interface RunOptions {
  cwd: string;
  stdin: string;
  timeoutMs: number;
  env?: Record<string, string>;
}
export interface ProcessRunner {
  run(exe: string, args: string[], options: RunOptions): Promise<{ code: number | null; stdout: string }>;
}
export interface Workspace {
  dir: string;
  write(name: "gemini-settings.json", body: string): Promise<string>;
  cleanup(): Promise<void>;
}
export interface CliEnvironment {
  runner: ProcessRunner;
  executable(kind: CliKind): Promise<string | null>;
  workspace(): Promise<Workspace>;
}

export function desktopCli(): CliEnvironment {
  return {
    runner: {
      async run(file, args, options) {
        const cp = native("child_process") as typeof import("child_process");
        const path = native("path") as typeof import("path");
        const runtime = native("process") as typeof import("process");
        const windows = runtime.platform === "win32";
        return new Promise((resolve, reject) => {
          let stdout = "";
          let settled = false;
          const child = cp.spawn(file, args, {
            cwd: options.cwd, env: { ...runtime.env, ...options.env }, shell: false,
            windowsHide: true, detached: !windows, stdio: ["pipe", "pipe", "ignore"],
          });
          const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            fn();
          };
          const kill = () => {
            if (!child.pid) return;
            try {
              if (windows) {
                const taskkill = path.join(runtime.env.SystemRoot ?? "C:/Windows", "System32", "taskkill.exe");
                const helper = cp.spawn(taskkill, ["/pid", String(child.pid), "/T", "/F"],
                  { windowsHide: true, shell: false, stdio: "ignore" });
                helper.on("error", () => { child.kill("SIGKILL"); });
              } else { runtime.kill(-child.pid, "SIGKILL"); }
            } catch { child.kill("SIGKILL"); }
          };
          const fail = () => finish(() => { kill(); reject(new Error("AI CLI unavailable")); });
          const timer = window.setTimeout(fail, options.timeoutMs);
          child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;
            if (stdout.length > 131_072) fail();
          });
          child.stdin.on("error", () => undefined);
          child.on("error", fail);
          child.on("close", code => finish(() => resolve({ code, stdout })));
          child.stdin.end(options.stdin, "utf8");
        });
      },
    },
    async executable(kind) {
      const fs = native("fs") as typeof import("fs");
      const path = native("path") as typeof import("path");
      const runtime = native("process") as typeof import("process");
      const windows = runtime.platform === "win32";
      for (const raw of (runtime.env.PATH ?? "").split(path.delimiter)) {
        const dir = raw.replace(/^"|"$/g, "");
        if (!path.isAbsolute(dir)) continue;
        const candidate = path.join(dir, kind + (windows ? ".exe" : ""));
        try {
          if (!(await fs.promises.stat(candidate)).isFile()) continue;
          await fs.promises.access(candidate, fs.constants.X_OK);
          return candidate;
        } catch { /* Search only absolute PATH entries. */ }
      }
      return null;
    },
    async workspace() {
      const fs = native("fs") as typeof import("fs");
      const path = native("path") as typeof import("path");
      const os = native("os") as typeof import("os");
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "curiosity-ai-"));
      return {
        dir,
        async write(name, body) {
          const file = path.join(dir, name);
          await fs.promises.writeFile(file, body, { flag: "wx", mode: 0o600 });
          return file;
        },
        async cleanup() {
          // This exact directory was created by mkdtemp for this invocation.
          await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        },
      };
    },
  };
}
