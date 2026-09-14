import { copy, getHostCtx } from "./host";
import type { SshLink } from "./wsl";

/** 插件 KV 持久化(ctx.storage 单键对象;react-doctor store.ts 同款思路)。
 *  tmd 把 defaultDistro/remoteHostId 放宿主 settings.wsl 域 —— 本插件无宿主
 *  settings 面,全部收敛进自己的 KV。 */

export interface WslHostEntry {
  id: string;
  /** 显示名(host form 存 user@host)。 */
  name: string;
  host: string;
  port: number;
  user: string;
  /** 密码(可选;明文存本机插件 KV —— expect 非交互送入用)。 */
  password?: string;
  /** ControlMaster 套接字路径(密码用户连接成功后建立;key 用户无)。 */
  controlPath?: string;
}

export interface WslWorkspaceMeta {
  hostId: string;
  distro: string;
  /** 远程宿主连接参数(宿主 spawn 引擎时组装 ssh argv 用)。 */
  host: string;
  port: number;
  user: string;
  /** ControlMaster 路径;缺省 = 宿主侧 BatchMode(key 认证)。 */
  controlPath?: string;
  /** 发行版内工作区路径(宿主 spawn 的 cd 目标;= 登记键)。 */
  workspace?: string;
  /** 引擎 bin → 发行版内绝对路径(探针检出;宿主 spawn 用它替换本机 argv[0])。 */
  enginePaths?: Record<string, string>;
}

export interface WslPrefs {
  /** 卡内「设默认」记住的发行版(空串 = 显示全部)。 */
  defaultDistro: string;
  /** 远程下拉当前选中的主机 id。 */
  remoteHostId: string;
  hosts: WslHostEntry[];
  /** 插件登记的 WSL 工作区:path → 元数据(panel-tab 文件面板据此接管)。 */
  workspaces: Record<string, WslWorkspaceMeta>;
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
          password: typeof h.password === "string" && h.password ? h.password.slice(0, 200) : undefined,
          controlPath:
            typeof h.controlPath === "string" && h.controlPath ? h.controlPath.slice(0, 200) : undefined,
        }))
        .filter((h) => h.id && h.host && h.user)
    : [];
  const workspaces: Record<string, WslWorkspaceMeta> = {};
  if (typeof p.workspaces === "object" && p.workspaces !== null) {
    for (const [k, v] of Object.entries(p.workspaces)) {
      if (typeof k === "string" && k && typeof v === "object" && v !== null) {
        const meta = v as Partial<WslWorkspaceMeta>;
        if (meta.hostId && meta.distro && meta.host && meta.user) {
          const enginePaths: Record<string, string> = {};
          if (typeof meta.enginePaths === "object" && meta.enginePaths !== null) {
            for (const [bin, path] of Object.entries(meta.enginePaths)) {
              if (bin && typeof path === "string" && path.startsWith("/")) {
                enginePaths[bin.slice(0, 40)] = path.slice(0, 300);
              }
            }
          }
          workspaces[k] = {
            hostId: String(meta.hostId),
            distro: String(meta.distro),
            host: String(meta.host),
            port: Number(meta.port) || 22,
            user: String(meta.user),
            controlPath:
              typeof meta.controlPath === "string" && meta.controlPath
                ? meta.controlPath.slice(0, 200)
                : undefined,
            workspace: typeof meta.workspace === "string" && meta.workspace ? meta.workspace.slice(0, 300) : undefined,
            enginePaths: Object.keys(enginePaths).length ? enginePaths : undefined,
          };
        }
      }
    }
  }
  return {
    defaultDistro: typeof p.defaultDistro === "string" ? p.defaultDistro.slice(0, 100) : "",
    remoteHostId: typeof p.remoteHostId === "string" ? p.remoteHostId.slice(0, 100) : "",
    hosts,
    workspaces,
  };
}

let prefsCache: WslPrefs | null = null;

/** 同步读取最近一次加载/保存的 prefs(workspace-UI 桥用;未加载过 = null)。 */
export function cachedPrefs(): WslPrefs | null {
  return prefsCache;
}

export async function loadPrefs(): Promise<WslPrefs> {
  prefsCache = sanitizePrefs(await getHostCtx().storage.get<WslPrefs>(KEY));
  return prefsCache;
}

export function savePrefs(prefs: WslPrefs): Promise<void> {
  prefsCache = prefs;
  return getHostCtx().storage.set(KEY, prefs);
}

/** 工作区元数据 → ssh 链路(共用形态:不带 meta.controlPath 快照 —— 快照的
 *  ControlMaster 套接字陈旧时 ssh 255,现场连接才可靠)。 */
export function linkOf(prefs: WslPrefs, meta: WslWorkspaceMeta): SshLink | null {
  const host = prefs.hosts.find((h) => h.id === meta.hostId);
  if (!host) return null;
  return {
    target: { host: host.host, port: host.port, user: host.user },
    password: host.password || undefined,
  };
}

/** 远程目录浏览器共用:base 下拼子项(`~`/`/` 特判)。 */
export function joinPath(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  if (base === "~") return `~/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

/** 登记进宿主侧栏(错误上抛,由调用方呈现)。 */
export async function addWorkspaceToHost(path: string, meta: WslWorkspaceMeta): Promise<void> {
  const api = getHostCtx() as unknown as {
    workspaces?: { add?: (p: string, m: Record<string, unknown>) => Promise<void> };
  };
  if (!api.workspaces?.add) {
    throw new Error(copy("zh").hostMountMissing);
  }
  await api.workspaces.add(path, { wsl: meta });
}
