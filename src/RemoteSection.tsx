/**
 * WSL 卡远程连接段（tmd RemoteSection 移植）—— 经 SSH 连 Windows 宿主探测发行版。
 *
 * 主机簿：tmd 复用宿主 settings.ssh.hosts —— 插件无宿主 settings 面，自持
 * prefs.hosts（下拉 + 手动添加表单，同 host|port|user 查重）。连接 = 三条诊断
 * 命令各一次 ssh（BatchMode，仅 key 认证）。「SSH 进入」依赖宿主会话面，裁除；
 * 发行版面板只余引擎探针。
 */

import { useState } from "react";
import { CaretDownIcon, CaretRightIcon, PlusIcon } from "./icons";
import { copy } from "./host";
import type { WslPrefs, WslHostEntry } from "./store";
import { probeRemote, type SshTarget, type WslInfo } from "./wsl";
import { DistroPanel, Hl } from "./DistroPanel";

/** 非 Windows 开发机(mac)无 wsl.exe/远程宿主时的 UI 预览桩:仅 DEV 生效(tmd 同款)。 */
const DEV_REMOTE_FALLBACK: WslInfo = {
  available: true,
  wslVersion: "WSL 2.4.13(dev 预览桩)",
  distros: [{ name: "Ubuntu", version: 2, running: true, default: true }],
  linuxHome: null,
  linuxUser: null,
};

function identityKey(h: { host: string; port: number; user: string }): string {
  return `${h.host.trim().toLowerCase()}|${h.port || 22}|${h.user.trim().toLowerCase()}`;
}

export function WslRemoteSection({
  prefs,
  updatePrefs,
  locale,
}: {
  prefs: WslPrefs;
  updatePrefs: (patch: Partial<WslPrefs>) => void;
  locale: string;
}) {
  const t = copy(locale);
  const hosts = prefs.hosts;
  const selected = hosts.find((h) => h.id === prefs.remoteHostId) ?? null;
  const [info, setInfo] = useState<WslInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [openDistro, setOpenDistro] = useState<string | null>(null);
  const [host_, setHost_] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);

  const pickHost = (id: string) => {
    updatePrefs({ remoteHostId: id });
    setInfo(null);
    setOpenDistro(null);
    setError(null);
  };

  const saveHost = () => {
    const h = host_.trim();
    const u = user.trim();
    if (!h || !u) {
      setFormErr(t.hostAndUserRequired);
      return;
    }
    const portNum = Math.min(Math.max(parseInt(port, 10) || 22, 1), 65535);
    if (hosts.some((x) => identityKey(x) === identityKey({ host: h, port: portNum, user: u }))) {
      setFormErr(t.hostExists);
      return;
    }
    const entry: WslHostEntry = {
      id: `ssh-${crypto.randomUUID().slice(0, 8)}`,
      name: `${u}@${h}`,
      host: h,
      port: portNum,
      user: u,
    };
    updatePrefs({ hosts: [...hosts, entry], remoteHostId: entry.id });
    setFormOpen(false);
    setFormErr(null);
  };

  const target = (h: WslHostEntry): SshTarget => ({ host: h.host, port: h.port, user: h.user });

  const probe = async () => {
    if (!selected || loading) return;
    setLoading(true);
    setError(null);
    setOpenDistro(null);
    try {
      const r = await probeRemote(target(selected));
      const eff = r?.available ? r : import.meta.env.DEV ? DEV_REMOTE_FALLBACK : null;
      setInfo(eff);
      /* 连接成功即自动展开默认发行版的探针面板(tmd 2026-09-14:免二次点击)。 */
      const first = eff ? (eff.distros.find((d) => d.default) ?? eff.distros[0]) : null;
      setOpenDistro(first ? first.name : null);
      if (!r?.available && !import.meta.env.DEV) setError(t.noWslOnHost);
    } catch (e) {
      /* 凭据/hostkey/网络错误在此如实呈现 —— 不留空白。 */
      setInfo(import.meta.env.DEV ? DEV_REMOTE_FALLBACK : null);
      if (import.meta.env.DEV) setOpenDistro(DEV_REMOTE_FALLBACK.distros[0].name);
      if (!import.meta.env.DEV) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wsl-remote">
      <div className="wsl-remote-row">
        <span className="wsl-remote-lbl">{t.remoteHost}</span>
        <select
          className="wsl-remote-select"
          value={selected?.id ?? ""}
          onChange={(e) => pickHost(e.target.value)}
          aria-label={t.remoteSelectAria}
        >
          <option value="">{hosts.length ? t.unselected : t.noHostYet}</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name || `${h.user}@${h.host}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wsl-btn ghost"
          title={t.addHostTitle}
          onClick={() => setFormOpen((v) => !v)}
        >
          <PlusIcon size="0.75rem" />
        </button>
        <button type="button" className="wsl-btn" disabled={!selected || loading} onClick={() => void probe()}>
          {loading ? t.connecting : t.connect}
        </button>
      </div>
      <div className="wsl-desc">
        <Hl text={t.remoteDesc} />
      </div>
      {formOpen && (
        <div className="wsl-host-form">
          <div className="wsl-host-grid">
            <label>
              <span>{t.addrLabel}</span>
              <input value={host_} onChange={(e) => setHost_(e.target.value)} placeholder="192.168.1.7" spellCheck={false} />
            </label>
            <label>
              <span>{t.portLabel}</span>
              <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              <span>{t.userLabel}</span>
              <input value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} />
            </label>
          </div>
          {formErr && <div className="wsl-remote-err">{formErr}</div>}
          <button type="button" className="wsl-btn" onClick={saveHost}>
            {t.saveAndSelect}
          </button>
          <div className="wsl-desc">{t.hostFormHint}</div>
        </div>
      )}
      {error && <div className="wsl-remote-err">{error}</div>}
      {info?.available &&
        info.distros.map((d) => (
          <div className="wsl-distro-block" key={d.name}>
            <button
              type="button"
              className="wsl-distro-row wsl-distro-toggle"
              onClick={() => setOpenDistro((cur) => (cur === d.name ? null : d.name))}
            >
              {openDistro === d.name ? (
                <CaretDownIcon />
              ) : (
                <CaretRightIcon />
              )}
              <span className={`wsl-dot ${d.running ? "ok" : ""}`} aria-hidden />
              <span className="wsl-distro-name">{d.name}</span>
              <span className="wsl-distro-ver">WSL {d.version}</span>
              <span className={`wsl-distro-state ${d.running ? "wsl-ok" : ""}`}>
                {d.running ? t.running : t.stopped}
              </span>
            </button>
            {openDistro === d.name && selected && (
              <DistroPanel distro={d} sshTarget={target(selected)} locale={locale} />
            )}
          </div>
        ))}
    </div>
  );
}
