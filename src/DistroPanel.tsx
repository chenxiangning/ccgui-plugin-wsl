/**
 * 远程发行版子面板(tmd DistroPanel 移植)—— 引擎探针 + 起始目录浏览 + 添加工作区。
 *
 * 目录浏览的选值有三个消费方:文件面板根、添加工作区的目录参数。添加工作区 =
 * prefs.workspaces 登记(path → {hostId, distro},文件面板据此接管)+ 经宿主
 * 挂点 ctx.workspaces.add(可选链,宿主未升级时仅登记,文件面板仍可用)。
 * 探针 bins:tmd 取宿主 cli profile 清单 —— 插件无 profile 注册表,用固定清单。
 */

// ponytail: bins 固定清单,profile 驱动需宿主暴露引擎注册表后再换
export const PROBE_BINS = ["claude", "codex", "omp", "dsh", "gemini", "qwen"];

import { useCallback, useEffect, useState } from "react";
import { copy } from "./host";
import { addWorkspaceToHost } from "./AddWorkspacePage";
import type { WslPrefs, WslWorkspaceMeta } from "./store";
import {
  listDirRemote,
  probeEnginesRemote,
  type DirEntry,
  type EngineProbe,
  type SshLink,
  type WslDistro,
} from "./wsl";

function joinPath(base: string, name: string): string {
  if (base === "/" ) return `/${name}`;
  if (base === "~") return `~/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

export function DistroPanel({
  distro,
  link,
  prefs,
  updatePrefs,
  locale,
}: {
  distro: WslDistro;
  link: SshLink;
  prefs: WslPrefs;
  updatePrefs: (patch: Partial<WslPrefs>) => void;
  locale: string;
}) {
  const t = copy(locale);
  const [probes, setProbes] = useState<EngineProbe[] | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [dir, setDir] = useState<string | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [regErr, setRegErr] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProbes(null);
    setProbeErr(null);
    void probeEnginesRemote(distro.name, PROBE_BINS, link)
      .then((r) => {
        if (!cancelled) setProbes(r);
      })
      .catch((e) => {
        if (!cancelled) setProbeErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // 探针一次即可;link 身份变化时重跑
  }, [distro.name, link.target.host, link.target.port, link.target.user, link.password]);

  const loadDir = useCallback(
    async (path: string) => {
      setDirErr(null);
      try {
        const r = await listDirRemote(link, distro.name, path);
        setEntries(r.filter((e) => e.isDir));
        setDir(path);
      } catch (e) {
        setDirErr(e instanceof Error ? e.message : String(e));
      }
    },
    [link, distro.name],
  );

  const register = async () => {
    if (!dir || dir === "~") return;
    const path = dir;
    const host = prefs.hosts.find((x) => x.id === prefs.remoteHostId);
    if (!host) return;
    const enginePaths: Record<string, string> = {};
    for (const p of probes ?? []) if (p.path) enginePaths[p.bin] = p.path;
    const meta: WslWorkspaceMeta = {
      hostId: host.id,
      distro: distro.name,
      host: host.host,
      port: host.port,
      user: host.user,
      controlPath: host.controlPath,
      workspace: path,
      enginePaths: Object.keys(enginePaths).length ? enginePaths : undefined,
    };
    setRegErr(null);
    try {
      // 宿主挂点:登记进侧栏工作区(meta 带连接参数 + 发行版内 bin 路径)。
      // 失败必须上抛 —— 只有真登记成功才标记「已登记」。
      await addWorkspaceToHost(path, meta);
      updatePrefs({ workspaces: { ...prefs.workspaces, [path]: meta } });
      setAdded(path);
    } catch (e) {
      setRegErr(e instanceof Error ? e.message : String(e));
    }
  };

  const up = dir && dir !== "~" && dir !== "/" ? dir.replace(/\/[^/]+$/, "") || "/" : null;
  const registered = dir ? prefs.workspaces[dir] !== undefined : false;

  return (
    <div className="wsl-distro-panel">
      <div className="wsl-panel-sec">
        <span className="wsl-panel-lbl">{t.engineProbe}</span>
        <span className="wsl-hint">{t.probeHint}</span>
        <div className="wsl-desc">
          <Hl text={t.probeDesc} />
        </div>
        {probeErr && <div className="wsl-remote-err">{probeErr}</div>}
        <div className="wsl-probe-grid">
          {probes?.map((p) => (
            <div key={p.bin} className={`wsl-probe-row ${p.path ? "on" : "off"}`} title={p.path ?? t.notFound}>
              <span className={`wsl-dot ${p.path ? "ok" : ""}`} aria-hidden />
              <span className="wsl-probe-bin">{p.bin}</span>
              {p.path ? (
                <>
                  <span className="wsl-probe-path">{p.path}</span>
                  <span className="wsl-probe-tag">{t.available}</span>
                </>
              ) : (
                <span className="wsl-probe-path wsl-probe-miss">{t.notFound}</span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="wsl-panel-sec">
        <span className="wsl-panel-lbl">{t.dirTitle}</span>
        <div className="wsl-dir-crumb">
          <button type="button" className="wsl-btn ghost" onClick={() => void loadDir(dir ?? "~")}>
            {dir === null ? t.browse : t.refresh}
          </button>
          <code>{dir ?? "~"}</code>
        </div>
        <div className="wsl-desc">
          <Hl text={t.dirDesc} />
        </div>
        {dirErr && <div className="wsl-remote-err">{dirErr}</div>}
        {entries !== null && (
          <div className="wsl-dir-list">
            {up !== null && (
              <button type="button" className="wsl-dir-row" onClick={() => void loadDir(up)} aria-label={t.goUp}>
                ..
              </button>
            )}
            {entries.map((e) => (
              <button
                key={e.name}
                type="button"
                className={`wsl-dir-row ${dir === joinPath(dir ?? "~", e.name) ? "on" : ""}`}
                onClick={() => void loadDir(joinPath(dir ?? "~", e.name))}
              >
                {e.name}
              </button>
            ))}
            {entries.length === 0 && <span className="wsl-hint">{t.fileEmptyDir}</span>}
          </div>
        )}
        <div className="wsl-actions">
          <button
            type="button"
            className="wsl-btn primary"
            disabled={!dir || dir === "~" || registering}
            onClick={() => {
              setRegistering(true);
              void register().finally(() => setRegistering(false));
            }}
          >
            {registering ? t.statusDetecting : t.addWorkspaceBtn}
          </button>
        </div>
        {regErr && <div className="wsl-remote-err">{regErr}</div>}
        {(added || registered) && <div className="wsl-hint">{t.addedHint(added ?? dir ?? "")}</div>}
      </div>
    </div>
  );
}

/** 文案高亮:把【关键词】染成强调色,详情描述共用(tmd 同款)。 */
export function Hl({ text }: { text: string }) {
  const parts = text.split(/【(.*?)】/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <b key={`${i}:${p}`} className="wsl-hl">{p}</b> : p))}
    </>
  );
}
