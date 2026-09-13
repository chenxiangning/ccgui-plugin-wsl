/**
 * 「添加 WSL 工作区」页(tmd AddWslTab 的 codemoss 复刻,紧凑单表单):
 * composer「+」菜单「WSL 发行版工作区」行 → #/p/plugin:wsl:add-workspace。
 * 选宿主 → 连接探测 → 选发行版(select)→ 浏览目录(crumb + 仅目录列表)→
 * 「添加」:宿主 ctx.workspaces.add(失败红字上抛,不静默)+ 插件 KV。
 */

import { useCallback, useEffect, useState } from "react";
import { copy, getHostCtx } from "./host";
import { loadPrefs, savePrefs, type WslHostEntry, type WslPrefs, type WslWorkspaceMeta } from "./store";
import { listDirRemote, probeRemote, ensureControlMaster, type DirEntry, type SshLink, type WslDistro, type WslInfo } from "./wsl";

function joinPath(base: string, name: string): string {
  if (base === "~") return `~/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function parentOf(p: string): string {
  if (p === "~" || p === "/") return p;
  const up = p.replace(/\/[^/]+$/, "");
  return up === "" ? "/" : up;
}

/** tmd wslWorkspaceTargetOk 同款闸:远程要求非空且 ≠ ~。 */
function targetOk(dir: string): boolean {
  return dir.length > 0 && dir !== "~";
}

export function AddWorkspacePage({ locale }: { locale: string }) {
  const t = copy(locale);
  const [prefs, setPrefs] = useState<WslPrefs | null>(null);
  const [hostId, setHostId] = useState("");
  const [info, setInfo] = useState<WslInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [distro, setDistro] = useState("");
  const [dir, setDir] = useState("~");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [addedPath, setAddedPath] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadPrefs()
      .then((p) => {
        setPrefs(p);
        setHostId(p.remoteHostId || p.hosts[0]?.id || "");
      })
      .catch(() => setPrefs({ defaultDistro: "", remoteHostId: "", hosts: [], workspaces: {} }));
  }, []);

  const selected = prefs?.hosts.find((h) => h.id === hostId) ?? null;

  const link = (h: WslHostEntry): SshLink => ({
    target: { host: h.host, port: h.port, user: h.user },
    password: h.password || undefined,
    controlPath: h.controlPath,
  });

  const connect = async () => {
    if (!selected || !prefs) return;
    setConnecting(true);
    setLoadErr(null);
    setEntries(null);
    setInfo(null);
    try {
      let r = await probeRemote(link(selected));
      if (r?.available && selected.password && !selected.controlPath) {
        const cp = await ensureControlMaster(link(selected), selected.id);
        if (cp) {
          const next: WslPrefs = {
            ...prefs,
            hosts: prefs.hosts.map((x) => (x.id === selected.id ? { ...x, controlPath: cp } : x)),
          };
          setPrefs(next);
          void savePrefs(next).catch(() => {});
          r = await probeRemote({ target: link(selected).target, controlPath: cp });
        }
      }
      if (r?.available && r.distros.length) {
        setInfo(r);
        setDistro((r.distros.find((d) => d.default) ?? r.distros[0]).name);
      } else {
        setLoadErr(t.remoteNoWsl);
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const loadDir = useCallback(
    (path: string) => {
      if (!distro || !selected) return;
      setDirErr(null);
      void listDirRemote(link(selected), distro, path)
        .then((r) => {
          setDir(path);
          setEntries(r);
        })
        .catch((e) => setDirErr(e instanceof Error ? e.message : String(e)));
    },
    [distro, selected],
  );

  const add = async () => {
    const target = dir.trim();
    if (!distro || !selected || !targetOk(target) || !prefs) return;
    setAdding(true);
    setDirErr(null);
    const meta: WslWorkspaceMeta = {
      hostId: selected.id,
      distro,
      host: selected.host,
      port: selected.port,
      user: selected.user,
      controlPath: selected.controlPath,
      workspace: target,
    };
    try {
      // 失败必须上抛:只有宿主真登记成功才标记已添加。
      await addWorkspaceToHost(target, meta);
      const next: WslPrefs = { ...prefs, workspaces: { ...prefs.workspaces, [target]: meta } };
      setPrefs(next);
      void savePrefs(next).catch(() => {});
      setAddedPath(target);
    } catch (e) {
      setDirErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  if (!prefs) return <div className="wsl-addpage wsl-hint">…</div>;

  return (
    <div className="wsl-addpage">
      <label className="wsl-field">
        <span>{t.remoteHost}</span>
        <select
          value={hostId}
          onChange={(e) => {
            setHostId(e.target.value);
            setInfo(null);
            setEntries(null);
            setAddedPath(null);
          }}
        >
          <option value="">{t.unselected}</option>
          {prefs.hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.user}@{h.host}:{h.port}
            </option>
          ))}
        </select>
        <button type="button" className="wsl-btn" disabled={!selected || connecting} onClick={() => void connect()}>
          {connecting ? t.statusDetecting : t.connect}
        </button>
      </label>
      {prefs.hosts.length === 0 && <div className="wsl-hint">{t.noHosts}</div>}
      {loadErr && <div className="wsl-remote-err">{loadErr}</div>}
      {info?.available && info.distros.length > 0 && (
        <label className="wsl-field">
          <span>{t.distroLabel}</span>
          <select
            value={distro}
            onChange={(e) => {
              setDistro(e.target.value);
              setEntries(null);
              setAddedPath(null);
            }}
          >
            {info.distros.map((d: WslDistro) => (
              <option key={d.name} value={d.name}>
                {d.name}({d.running ? t.running : t.stopped})
              </option>
            ))}
          </select>
        </label>
      )}
      {distro && selected && (
        <div className="wsl-dir-browser">
          <div className="wsl-dir-crumb">
            <button type="button" className="wsl-btn ghost" onClick={() => loadDir(dir === "~" ? "~" : parentOf(dir))}>
              {t.goUp}
            </button>
            <code title={dir}>{dir}</code>
            <button type="button" className="wsl-btn ghost" onClick={() => loadDir(dir)}>
              {t.refresh}
            </button>
          </div>
          {dirErr && <div className="wsl-remote-err">{dirErr}</div>}
          {addedPath && <div className="wsl-hint">{t.addedHint(addedPath)}</div>}
          {entries === null && !dirErr && (
            <button type="button" className="wsl-btn" onClick={() => loadDir("~")}>
              {t.browse}
            </button>
          )}
          {entries !== null && (
            <div className="wsl-dir-list">
              {(() => {
                const dirs = entries.filter((e) => e.isDir);
                return dirs.length ? (
                  dirs.map((e) => (
                    <button key={e.name} type="button" className="wsl-dir-row" onClick={() => loadDir(joinPath(dir, e.name))}>
                      {e.name}/
                    </button>
                  ))
                ) : (
                  <span className="wsl-hint">{t.dirEmpty}</span>
                );
              })()}
            </div>
          )}
          <div className="wsl-hint">{t.addHint}</div>
        </div>
      )}
      <div className="wsl-dialog-foot">
        <button
          type="button"
          className="wsl-btn primary"
          disabled={!distro || !targetOk(dir.trim()) || !entries || adding}
          onClick={() => void add()}
        >
          {adding ? t.statusDetecting : t.addWorkspaceBtn}
        </button>
      </div>
    </div>
  );
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

/** 打开本页(hash 路由)。 */
export function openAddWorkspacePage() {
  window.location.hash = "/p/plugin:wsl:add-workspace";
}
