/**
 * 「添加 WSL 工作区」独立页(tmd AddWslTab 的 codemoss 复刻)。
 *
 * 入口:composer「+」菜单的「WSL 发行版工作区」行 → #/p/plugin:wsl:add-workspace。
 * 流程(与 tmd 一致):选远程宿主 → 连接探测 → 选发行版 → 浏览目录 →
 * 「添加工作区」(登记进宿主侧栏 + 插件 KV)。
 */

import { useEffect, useState } from "react";
import { CaretDownIcon, CaretRightIcon, DesktopIcon } from "./icons";
import { copy, getHostCtx } from "./host";
import { loadPrefs, savePrefs, type WslHostEntry, type WslPrefs, type WslWorkspaceMeta } from "./store";
import { probeRemote, type SshLink, type WslDistro, type WslInfo } from "./wsl";
import { DistroPanel } from "./DistroPanel";

export function AddWorkspacePage({ locale }: { locale: string }) {
  const t = copy(locale);
  const [prefs, setPrefs] = useState<WslPrefs | null>(null);
  const [hostId, setHostId] = useState("");
  const [info, setInfo] = useState<WslInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDistro, setOpenDistro] = useState<string | null>(null);

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
    setError(null);
    try {
      let r = await probeRemote(link(selected));
      if (r?.available && selected.password && !selected.controlPath) {
        const { ensureControlMaster } = await import("./wsl");
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
      setInfo(r);
      // 单发行版直接展开(tmd 同款便利)
      if (r?.available && r.distros.length === 1) setOpenDistro(r.distros[0]?.name ?? null);
    } catch (e) {
      setInfo(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const updatePrefs = (patch: Partial<WslPrefs>) => {
    setPrefs((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void savePrefs(next).catch(() => {});
      return next;
    });
  };

  if (!prefs) return <div className="wsl-card wsl-hint">…</div>;

  return (
    <div className="wsl-addpage">
      <div className="wsl-addpage-head">
        <DesktopIcon size="1rem" />
        <b>{t.addPageTitle}</b>
        <span className="wsl-hint">{t.addPageDesc}</span>
      </div>
      <div className="wsl-remote-row">
        <span>{t.remoteHost}</span>
        <select value={hostId} onChange={(e) => setHostId(e.target.value)}>
          <option value="">{t.unselected}</option>
          {prefs.hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.user}@{h.host}:{h.port}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wsl-btn primary"
          disabled={!selected || connecting}
          onClick={() => void connect()}
        >
          {connecting ? t.statusDetecting : t.connect}
        </button>
      </div>
      {prefs.hosts.length === 0 && (
        <div className="wsl-hint">
          {t.noHosts} ·{" "}
          <button
            type="button"
            className="wsl-btn ghost"
            onClick={() => {
              window.location.hash = "/settings?page=plugin%3Awsl";
            }}
          >
            {t.sectionLabel}
          </button>
        </div>
      )}
      {error && <div className="wsl-remote-err">{error}</div>}
      {info?.available &&
        info.distros.map((d) => (
          <DistroBlock
            key={d.name}
            distro={d}
            open={openDistro === d.name}
            onToggle={() => setOpenDistro(openDistro === d.name ? null : d.name)}
            link={selected ? link(selected) : null}
            prefs={prefs}
            updatePrefs={updatePrefs}
            locale={locale}
          />
        ))}
    </div>
  );
}

function DistroBlock({
  distro,
  open,
  onToggle,
  link,
  prefs,
  updatePrefs,
  locale,
}: {
  distro: WslDistro;
  open: boolean;
  onToggle: () => void;
  link: SshLink | null;
  prefs: WslPrefs;
  updatePrefs: (patch: Partial<WslPrefs>) => void;
  locale: string;
}) {
  const t = copy(locale);
  return (
    <div className="wsl-distro-block">
      <button type="button" className="wsl-distro-row wsl-distro-toggle" onClick={onToggle}>
        {open ? <CaretDownIcon /> : <CaretRightIcon />}
        <span className={`wsl-dot ${distro.running ? "ok" : ""}`} aria-hidden />
        <span className="wsl-distro-name">{distro.name}</span>
        <span className="wsl-distro-ver">WSL {distro.version}</span>
        <span className={`wsl-distro-state ${distro.running ? "wsl-ok" : ""}`}>
          {distro.running ? t.running : t.stopped}
        </span>
      </button>
      {open && link && (
        <DistroPanel
          distro={distro}
          link={link}
          prefs={prefs}
          updatePrefs={updatePrefs}
          locale={locale}
        />
      )}
    </div>
  );
}

/** 打开本页(供 add-menu 行调用):hash 路由到注册页。 */
export function openAddWorkspacePage() {
  window.location.hash = "/p/plugin:wsl:add-workspace";
}

/** 供 DistroPanel 登记成功后在宿主侧栏落地(错误上抛,不再静默)。 */
export async function addWorkspaceToHost(
  path: string,
  meta: WslWorkspaceMeta,
): Promise<void> {
  const api = getHostCtx() as unknown as {
    workspaces?: { add?: (p: string, m: Record<string, unknown>) => Promise<void> };
  };
  if (!api.workspaces?.add) {
    throw new Error(copy("zh").hostMountMissing);
  }
  await api.workspaces.add(path, { wsl: meta });
}
