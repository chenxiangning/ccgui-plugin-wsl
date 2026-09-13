import { getHostCtx } from "./host";

/** 插件 KV 持久化（ctx.storage 单键对象；react-doctor store.ts 同款思路）。
 *  tmd 把 defaultDistro/remoteHostId 放宿主 settings.wsl 域 —— 本插件无宿主
 *  settings 面，三值收敛进自己的 KV。 */

export interface WslHostEntry {
  id: string;
  /** 显示名（host form 存 user@host）。 */
  name: string;
  host: string;
  port: number;
  user: string;
}

export interface WslPrefs {
  /** 卡内「设默认」记住的发行版（空串 = 显示全部）。 */
  defaultDistro: string;
  /** 远程下拉当前选中的主机 id。 */
  remoteHostId: string;
  hosts: WslHostEntry[];
}

const KEY = "prefs";

function sanitizePrefs(v: unknown): WslPrefs {
  const p = (typeof v === "object" && v !== null ? v : {}) as Partial<WslPrefs>;
  const hosts = Array.isArray(p.hosts)
    ? p.hosts
        .filter((h): h is WslHostEntry => !!h && typeof h === "object")
        .map((h) => ({
          id: String(h.id ?? ""),
          name: String(h.name ?? ""),
          host: String(h.host ?? ""),
          port: Number(h.port) || 22,
          user: String(h.user ?? ""),
        }))
        .filter((h) => h.id && h.host && h.user)
    : [];
  return {
    defaultDistro: typeof p.defaultDistro === "string" ? p.defaultDistro.slice(0, 100) : "",
    remoteHostId: typeof p.remoteHostId === "string" ? p.remoteHostId.slice(0, 100) : "",
    hosts,
  };
}

export async function loadPrefs(): Promise<WslPrefs> {
  return sanitizePrefs(await getHostCtx().storage.get<WslPrefs>(KEY));
}

export function savePrefs(prefs: WslPrefs): Promise<void> {
  return getHostCtx().storage.set(KEY, prefs);
}
