import { execRun } from "./caps";

/**
 * WSL 诊断与操作 —— tmd-cli src-tauri/src/wsl.rs / wsl_remote_ops.rs 的 TS 移植。
 *
 * 与 Rust 侧的三处差异：
 * - bridge 的 stdout 是宿主 Rust from_utf8_lossy 后的字符串：wsl.exe 表格的
 *   UTF-16LE 字节已打成 NUL 噪音。表格锚定列全是 ASCII（发行版名/`*`/版本号），
 *   剥掉 NUL 即无损还原；非 ASCII 只出现在状态列，解析从不读它（同 Rust 的
 *   locale 无关纪律）。expect 的 PTY 输出同理适用。
 * - 无长连 SSH 通道：远程探测走三次独立连接（BatchMode key 认证，或 expect
 *   包 ssh 的密码认证）。不做 `;` 串接 —— Windows 宿主 DefaultShell 可能是
 *   cmd.exe，对 `;` 无命令语义。
 * - 密码认证：exec 无 TTY，ssh 读不到密码 —— 借 macOS/Linux 系统自带 expect
 *   起 PTY 非交互送入；密码经 env 传给 expect，不落 argv。
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

/** 一条远程链路：目标 + 可选密码（空 = key 认证 BatchMode）。 */
export interface SshLink {
  target: SshTarget;
  password?: string;
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

/** 解析 `bin:path` 行协议 → 每个请求的 bin 恰好一行(缺行 = 未检出)。
 *  仅认请求过的 bins:wsl.exe 的杂散输出(冷启动提示/localhost 代理警告,
 *  经 PTY+lossy 常变乱码)一律不认;/mnt/* = Windows 互操作误检,视为未检出。 */
export function parseProbeRows(text: string, bins: string[]): EngineProbe[] {
  const allow: Record<string, true> = {};
  for (const b of bins) allow[b] = true;
  const found: Record<string, string | null> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const bin = line.slice(0, i);
    if (!(bin in allow) || bin in found) continue;
    const path = line.slice(i + 1);
    found[bin] = path && !path.startsWith("/mnt/") ? path : null;
  }
  return bins.map((bin) => ({ bin, path: found[bin] ?? null }));
}

/** 按行解析不过滤(tmd 行为;插件内一律走 parseProbeRows)。 */
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

/** 发行版内引擎探针(本机)。`-e` 直 exec 不过 shell,argv 逐字透传(无引号损耗)。 */
export async function probeEngines(distro: string, bins: string[]): Promise<EngineProbe[]> {
  for (const b of bins) assertSafeToken("binary 名", b);
  const r = await execRun(BIN, ["-d", distro, "-e", "bash", "-c", engineProbeScript(bins)], 60_000);
  return parseProbeRows(r.stdout, bins);
}

/** b64 载荷（对齐 Rust wsl_bash_payload）：b64 字符集对宿主 PowerShell/cmd 完全
 *  惰性，整链保真，不受 DefaultShell 引号规则影响。 */
function wslBashPayload(distro: string, script: string): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(script)));
  return `wsl.exe -d "${distro.replace(/"/g, "")}" -- bash -c "echo ${b64}|base64 -d|bash"`;
}

function assertTarget(target: SshTarget): void {
  assertSafeToken("user", target.user);
  assertSafeToken("host", target.host);
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    throw new Error(`端口不合法: ${target.port}`);
  }
}

const SSH_OPTS = [
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "NumberOfPasswordPrompts=1",
  "-o",
  "ConnectTimeout=10",
];

/** expect 包 ssh（密码路径）的 TCL 脚本：log_user 0 压掉密码段回显，送入后恢复；
 *  末行 WSLEXIT 码供解析。cmd 无花括号（b64 字符集 + wsl.exe 固定词；发行版名
 *  已滤引号），TCL {} 字面量安全。 */
function expectScript(target: SshTarget, cmd: string): string {
  return (
    "set timeout 45\n" +
    "set p $env(WSLSH_PASS)\n" +
    "log_user 0\n" +
    `spawn -noecho ssh ${SSH_OPTS.join(" ")} -p ${target.port} ${target.user}@${target.host} {${cmd}}\n` +
    "expect {\n" +
    '  -re "(?i)(password|passphrase):" { send -- "$p\\r" }\n' +
    '  timeout { puts "\\nWSLEXIT:124"; exit }\n' +
    '  eof { puts "\\nWSLEXIT:255"; exit }\n' +
    "}\n" +
    "log_user 1\n" +
    "expect eof\n" +
    'puts "\\nWSLEXIT:[lindex [wait] 3]"\n'
  );
}

/** 解析 expect 尾码并剥离标记行。 */
function splitWslExit(text: string): { code: number | null; stdout: string } {
  const m = /WSLEXIT:(\d+)\s*$/.exec(text);
  if (!m) return { code: null, stdout: text };
  return { code: Number(m[1]), stdout: text.slice(0, m.index).trimEnd() + "\n" };
}

/** 认证/hostkey 失败翻译（整段输出里找；expect PTY 会把 stderr 并进 stdout）。 */
function sshAuthError(text: string): string | null {
  if (/permission denied|authentication failed/i.test(text)) return "认证失败:密码错误或公钥被拒。";
  if (/host key verification failed/i.test(text)) return "宿主 hostkey 已变更:删除本机 known_hosts 中该宿主的旧行后重试。";
  return null;
}

/** 单次远程执行。无密码 = ssh BatchMode（argv 直传）；有密码 = expect 包 ssh。
 *  Windows 客户端通常没有 expect，spawn 失败走下方 ENOENT 翻译。 */
