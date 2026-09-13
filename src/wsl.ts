import { execRun } from "./caps";

/**
 * WSL 诊断与操作 —— tmd-cli src-tauri/src/wsl.rs / wsl_remote_ops.rs 的 TS 移植。
 *
 * 与 Rust 侧的两处差异：
 * - bridge 的 stdout 是宿主 Rust from_utf8_lossy 后的字符串：wsl.exe 表格的
 *   UTF-16LE 字节已打成 NUL 噪音。表格锚定列全是 ASCII（发行版名/`*`/版本号），
 *   剥掉 NUL 即无损还原；非 ASCII 只出现在状态列，解析从不读它（同 Rust 的
 *   locale 无关纪律）。
 * - 无长连 SSH 通道：远程探测走三次独立 ssh（BatchMode，仅 key 认证）。不做
 *   `;` 串接 —— Windows 宿主 DefaultShell 可能是 cmd.exe，对 `;` 无命令语义。
 */

export interface WslDistro {
  name: string;
  version: 1 | 2;
  running: boolean;
  default: boolean;
}

export interface WslInfo {
  /** false = 非 Windows / wsl.exe 不可用 / 超时 / 无发行版。 */
  available: boolean;
  wslVersion: string | null;
  distros: WslDistro[];
  /** 默认发行版 $HOME（发行版全停时冷启动，超时为 null）。 */
  linuxHome: string | null;
  /** 默认发行版登录用户。 */
  linuxUser: string | null;
}

export interface EngineProbe {
  bin: string;
  /** null = 未检出（含 /mnt/* Windows 互操作误检）。 */
  path: string | null;
}

export interface SshTarget {
  user: string;
  host: string;
  port: number;
}

const BIN = "wsl.exe";
const SSH_BIN = "ssh";

export function isWindowsPlatform(): boolean {
  return navigator.userAgent.includes("Windows");
}

const UNSUPPORTED_CHARS = /[^\x20-\x7e]/;

/** 发行版名/binary 名参数白名单（对齐 Rust validate_bin）。 */
function assertSafeToken(kind: string, value: string): void {
  if (value.length === 0 || UNSUPPORTED_CHARS.test(value)) {
    throw new Error(`${kind} 含不支持的字符: ${value}`);
  }
}

/** wsl.exe 诊断输出降噪：剥 NUL（UTF-16LE 被 lossy 后的残迹）与行首替换符。 */
function decodeWslOutput(text: string): string {
  return text.replace(/\0/g, "").replace(/^(\uFFFD)+/, "");
}

/** 解析 `wsl.exe -l -v` 表（locale 无关）：数据行 = 3 列（或 `*` 打头的 4 列）且
 *  末列 ∈ {1,2}（容忍 "2.0"）。表头任何语言都因末列非版本号被排除。
 *  已知限制：发行版名含空格会错位（Rust 侧同限制）。 */
export function parseWslList(text: string): WslDistro[] {
  const out: WslDistro[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    let def = false;
    let name: string | undefined;
    let ver: string | undefined;
    if (cols.length === 3) {
      name = cols[0];
      ver = cols[2];
    } else if (cols.length === 4 && cols[0] === "*") {
      def = true;
      name = cols[1];
      ver = cols[3];
    } else {
      continue;
    }
    const version = Number(ver?.replace(/\.0$/, ""));
    if ((version !== 1 && version !== 2) || Number.isNaN(version)) continue;
    out.push({ name: name ?? "", version: version as 1 | 2, running: false, default: def });
  }
  return out;
}

/** 用 `--running` 表的名字集合（ASCII 大小写不敏感）给全量表打 running 标。 */
export function markRunning(distros: WslDistro[], runningText: string): void {
  const names = parseWslList(runningText).map((d) => d.name.toLowerCase());
  for (const d of distros) d.running = names.includes(d.name.toLowerCase());
}

function unavailable(): WslInfo {
  return { available: false, wslVersion: null, distros: [], linuxHome: null, linuxUser: null };
}

/** wsl --version 输出取首个非空非 Copyright 行（trim 后整行）。 */
function firstVersionLine(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith("Copyright")) return line;
  }
  return null;
}

/** 默认发行版的 $HOME / 登录用户（发行版全停时触发 VM 冷启动，给 25s）。 */
async function probeLinuxFacts(): Promise<Pick<WslInfo, "linuxHome" | "linuxUser">> {
  try {
    const r = await execRun(BIN, ["-e", "sh", "-c", 'echo "$HOME"; id -un'], 25_000);
    if (r.code !== 0) return { linuxHome: null, linuxUser: null };
    const lines = r.stdout.split(/\r?\n/).map((l) => l.trim());
    return {
      linuxHome: lines[0]?.startsWith("/") ? (lines[0] ?? null) : null,
      linuxUser: lines[1] || null,
    };
  } catch {
    return { linuxHome: null, linuxUser: null };
  }
}

