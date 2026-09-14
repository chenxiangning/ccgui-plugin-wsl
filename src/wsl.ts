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

interface SshTarget {
  user: string;
  host: string;
  port: number;
}


// ponytail: bins 固定清单,profile 驱动需宿主暴露引擎注册表后再换
export const PROBE_BINS = ["claude", "codex", "omp", "dsh", "gemini", "qwen"];

const BIN = "wsl.exe";
const SSH_BIN = "ssh";

function isWindowsPlatform(): boolean {
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
function parseWslList(text: string): WslDistro[] {
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
function markRunning(distros: WslDistro[], runningText: string): void {
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
function engineProbeScript(bins: string[]): string {
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
function parseProbeRows(text: string, bins: string[]): EngineProbe[] {
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

/** 一条远程链路:目标 + 可选密码(空 = key 认证 BatchMode)+ 可选
 *  SSH ControlMaster 路径(存在时全部连接免密复用)。 */
export interface SshLink {
  target: SshTarget;
  password?: string;
  controlPath?: string;
}

/** ControlMaster 套接字固定前缀(mac/linux;/tmp 足短,满足 unix 域路径限长)。
 *  宿主 Rust spawn 的 ssh 与插件共享同一路径 —— 约定即契约。 */
export function controlPathFor(hostId: string): string {
  const safe = hostId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `/tmp/ccgui-wsl-${safe}`;
}

/** 密码用户:建立 ControlMaster 主连接(一次 expect 送密码,之后所有
 *  ssh —— 插件探针与宿主引擎 spawn —— 免密复用,直至 ControlPersist 到期)。
 *  返回 controlPath;建立失败返回 null(调用方回落逐条密码)。 */
export async function ensureControlMaster(link: SshLink, hostId: string): Promise<string | null> {
  if (!link.password || isWindowsPlatform()) return null;
  const cp = controlPathFor(hostId);
  const { target } = link;
  // 快路径:主连接仍活着(-O check 只摸本地套接字,免密码免 expect)。
  const check = await execRun(
    SSH_BIN,
    ["-O", "check", "-o", `ControlPath=${cp}`, "-p", String(target.port), `${target.user}@${target.host}`],
    8_000,
  ).catch(() => null);
  if (check?.code === 0) return cp;
  const script =
    "set timeout 30\n" +
    "set p $env(WSLSH_PASS)\n" +
    "log_user 0\n" +
    // 陈旧套接字(ControlPersist 到期/休眠后 master 消失)会让
    // ControlMaster=yes 静默降级成单次连接 —— 重建前必须删掉。
    `catch { file delete -force ${cp} }\n` +
    `spawn -noecho ssh -n -o ControlMaster=yes -o ControlPath=${cp} -o ControlPersist=8h -o StrictHostKeyChecking=accept-new -o NumberOfPasswordPrompts=1 -o ConnectTimeout=10 -p ${target.port} ${target.user}@${target.host} exit\n` +
    "expect {\n" +
    '  -re "(?i)(password|passphrase):" { send -- "$p\\r" }\n' +
    "  eof { puts WSLEXIT:255; exit }\n" +
    "}\n" +
    "expect eof\n" +
    'puts "WSLEXIT:[lindex [wait] 3]"\n';
  try {
    const r = await execRun("expect", ["-c", script], 40_000, { WSLSH_PASS: link.password });
    const m = /WSLEXIT:(\d+)/.exec(r.stdout);
    return m && m[1] === "0" ? cp : null;
  } catch {
    return null;
  }
}
/** 远程会话摘要(distro 内已探针 CLI 的会话库;path = distro 内 jsonl 绝对
 *  路径,宿主历史回放经 ssh 通道 cat 该文件)。 */
interface RemoteSessionSummary {
  engine: string;
  sessionId: string;
  updatedAt: number;
  title: string;
  path: string;
}

/** 扫描发行版内指定工作区的历史会话,按时间倒序截 30 条。只扫 `engines`
 *  (探针 enginePaths 的键)里已知会话库的引擎;未探出 = 不扫。行协议
 *  engine\tsessionId\tmtime\ttitle\tpath。
 *  - claude:`~/.claude/projects/<编码路径>/*.jsonl`,编码 = 非 a-zA-Z0-9 → `-`
 *    (路径先做 `~` 展开;目录匹配取路径边界,`/a/b` 不误吞 `/a/b2`);
 *  - codex:`~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl`,cwd 在首行
 *    session_meta 里,前缀匹配工作区;标题取首条非环境上下文的用户输入,
 *    只扫每文件前 200KB;
 *  - omp:`~/.pi/agent/sessions/<编码>/`,编码 = `-` + 非 a-zA-Z0-9(点号保留)
 *    → `-` 再各补一杠(真机样本 `--home-cxn-.ssh--`/`--Users-...--` 吻合);
 *  - dsh/gemini/qwen:暂无已知会话库,检出也不扫。 */
export async function listRemoteSessions(
  link: SshLink,
  distro: string,
  workspacePath: string,
  engines: string[],
): Promise<RemoteSessionSummary[]> {
  assertSafeToken("发行版名", distro);
  assertSafePath(workspacePath);
  const wsQ = quoteRemotePath(workspacePath);
  const has = (e: string) => engines.includes(e);
  const script = [
    `ws=$(printf %s ${wsQ})`,
    ...(has("claude") || has("omp")
      ? ['enc=$(printf %s "$ws" | tr -c "a-zA-Z0-9" "-")']
      : []),
    ...(has("claude")
      ? [
          'best=""',
          'for d in "$HOME/.claude/projects"/*/; do',
          '  case "$(basename "$d")" in "$enc"|"$enc"-*) best="$d";; esac',
          "done",
          'if [ -n "$best" ]; then',
          '  for f in "$best"*.jsonl; do',
          '    [ -f "$f" ] || continue',
          '    ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)',
          '    title=$(head -c 6000 "$f" | grep -a -o "\\"content\\":\\"[^\\"]\\{1,60\\}" | head -1 | cut -c12-)',
          '    printf \'claude\\t%s\\t%s\\t%s\\t%s\\n\' "$(basename "$f" .jsonl)" "$ts" "$title" "$f"',
          '  done',
          "fi",
        ]
      : []),
    ...(has("omp")
      ? [
          // 真机实证:omp 会话在 ~/.omp/agent/sessions/<编码>/,编码 =
          // 工作区剥 $HOME/ 前缀后 / → -(前导 -;ws=$HOME 时为 "-");
          // 文件名 <时间戳>_<id>.jsonl;标题取首行 "type":"title"。
          'oenc="-$(printf %s "${ws#"$HOME"/}" | tr / -)"',
          '[ "$ws" = "$HOME" ] && oenc="-"',
          'for f in "$HOME/.omp/agent/sessions/$oenc"/*.jsonl; do',
          '  [ -f "$f" ] || continue',
          '  ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)',
          '  id=$(basename "$f" .jsonl | sed "s/^[^_]*_//")',
          '  title=$(head -c 500 "$f" | grep -a -o \'"title":"[^"]\\{1,60\\}"\' | head -1 | cut -d\'"\' -f4)',
          '  [ -n "$title" ] || title=$(grep -a -m1 \'"role":"user"\' "$f" | grep -a -o \'"text":"[^"]\\{1,60\\}\' | sed \'s/.*"text":"//\' | grep -v "^<" | head -1)',
          '  printf \'omp\\t%s\\t%s\\t%s\\t%s\\n\' "$id" "$ts" "$title" "$f"',
          "done",
        ]
      : []),
    ...(has("codex")
      ? [
          'for f in "$HOME"/.codex/sessions/*/*/*/rollout-*.jsonl; do',
          '  [ -f "$f" ] || continue',
          '  meta=$(head -c 800 "$f")',
          '  cwd=$(printf %s "$meta" | grep -a -o \'"cwd":"[^"]*"\' | head -1 | cut -d\'"\' -f4)',
          '  case "$cwd" in "$ws"|"$ws"/*) ;; *) continue;; esac',
          '  id=$(printf %s "$meta" | grep -a -o \'"session_id":"[^"]*"\' | head -1 | cut -d\'"\' -f4)',
          '  [ -n "$id" ] || continue',
          '  ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)',
          '  title=$(head -c 200000 "$f" | grep -a -o \'"input_text","text":"[^"]\\{1,60\\}\' | sed \'s/.*"text":"//\' | grep -v "^<" | head -1)',
          '  printf \'codex\\t%s\\t%s\\t%s\\t%s\\n\' "$id" "$ts" "$title" "$f"',
          'done',
        ]
      : []),
  ];
  const r = await sshRun(
    link,
    wslBashPayload(distro, `{\n${script.join("\n")}\n} | sort -t "\t" -k3 -rn | head -30`),
  );
  return stripWslWarnings(r.stdout)
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, "").split("\t"))
    .filter((c) => c.length >= 4 && c[1])
    .map((c) => ({
      engine: c[0] ?? "",
      sessionId: c[1] ?? "",
      updatedAt: Number(c[2]) * 1000 || 0,
      // JSON 字符串里的字面 \n 转义(「做个项目分析\n」)压成空格。
      title: (c[3] || "").replace(/\\n/g, " ").trim(),
      path: c[4] || "",
    }));
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
async function sshRunOnce(link: SshLink, remote: string): Promise<{ code: number | null; stdout: string }> {
  const { target, password, controlPath } = link;
  assertTarget(target);
  if (!password || controlPath) {
    const opts = controlPath
      ? ["-o", `ControlPath=${controlPath}`, "-o", "BatchMode=yes"]
      : ["-o", "BatchMode=yes"];
    const r = await execRun(
      SSH_BIN,
      [...SSH_OPTS, ...opts, "-p", String(target.port), `${target.user}@${target.host}`, remote],
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

/** 远程执行:ControlMaster 套接字失效(ControlPersist 到期/宿主休眠)时 ssh
 *  以 255 失败且不会回落直连 —— 剥掉 ControlPath 重试一次自愈;255 也可能
 *  来自远端命令本身,重试无害(结果一致)。 */
async function sshRun(link: SshLink, remote: string): Promise<{ code: number | null; stdout: string }> {
  if (!link.controlPath) return sshRunOnce(link, remote);
  const r = await sshRunOnce(link, remote);
  if (r.code !== 255) return r;
  return sshRunOnce({ ...link, controlPath: undefined }, remote);
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

/** 路径结构校验:允许任意 Unicode 文件名(中文/空格/引号);只挡空路径、
 *  控制字符与非 `~`/`/` 起始形态。防注入靠 quoteRemotePath 的单引号包裹,
 *  不再走 tmd 的 ASCII 白名单(tmd 为此不支持中文/空格路径,插件需支持)。 */
function assertSafePath(path: string): void {
  if (path.length === 0 || !/^[~/]/.test(path) || /[\0-\x1f]/.test(path)) {
    throw new Error(`路径形态不支持: ${JSON.stringify(path.slice(0, 80))}`);
  }
}

/** 任意文件名的脚本排布:`~/a b` → `"$HOME"/'a b'`(`$HOME` 双引号展开,
 *  余段单引号包裹、`'` 按 bash 惯例翻成 `'\''`;绝对路径整段单引号)。
 *  与 tmd 的无引号白名单形态二选一:本插件取引号形态换 Unicode 支持。 */
function quoteRemotePath(path: string): string {
  assertSafePath(path);
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  if (path === "~") return '"$HOME"';
  if (path.startsWith("~/")) return `"${"$HOME"}"/${q(path.slice(2))}`;
  if (path.startsWith("/")) return q(path);
  throw new Error(`路径必须是 ~ 或 / 起始: ${path}`);
}

/** 目录懒加载(`ls -1ap`:目录带尾 `/`;`--` 挡 `-` 开头路径;过滤 . / ..)。
 *  退出码判失败;`wsl:` 开头的行是 wsl.exe 的 NAT/localhost 代理警告
 *  (PTY 下中文 UTF-16LE 经 lossy 成乱码),一律剥除。 */
export interface DirEntry {
  name: string;
  isDir: boolean;
}


/** wsl.exe 包装层警告行(NAT 提示等,常为乱码),任何解析前剥除。
 *  警告段是 UTF-16LE,经 lossy 后 NUL 夹杂 —— 必须先剥 NUL 再匹配
 *  `wsl:` 前缀(真机 0.3.2 教训:\u0000wsl:\u0000 形态逃过裸正则)。 */
function stripWslWarnings(text: string): string {
  return decodeWslOutput(text)
    .split(/\r?\n/)
    .filter((l) => !/^wsl[.:]/i.test(l.trim()))
    .join("\n");
}

export async function listDirRemote(link: SshLink, distro: string, path: string): Promise<DirEntry[]> {
  assertSafeToken("发行版名", distro);
  assertSafePath(path);
  const r = await sshRun(link, wslBashPayload(distro, `ls -1ap -- ${quoteRemotePath(path)}`));
  if (r.code !== null && r.code !== 0) {
    throw new Error(`目录不存在或不可读: ${path}(code=${r.code})`);
  }
  return stripWslWarnings(r.stdout)
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l && l !== "./" && l !== "../" && l !== "." && l !== "..")
    .map((l) => ({ name: l.replace(/\/$/, ""), isDir: l.endsWith("/") }));
}

/** 远程文件文本读取(对齐 Rust wsl_read_file_text 协议:首个 size= 行 + b64;
 *  杂散 wsl 警告行跳过)。超 maxBytes 截断(truncated=true,不返回内容)。 */
interface RemoteFileText {
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
  assertSafePath(path);
  const p = quoteRemotePath(path);
  const max = Math.min(Math.max(maxBytes, 1), 4 * 1024 * 1024);
  // 行协议对齐 tmd wsl_read_file_text:size=<n> 行 + base64 段;目录/缺失/
  // 不可读 → wc 失败 exit 9(如实报错);超限不读内容([ ] && 跳过 base64)。
  const script = `s=$(wc -c < ${p}) || exit 9; echo size=$s; [ "$s" -le ${max} ] && head -c ${max} ${p} | base64; true`;
  const r = await sshRun(link, wslBashPayload(distro, script));
  if (r.code === 9) throw new Error("不是常规文件或不可读");
  const text = stripWslWarnings(r.stdout);
  let size: number | null = null;
  const b64: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (size === null) {
      if (line.startsWith("size=")) {
        const n = Number(line.slice(5));
        if (!Number.isFinite(n)) throw new Error(`远程文件 size 非法: ${line.slice(5)}`);
        size = n;
      }
      continue;
    }
    b64.push(line.trim());
  }
  if (size === null) {
    // 原样带出输出头:客户端内偶发空/杂散输出时,黑匣子能直接看到真凶。
    throw new Error(
      `远程文件读取输出异常(code=${r.code ?? "?"}): ${JSON.stringify(text.slice(0, 200))}`,
    );
  }
  const b64Flat = b64.join("");
  if (!b64Flat) return { size, content: null, truncated: true };
  try {
    const bytes = Uint8Array.from(atob(b64Flat), (c) => c.charCodeAt(0));
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
