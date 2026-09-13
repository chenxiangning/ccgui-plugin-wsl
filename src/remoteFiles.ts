/**
 * 宿主 remote-files 桥对接(window.__ccguiFiles,同 webview 全局契约):
 * 注册远程读取器 —— 路径命中插件 KV 里登记过的 WSL 工作区时,经
 * ssh/expect 供内容(只读;宿主侧强制 truncated=true → 编辑器只读)。
 */

import { getHostCtx } from "./host";
import { loadPrefs } from "./store";
import { readFileRemote, type SshLink } from "./wsl";

interface RemoteFilesBridge {
  registerRemoteFileReader(
    reader: ((path: string) => Promise<unknown> | null) | null,
  ): void;
}

export function registerRemoteFileHook(): void {
  const w = window as { __ccguiFiles?: RemoteFilesBridge };
  const bridge = w.__ccguiFiles;
  if (!bridge || typeof bridge.registerRemoteFileReader !== "function") return;
  bridge.registerRemoteFileReader(async (path) => {
    const ctx = getHostCtx();
    if (!ctx) return null;
    const prefs = await loadPrefs();
    const meta = prefs?.workspaces[path];
    if (!meta) return null;
    const host = (prefs?.hosts ?? []).find((x) => x.id === meta.hostId);
    if (!host) return null;
    const link: SshLink = {
      target: { host: host.host, port: host.port, user: host.user },
      password: host.password,
      controlPath: meta.controlPath,
    };
    const r = await readFileRemote(link, meta.distro, path, 512 * 1024);
    if (r.content === null) return null;
    return {
      kind: "text" as const,
      text: r.content,
      dataUrl: null,
      truncated: r.truncated,
    };
  });
}
