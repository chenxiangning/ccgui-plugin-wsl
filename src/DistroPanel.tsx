/**
 * 远程发行版子面板（tmd DistroPanel 移植）—— 引擎探针。
 *
 * tmd 面板还有「起始目录」浏览段,其选值只被「SSH 进入」消费;插件无会话面,
 * 目录浏览随之裁除。探针 bins:tmd 取宿主 cli profile 清单 —— 插件无 profile
 * 注册表,用固定清单。
 */

// ponytail: bins 固定清单,profile 驱动需宿主暴露引擎注册表后再换
export const PROBE_BINS = ["claude", "codex", "omp", "dsh", "gemini", "qwen"];
import { copy } from "./host";
import { useEffect, useState } from "react";
import { probeEnginesRemote, type EngineProbe, type SshTarget, type WslDistro } from "./wsl";

export function DistroPanel({
  distro,
  sshTarget,
  locale,
}: {
  distro: WslDistro;
  sshTarget: SshTarget;
  locale: string;
}) {
  const t = copy(locale);
  const [probes, setProbes] = useState<EngineProbe[] | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProbes(null);
    setProbeErr(null);
    void probeEnginesRemote(distro.name, PROBE_BINS, sshTarget)
      .then((r) => {
        if (!cancelled) setProbes(r);
      })
      .catch((e) => {
        if (!cancelled) setProbeErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [distro.name, sshTarget.host, sshTarget.port, sshTarget.user]);

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
            <div
              key={p.bin}
              className={`wsl-probe-row ${p.path ? "on" : "off"}`}
              title={p.path ?? t.notFound}
            >
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
