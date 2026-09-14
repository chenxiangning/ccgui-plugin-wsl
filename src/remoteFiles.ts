/**
 * 宿主 remote-files 桥对接(window.__ccguiFiles,同 webview 全局契约):
 * 注册远程读取器 —— 路径命中插件 KV 里登记过的 WSL 工作区(根自身或根下
 * 任意文件,最长前缀边界匹配)时,经 ssh/expect 读发行版内文件供内容
 * (只读;宿主侧强制 truncated=true → 编辑器只读)。不命中或读失败一律
 * 返回 null,宿主回落本地读取——非 WSL 工作区完全不受影响。
 */

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

export function registerRemoteFileHook(): () => void {
  const w = window as { __ccguiFiles?: RemoteFilesBridge };
  const bridge = w.__ccguiFiles;
  if (!bridge || typeof bridge.registerRemoteFileReader !== "function") {
    return () => {};
  }
  const reader = async (path: string) => {
    try {
      const prefs = await loadPrefs();
      const meta = prefs ? matchWorkspace(prefs, path) : null;
      if (!meta) return null;
      const link: SshLink = {
        target: { host: meta.host, port: meta.port, user: meta.user },
        password: prefs.hosts.find((x) => x.id === meta.hostId)?.password,
        controlPath: meta.controlPath,
      };
      const r = await readFileRemote(link, meta.distro, path, 512 * 1024);
      if (r.content === null) return null; // 超上限:交还宿主走自己的过大提示
      return {
        kind: "text" as const,
        text: r.content,
        dataUrl: null,
        truncated: r.truncated,
      };
    } catch {
      return null; // 文件不存在/连接失败:回落本地读取(宿主自行报错)
    }
  };
  bridge.registerRemoteFileReader(reader);
  return () => bridge.registerRemoteFileReader(null);
}
