/**
 * 添加 WSL 工作区滑出浮层(tmd wsadd-pop 复刻)—— 从侧栏工作区区左侧
 * 滑入,发行版下拉 + 目录懒浏览 + 登记。createPortal 挂 body,脱离任何
 * 宿主滚动容器;背板点击关闭。登记逻辑复用 AddWorkspacePage 的
 * addWorkspaceToHost(探针 enginePaths + 失败上抛)。
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { copy, getHostCtx, type Copy } from "./host";
import { loadPrefs, savePrefs, type WslHostEntry, type WslPrefs } from "./store";
import {
  ensureControlMaster,
  listDirRemote,
  probeEnginesRemote,
  PROBE_BINS,
  probeRemote,
  type DirEntry,
  type SshLink,
  type WslDistro,
  type WslInfo,
} from "./wsl";
import { addWorkspaceToHost, joinPath } from "./store";

function parentOf(p: string): string {
  if (p === "~" || p === "/") return p;
  const up = p.replace(/\/[^/]+$/, "");
  return up === "" ? "/" : up;
}

/** 「+」菜单入口:全局开浮层事件(add-menu 行 onSelect 派发)。 */
export const WSL_ADD_POP_EVENT = "wsl:add-workspace-pop";

export function openAddWorkspacePop(): void {
  window.dispatchEvent(new CustomEvent(WSL_ADD_POP_EVENT));
}

/** 目录懒加载小面板(选中 = 回填路径)。 */
function DirBrowser({
  link,
  distro,
  onPick,
  t,
}: {
  link: SshLink;
  distro: string;
  onPick: (path: string) => void;
  t: Copy;
}) {
  const [dir, setDir] = useState("~");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    (path: string) => {
      setErr(null);
      void listDirRemote(link, distro, path)
        .then((r) => {
          setDir(path);
          setEntries(r.filter((e) => e.isDir));
          // tmd 语义:浏览到哪 = 选中到哪(独立 target 态会让行点击永不
          // 回填,添加按钮恒灰)。
          onPick(path);
        })
        .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    },
    [link, distro, onPick],
  );

  useEffect(() => {
    load("~");
  }, [load]);

  return (
    <div className="wsl-dir-browser">
      <div className="wsl-dir-crumb">
        <button type="button" className="wsl-btn ghost" onClick={() => load(parentOf(dir))}>
          {t.goUp}
        </button>
        <code title={dir}>{dir}</code>
        <button type="button" className="wsl-btn ghost" onClick={() => load(dir)}>
          {t.refresh}
        </button>
      </div>
      {err && <div className="wsl-remote-err">{err}</div>}
      {entries !== null && (
        <div className="wsl-dir-list">
          {entries.map((e) => (
            <button
              key={e.name}
              type="button"
              className="wsl-dir-row"
              onClick={() => {
                const next = joinPath(dir, e.name);
                setDir(next);
                load(next);
              }}
            >
              {e.name}/
            </button>
          ))}
          {entries.length === 0 && <span className="wsl-hint">{t.dirEmpty}</span>}
        </div>
      )}
    </div>
  );
}

export function AddWorkspacePop({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<WslPrefs | null>(null);
  const [hostId, setHostId] = useState<string>("");
  const [distros, setDistros] = useState<WslDistro[] | null>(null);
  const [info, setInfo] = useState<WslInfo | null>(null);
  const [distro, setDistro] = useState("");
  const [link, setLink] = useState<SshLink | null>(null);
  const [target, setTarget] = useState("~");
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const t = copy(getHostCtx()?.host.locale ?? "zh-CN");

  useEffect(() => {
    void loadPrefs().then((p) => {
      setPrefs(p);
      if (p?.hosts.length) setHostId((cur) => cur || p.hosts[0]!.id);
    });
  }, []);

  // 选宿主 → 连接(ControlMaster)→ 发行版表
  useEffect(() => {
    if (!prefs || !hostId) return;
    const host = prefs.hosts.find((x) => x.id === hostId);
    if (!host) return;
    let cancelled = false;
    setDistros(null);
    setDistro("");
    setErr(null);
    const l: SshLink = {
      target: { host: host.host, port: host.port, user: host.user },
      password: host.password,
    };
    void (async () => {
      try {
        l.controlPath = (await ensureControlMaster(l, host.id)) ?? undefined;
      } catch {
        /* 无 expect/key 失败时探测仍可能经 BatchMode 成功 */
      }
      if (cancelled) return;
      setLink(l);
      try {
        const table = await probeRemote(l);
        if (cancelled) return;
        setInfo(table);
        setDistros(table.distros);
        const def = table.distros.find((d) => d.running) ?? table.distros[0];
        if (def) setDistro(def.name);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prefs, hostId]);

  const add = async () => {
    if (!distro || !link || !prefs) return;
    setAdding(true);
    setErr(null);
    const host = prefs.hosts.find((x) => x.id === hostId);
    if (!host) return;
    const meta = {
      hostId: host.id,
      distro,
      host: host.host,
      port: host.port,
      user: host.user,
      controlPath: link.controlPath,
      workspace: target,
    };
    try {
      // 引擎探针(失败不挡登记:enginePaths 空 = 菜单不过滤)。
      try {
        const probes = await probeEnginesRemote(distro, PROBE_BINS, link);
        const enginePaths: Record<string, string> = {};
        for (const p of probes) if (p.path) enginePaths[p.bin] = p.path;
        if (Object.keys(enginePaths).length)
          (meta as { enginePaths?: Record<string, string> }).enginePaths = enginePaths;
      } catch {
        /* 探针失败不挡登记 */
      }
      await addWorkspaceToHost(target, meta);
      const next: WslPrefs = { ...prefs, workspaces: { ...prefs.workspaces, [target]: meta } };
      setPrefs(next);
      void savePrefs(next).catch(() => {});
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  return createPortal(
    <>
      <div className="wsl-pop-backdrop" role="presentation" onClick={onClose} />
      <div className="wsl-addpop" role="dialog" aria-label={t.addPageTitle} onClick={(e) => e.stopPropagation()}>
        <div className="wsl-addpop-head">
          <span>{t.addWorkspaceBtn}</span>
          <button type="button" className="wsl-addpop-x" onClick={onClose} aria-label="×">
            ×
          </button>
        </div>

        <label className="wsl-field">
          <span>{t.unselected}</span>
          <select value={hostId} onChange={(e) => setHostId(e.target.value)}>
            {(prefs?.hosts ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
            {!prefs?.hosts.length && <option value="">{t.unselected}</option>}
          </select>
        </label>

        <label className="wsl-field">
          <span>{t.distroLabel}</span>
          <select
            value={distro}
            onChange={(e) => setDistro(e.target.value)}
            disabled={!distros}
          >
            {distros ? (
              distros.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}({d.running ? t.running : t.stopped})
                </option>
              ))
            ) : (
              <option value="">{t.statusDetecting}</option>
            )}
          </select>
        </label>

        {link && distro && <DirBrowser link={link} distro={distro} onPick={setTarget} t={t} />}

        {info && (
          <div className="wsl-hint">
            {t.distroLabel}: {info.wslVersion}
          </div>
        )}
        {err && <div className="wsl-remote-err">{err}</div>}

        <div className="wsl-addpop-foot">
          <button
            type="button"
            className="wsl-btn primary"
            disabled={adding || !distro || !link || target === "~"}
            onClick={() => void add()}
          >
            {adding ? t.statusDetecting : t.addWorkspaceBtn}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