/** 本机 WSL 诊断（仅 Windows；其余平台直接不可用）。超时语义对齐 Rust collect()。 */
export async function collectLocal(): Promise<WslInfo> {
  if (!isWindowsPlatform()) return unavailable();
  let list: string;
  try {
    const r = await execRun(BIN, ["-l", "-v"], 15_000);
    if (r.code !== 0) return unavailable();
    list = decodeWslOutput(r.stdout);
  } catch {
    return unavailable();
  }
  const distros = parseWslList(list);
  if (distros.length === 0) return unavailable();
  try {
    const r = await execRun(BIN, ["-l", "-v", "--running"], 15_000);
    if (r.code === 0) markRunning(distros, decodeWslOutput(r.stdout));
  } catch {
    /* 老版 wsl.exe 不认 --running：静默按全停（同 Rust 宽容度）。 */
  }
  let wslVersion: string | null = null;
  try {
    const r = await execRun(BIN, ["--version"], 10_000);
    wslVersion = firstVersionLine(decodeWslOutput(r.stdout));
  } catch {
    /* 版本行缺省不影响可用性。 */
  }
  return { available: true, wslVersion, distros, ...(await probeLinuxFacts()) };
}

/** 设为默认发行版（wsl.exe 只认 --set-default；失败非零码必须查，不能静默）。 */
export async function setDefaultDistro(name: string): Promise<boolean> {
  assertSafeToken("发行版名", name);
  const r = await execRun(BIN, ["--set-default", name], 10_000);
  return !(r.code !== null && r.code !== 0);
}

/** 引擎探针脚本（对齐 Rust wsl_probe_engines）：登录 shell 语义补 ~/.profile 与
 *  ~/.local/bin，逐 binary `command -v`，行协议 `bin:path`。 */
export function engineProbeScript(bins: string[]): string {
  const list = bins.join(" ");
  return (
    '[ -r "$HOME/.profile" ] && . "$HOME/.profile" >/dev/null 2>&1 || true; ' +
    'PATH="$HOME/.local/bin:$PATH"; export PATH; ' +
    `for b in ${list}; do p=$(command -v $b 2>/dev/null); echo $b:$p; done`
  );
}

/** 解析 `bin:path` 行协议；/mnt/* = Windows 互操作误检，视为未检出。 */
export function parseProbeLines(text: string): EngineProbe[] {
  const out: EngineProbe[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const bin = line.slice(0, i);
    const path = line.slice(i + 1);
    out.push({ bin, path: path && !path.startsWith("/mnt/") ? path : null });
  }
  return out;
}

/** 发行版内引擎探针（本机）。`-e` 直 exec 不过 shell，argv 逐字透传（无引号损耗）。 */
export async function probeEngines(distro: string, bins: string[]): Promise<EngineProbe[]> {
  for (const b of bins) assertSafeToken("binary 名", b);
  const r = await execRun(BIN, ["-d", distro, "-e", "bash", "-c", engineProbeScript(bins)], 60_000);
  return parseProbeLines(r.stdout);
}

/** b64 载荷（对齐 Rust wsl_bash_payload）：b64 字符集对宿主 PowerShell/cmd 完全
 *  惰性，整链保真，不受 DefaultShell 引号规则影响。 */
function wslBashPayload(distro: string, script: string): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(script)));
  return `wsl.exe -d "${distro.replace(/"/g, "")}" -- bash -c "echo ${b64}|base64 -d|bash"`;
}

/** 发行版内引擎探针（远程，经 ssh；b64 载荷过宿主 shell）。 */
export async function probeEnginesRemote(
  distro: string,
  bins: string[],
  target: SshTarget,
): Promise<EngineProbe[]> {
  for (const b of bins) assertSafeToken("binary 名", b);
  const r = await sshRun(target, [wslBashPayload(distro, engineProbeScript(bins))]);
  return parseProbeLines(r.stdout);
}

/** 单次 ssh 执行（key 认证，BatchMode 禁交互提示；hostkey accept-new TOFU）。 */
async function sshRun(target: SshTarget, remote: string[]): Promise<{ code: number | null; stdout: string }> {
  const r = await execRun(
    SSH_BIN,
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=10",
      "-p",
      String(target.port),
      `${target.user}@${target.host}`,
      ...remote,
    ],
    60_000,
  );
  return { code: r.code, stdout: r.stdout };
}

/** 远程 WSL 探测（对齐 Rust wsl_remote_info）：发行版表 + 运行态 + 版本，
 *  三条独立命令各一次 ssh（不在宿主 shell 里做 `;` 串接）。
 *  远程不跑 -e 探针（可能触发发行版冷启动拖慢探测），$HOME/用户为 null。 */
export async function probeRemote(target: SshTarget): Promise<WslInfo> {
  assertSafeToken("user", target.user);
  assertSafeToken("host", target.host);
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    throw new Error(`端口不合法: ${target.port}`);
  }
  let list: string;
  try {
    const r = await sshRun(target, ["wsl.exe -l -v"]);
    if (r.code !== null && r.code !== 0) return unavailable();
    list = decodeWslOutput(r.stdout);
  } catch (e) {
    throw new Error(`ssh 连接失败（需 key 认证）: ${e instanceof Error ? e.message : String(e)}`);
  }
  const distros = parseWslList(list);
  if (distros.length === 0) return unavailable();
  try {
    const r = await sshRun(target, ["wsl.exe -l -v --running"]);
    if (r.code === 0) markRunning(distros, decodeWslOutput(r.stdout));
  } catch {
    /* 老版 wsl.exe 不认 --running：静默按全停。 */
  }
  let wslVersion: string | null = null;
  try {
    const r = await sshRun(target, ["wsl.exe --version"]);
    wslVersion = firstVersionLine(decodeWslOutput(r.stdout));
  } catch {
    /* 版本行缺省不影响可用性。 */
  }
  return { available: true, wslVersion, distros, linuxHome: null, linuxUser: null };
}
