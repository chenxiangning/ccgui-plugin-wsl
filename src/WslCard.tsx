/**
 * WSL 主机设置段 —— tmd-cli 中央 tab 卡（WslCard）的 codemoss 移植。
 *
 * 两段共存（tmd 2026-09-12 验收裁决后形态）：
 * - 本机段（仅本机 WSL 可用时渲染，即 Windows）：发行版枚举、设默认、重新检测；
 * - 远程段：经 SSH 连 Windows 宿主（插件自簿主机 + 手动添加表单），
 *   发行版行展开 DistroPanel（引擎探针）。
 * tmd 的「添加 WSL 工作区」「SSH 进入」依赖宿主工作区/会话面，SDK 无对应挂点，裁除。
 */

import { useCallback, useEffect, useState } from "react";
import { DesktopIcon } from "./icons";
import { copy, type Copy } from "./host";
import { loadPrefs, savePrefs, type WslPrefs } from "./store";
import { collectLocal, setDefaultDistro, type WslDistro, type WslInfo } from "./wsl";
import { WslRemoteSection } from "./RemoteSection";

/** 卡头状态行（本机检测态 / 本机不可用时的远程提示）。 */
function CardStatus({
  loading,
  info,
  shown,
  running,
  pinnedDistro,
  t,
}: {
  loading: boolean;
  info: WslInfo | null;
  shown: WslDistro[];
  running: number;
  pinnedDistro: string;
  t: Copy;
}) {
  if (!info) return <>{t.statusRemoteOnly}</>;
  if (loading) return <>{t.statusDetecting}</>;
  return (
    <>
      {t.connected} · {info.wslVersion ?? "wsl"} · {shown.length} {t.distroCountSuffix}
      {running > 0 && <span className="wsl-ok"> · {running} {t.running}</span>}
      {pinnedDistro && <span className="wsl-def"> · {pinnedDistro}</span>}
    </>
  );
}

/** 本机段：发行版行（设默认）+ 显示全部 + 事实行 + 动作。 */
function LocalSection({
  info,
  loading,
  shown,
  hiddenCount,
  pinnedDistro,
  onRefresh,
  onSetDefault,
  onShowAll,
  t,
}: {
  info: WslInfo;
  loading: boolean;
  shown: WslDistro[];
  hiddenCount: number;
  pinnedDistro: string;
  onRefresh: () => void;
  onSetDefault: (name: string) => void;
  onShowAll: () => void;
  t: Copy;
}) {
  const defaultName = pinnedDistro || (info.distros.find((x) => x.default) ?? info.distros[0])?.name;
  return (
    <>
      {shown.map((d) => (
        <div className="wsl-distro-row" key={d.name}>
          <span className={`wsl-dot ${d.running ? "ok" : ""}`} aria-hidden />
          <span className="wsl-distro-name">{d.name}</span>
          <span className="wsl-distro-ver">WSL {d.version}</span>
          <span className="wsl-distro-state">{d.running ? t.running : t.stopped}</span>
          <button
            type="button"
            className="wsl-btn ghost"
            disabled={d.name === defaultName}
            onClick={() => onSetDefault(d.name)}
          >
            {t.setDefault}
          </button>
        </div>
      ))}
      {hiddenCount > 0 && (
        <button type="button" className="wsl-btn ghost wsl-showall" onClick={onShowAll}>
          {t.showAll(hiddenCount)}
        </button>
      )}
      {info.linuxUser && (
        <div className="wsl-facts">
          {t.factsUser}:{info.linuxUser} · $HOME:{info.linuxHome ?? "—"}
        </div>
      )}
      <div className="wsl-card-actions">
        <button type="button" className="wsl-btn" onClick={onRefresh} disabled={loading}>
          {t.refresh}
        </button>
      </div>
      <div className="wsl-hint">{t.localHint}</div>
    </>
  );
}

export function WslCard({ locale }: { locale: string }) {
  const t = copy(locale);
  const [info, setInfo] = useState<WslInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<WslPrefs | null>(null);

  useEffect(() => {
    void loadPrefs().then(setPrefs).catch(() => setPrefs({ defaultDistro: "", remoteHostId: "", hosts: [] }));
  }, []);

  const updatePrefs = useCallback((patch: Partial<WslPrefs>) => {
    setPrefs((prev) => {
      const next = { ...(prev ?? { defaultDistro: "", remoteHostId: "", hosts: [] }), ...patch };
      void savePrefs(next).catch(() => {});
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    void (async () => {
      let r: WslInfo | null = null;
      try {
        r = await collectLocal();
      } catch {
        /* bridge 不可用/非桌面端：落不可用。 */
      }
      setInfo(r && r.available ? r : null);
    })().finally(() => setLoading(false));
  }, []);
  useEffect(refresh, [refresh]);

  const setDefault = async (name: string) => {
    try {
      /* wsl.exe 只认 --set-default(/setdefault 是 wslconfig 的语法);
         失败非零退出码必须查,不能静默写 prefs。 */
      const ok = await setDefaultDistro(name);
      if (!ok) {
        console.warn("wsl: 设默认发行版失败(wsl.exe 非零退出)");
        return;
      }
      updatePrefs({ defaultDistro: name });
      refresh();
    } catch (e) {
      console.warn("wsl: 设默认发行版失败", e);
    }
  };

  const distros = info?.distros ?? [];
  const pinnedDistro = prefs?.defaultDistro ?? "";
  const shown = pinnedDistro ? distros.filter((d) => d.name === pinnedDistro) : distros;
  const hiddenCount = distros.length - shown.length;
  const running = shown.filter((d) => d.running).length;

  return (
    <section className="wsl-card">
      <div className="wsl-card-head">
        <DesktopIcon size="0.875rem" />
        <b>WSL</b>
        <span className="wsl-card-status">
          <CardStatus
            loading={loading}
            info={info}
            shown={shown}
            running={running}
            pinnedDistro={pinnedDistro}
            t={t}
          />
        </span>
      </div>
      <div className="wsl-card-body">
        {info && (
          <LocalSection
            info={info}
            loading={loading}
            shown={shown}
            hiddenCount={hiddenCount}
            pinnedDistro={pinnedDistro}
            onRefresh={refresh}
            onSetDefault={(name) => void setDefault(name)}
            onShowAll={() => updatePrefs({ defaultDistro: "" })}
            t={t}
          />
        )}
        {prefs && (
          <WslRemoteSection prefs={prefs} updatePrefs={updatePrefs} locale={locale} />
        )}
      </div>
    </section>
  );
}
