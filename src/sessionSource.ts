/**
 * 侧栏远程会话源:把 distro 内已探针 CLI 的会话经 ctx.sessions.registerSource
 * 喂给宿主,侧栏对应工作区下直接列出远程会话线程(点击 → selectSession →
 * distro 内 resume)。60s TTL 缓存:宿主每次会话目录刷新都调 list(),ssh
 * 扫描不能每次都真跑;「重新检测」后走缓存过期自然更新。
 */
import { getHostCtx } from "./host";
import { linkOf, loadPrefs } from "./store";
import { listRemoteSessions } from "./wsl";

const TTL_MS = 60_000;

interface SourceRow {
  engine: string;
  sessionId: string;
  workspacePath: string;
  title?: string;
  updatedAt?: number | null;
  /** 远端 jsonl 绝对路径(宿主历史回放拉取用)。 */
  remotePath?: string;
}

let cache: { at: number; rows: SourceRow[] } | null = null;
let inFlight: Promise<SourceRow[]> | null = null;

async function scanAll(): Promise<SourceRow[]> {
  const prefs = await loadPrefs();
  const entries = Object.entries(prefs?.workspaces ?? {});
  const groups = await Promise.all(
    entries.map(async ([path, meta]) => {
      const link = linkOf(prefs, meta);
      if (!link) return [];
      const engines = Object.keys(meta.enginePaths ?? {});
      const sessions = await listRemoteSessions(link, meta.distro, path, engines);
      return sessions.map((s) => ({
        engine: s.engine,
        sessionId: s.sessionId,
        workspacePath: path,
        title: s.title || undefined,
        updatedAt: s.updatedAt || null,
        remotePath: s.path || undefined,
      }));
    }),
  );
  return groups.flat();
}

async function list(): Promise<SourceRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  inFlight ??= scanAll()
    .then((rows) => {
      cache = { at: Date.now(), rows };
      return rows;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** 注册远程会话源;返回注销函数(activate cleanup 调)。宿主缺 0.3.4 SDK
 *  挂点时静默跳过(老宿主只有面板内会话条)。 */
export function registerRemoteSessionSource(): () => void {
  const api = getHostCtx() as unknown as {
    sessions?: {
      registerSource?: (def: { id: string; list: () => Promise<SourceRow[]> }) => unknown;
    };
  };
  const dispose = api.sessions?.registerSource?.({ id: "wsl-remote", list });
  cache = null;
  return () => {
    if (typeof dispose === "function") dispose();
    cache = null;
  };
}
