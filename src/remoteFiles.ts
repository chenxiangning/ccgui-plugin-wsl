/**
 * 宿主 remote-files 桥对接(window.__ccguiFiles,同 webview 全局契约):
 * 注册远程读取器 —— 路径命中插件 KV 里登记过的 WSL 工作区(根自身或根下
 * 任意文件,最长前缀边界匹配)时,经 ssh/expect 读发行版内文件供内容
 * (只读;宿主侧强制 truncated=true → 编辑器只读)。不命中或读失败一律
 * 返回 null,宿主回落本地读取——非 WSL 工作区完全不受影响。
 */

import { getHostCtx } from "./host";
import { loadPrefs, type WslPrefs, type WslWorkspaceMeta } from "./store";
import { readFileRemote, type SshLink } from "./wsl";

interface RemoteFilesBridge {
  registerRemoteFileReader(
    reader: ((path: string) => Promise<unknown> | null) | null,
  ): void;
}

/** path 命中的已登记 WSL 工作区:最长根前缀、路径边界对齐
 * (~/cxn 不得误吞 ~/cxn2/x),根尾斜杠归一后比较。 */
export function matchWorkspace(
  prefs: WslPrefs,
  path: string,
): WslWorkspaceMeta | null {
  let bestLen = -1;
  let meta: WslWorkspaceMeta | null = null;
  for (const [root, m] of Object.entries(prefs.workspaces)) {
    const r = root.replace(/\/+$/, "");
    if ((path === r || path.startsWith(`${r}/`)) && r.length > bestLen) {
      bestLen = r.length;
      meta = m;
    }
  }
  return meta;
}

let registered = false;

export function registerRemoteFileHook(): () => void {
  registered = false;
  const w = window as { __ccguiFiles?: RemoteFilesBridge };
  const bridge = w.__ccguiFiles;
  if (!bridge || typeof bridge.registerRemoteFileReader !== "function") {
    return () => {};
  }
  const reader = async (path: string) => {
    const trace = (patch: Record<string, unknown>) => {
      /* 黑匣子:每次调用覆写单键,客户端内失败(shell 里无法复现)靠它定位。 */
      void getHostCtx()
        .storage.set("debug.fileRead", { t: new Date().toISOString(), path, ...patch })
        .catch(() => {});
    };
    try {
      const prefs = await loadPrefs();
      const meta = prefs ? matchWorkspace(prefs, path) : null;
      if (!prefs) { trace({ stage: "no-prefs" }); return null; }
      if (!meta) { trace({ stage: "no-meta", roots: Object.keys(prefs.workspaces) }); return null; }
      const host = prefs.hosts.find((x) => x.id === meta.hostId);
      if (!host) { trace({ stage: "no-host" }); return null; }
      // 链路形态对齐 FileTreePanel.linkOf:不带 controlPath —— meta 里快照的
      // ControlMaster 套接字失效(ControlPersist 到期/宿主休眠)会让 ssh 以
      // 255 失败,读文件整体回落本地读取而报「文件不存在」;裸连接(password
      // expect/key BatchMode)是真机文件树已验证的稳定形态。
      const link: SshLink = {
        target: { host: host.host, port: host.port, user: host.user },
        password: host.password || undefined,
      };
      const r = await readFileRemote(link, meta.distro, path, 512 * 1024);
      if (r.content === null) {
        trace({ stage: "oversize", size: r.size });
        return null; // 超上限:交还宿主走自己的过大提示
      }
      trace({ stage: "ok", size: r.size });
      return {
        kind: "text" as const,
        text: r.content,
        dataUrl: null,
        truncated: r.truncated,
      };
    } catch (e) {
      trace({ stage: "error", message: e instanceof Error ? e.message : String(e) });
      return null; // 文件不存在/连接失败:回落本地读取(宿主自行报错)
    }
  };
  bridge.registerRemoteFileReader(reader);
  registered = true;
  return () => {
    registered = false;
    bridge.registerRemoteFileReader(null);
  };
}

/** 桥可能在插件 activate 之后才就绪(模块加载顺序随宿主构建变化),
 *  点击/面板挂载时补注册一次;已注册则幂等。 */
export function ensureRemoteFileHook(): void {
  if (registered) return;
  registerRemoteFileHook();
}
