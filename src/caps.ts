import { getHostCtx } from "./host";

/**
 * 通用能力出口薄封装（react-doctor caps.ts 同款）。授权在 manifest 的
 * `exec:` 权限里声明，JS 侧预检不过即 reject（不打 IPC）。
 */

export interface ExecRunResult {
  /** null = 进程被信号终止（含超时被杀）。 */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** `plugin_exec_run`：bin 须命中 `exec:` 授权；timeoutMs 默认 30000、上限 300000。 */
export function execRun(bin: string, args: string[], timeoutMs?: number): Promise<ExecRunResult> {
  return getHostCtx().bridge.invoke("plugin_exec_run", {
    bin,
    args,
    timeoutMs: timeoutMs ?? null,
  });
}