async function sshRun(link: SshLink, remote: string): Promise<{ code: number | null; stdout: string }> {
  const { target, password } = link;
  assertTarget(target);
  if (!password) {
    const r = await execRun(
      SSH_BIN,
      [...SSH_OPTS, "-o", "BatchMode=yes", "-p", String(target.port), `${target.user}@${target.host}`, remote],
      60_000,
    );
    return { code: r.code, stdout: r.stdout };
  }
  let r;
  try {
    r = await execRun("expect", ["-c", expectScript(target, remote)], 60_000, { WSLSH_PASS: password });
  } catch {
    throw new Error("未找到 expect(密码登录依赖 macOS/Linux 系统自带 expect)。");
  }
  const authErr = sshAuthError(r.stdout);
  if (authErr) throw new Error(authErr);
  return splitWslExit(r.stdout);
}

/** 发行版内引擎探针（远程，b64 载荷过宿主 shell）。 */
export async function probeEnginesRemote(
  distro: string,
  bins: string[],
  link: SshLink,
): Promise<EngineProbe[]> {
  for (const b of bins) assertSafeToken("binary 名", b);
  const r = await sshRun(link, wslBashPayload(distro, engineProbeScript(bins)));
  return parseProbeRows(r.stdout, bins);
}

/** 目录懒加载(`ls -1ap`:目录带尾 `/`;`--` 挡 `-` 开头路径;过滤 . / ..)。
 *  对齐 Rust wsl_list_dir 的脚本与解析。 */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

export async function listDirRemote(link: SshLink, distro: string, path: string): Promise<DirEntry[]> {
  assertSafeToken("发行版名", distro);
  // 路径白名单:ASCII 且无引号/空格(bash 双引号内安全;~ 起始允许)。
  if (!path || /[^\x20-\x7e]/.test(path) || /["'\\]/.test(path)) {
    throw new Error("路径含不支持的字符(暂不支持空格与引号)");
  }
  const script = `ls -1ap -- "${path}" 2>/dev/null || echo "__WSL_LS_ERR__"`;
  const r = await sshRun(link, wslBashPayload(distro, script));
  if (r.stdout.includes("__WSL_LS_ERR__")) throw new Error(`目录不存在或不可读: ${path}`);
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l && l !== "./" && l !== "../" && l !== "." && l !== "..")
    .map((l) => ({ name: l.replace(/\/$/, ""), isDir: l.endsWith("/") }));
}

/** 远程文件文本读取(对齐 Rust wsl_read_file_text 协议:首个 size= 行 + b64;
 *  杂散 wsl 警告行跳过)。超 maxBytes 截断(truncated=true,不返回内容)。 */
export interface RemoteFileText {
  size: number;
  content: string | null;
  truncated: boolean;
}

export async function readFileRemote(
  link: SshLink,
  distro: string,
  path: string,
  maxBytes: number,
): Promise<RemoteFileText> {
  assertSafeToken("发行版名", distro);
  if (!path || /[^\x20-\x7e]/.test(path) || /["'\\]/.test(path)) {
    throw new Error("路径含不支持的字符(暂不支持空格与引号)");
  }
  const script = `f="${path}"; [ -f "$f" ] || { echo missing; exit 0; }; sz=$(wc -c < "$f"); echo "size=$sz"; if [ "$sz" -le ${maxBytes} ]; then base64 < "$f"; fi`;
  const r = await sshRun(link, wslBashPayload(distro, script));
  const text = r.stdout;
  if (/^missing$/m.test(text.trim())) throw new Error("文件不存在");
  const m = /size=(\d+)/.exec(text);
  if (!m) throw new Error("无法读取文件大小");
  const size = Number(m[1]);
  if (size > maxBytes) return { size, content: null, truncated: true };
  // 取首个 size= 行之后的全部内容,拼回 b64(base64 输出可能被 PTY 折行,剥空白)
  const b64 = text.slice((m.index ?? 0) + m[0].length).replace(/[\s]/g, "");
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return { size, content: new TextDecoder("utf-8", { fatal: false }).decode(bytes), truncated: false };
  } catch {
    throw new Error("文件内容解码失败");
  }
}

/** 远程 WSL 探测（对齐 Rust wsl_remote_info）：发行版表 + 运行态 + 版本，
 *  三条独立命令各一次连接（不在宿主 shell 里做 `;` 串接）。
 *  远程不跑 -e 探针（可能触发发行版冷启动拖慢探测），$HOME/用户为 null。 */
export async function probeRemote(link: SshLink): Promise<WslInfo> {
  let list: string;
  try {
    const r = await sshRun(link, "wsl.exe -l -v");
    if (r.code !== null && r.code !== 0) {
      const authErr = sshAuthError(r.stdout);
      if (authErr) throw new Error(authErr);
      return unavailable();
    }
    list = decodeWslOutput(r.stdout);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    /* sshRun 已翻译认证/expect 错误；其余按连接失败包装。 */
    if (/认证失败|hostkey|expect/.test(msg)) throw e;
    throw new Error(`ssh 连接失败: ${msg}`);
  }
  const distros = parseWslList(list);
  if (distros.length === 0) return unavailable();
  try {
    const r = await sshRun(link, "wsl.exe -l -v --running");
    if (r.code === 0) markRunning(distros, decodeWslOutput(r.stdout));
  } catch {
    /* 老版 wsl.exe 不认 --running：静默按全停。 */
  }
  let wslVersion: string | null = null;
  try {
    const r = await sshRun(link, "wsl.exe --version");
    wslVersion = firstVersionLine(decodeWslOutput(r.stdout));
  } catch {
    /* 版本行缺省不影响可用性。 */
  }
  return { available: true, wslVersion, distros, linuxHome: null, linuxUser: null };
}
