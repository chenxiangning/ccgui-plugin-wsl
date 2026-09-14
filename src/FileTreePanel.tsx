import { getFileTreeIconSvg } from "./fileIcons";
/**
 * 只接管插件登记过的 WSL 工作区(prefs.workspaces:path → {hostId, distro});
 * 其余工作区交还宿主(files 面板等)。数据全部经 exec 桥 ssh/expect 通道,
 * 宿主 fs 面不感知远程路径。
 */
import { useCallback, useEffect, useState } from "react";
import { copy, getHostCtx, type Copy } from "./host";
import { loadPrefs, type WslPrefs } from "./store";
import { listDirRemote, readFileRemote, type DirEntry, type SshLink } from "./wsl";

const PREVIEW_MAX_BYTES = 512 * 1024;

interface WslWorkspaceMeta {
  hostId: string;
  distro: string;
}

/** path → wsl 元数据(prefs.workspaces)。 */
function metaFor(prefs: WslPrefs | null, workspacePath: string): WslWorkspaceMeta | null {
  if (!prefs) return null;
  return prefs.workspaces?.[workspacePath] ?? null;
}

function linkOf(prefs: WslPrefs, meta: WslWorkspaceMeta): SshLink | null {
  const host = prefs.hosts.find((h) => h.id === meta.hostId);
  if (!host) return null;
  return { target: { host: host.host, port: host.port, user: host.user }, password: host.password || undefined };
}

/** 打开 distro 内路径:workspacePath = "/home/x/proj" 形态;根目录取 distro 根。 */
function joinPath(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

export function FileTreePanel({ workspacePath, locale }: { workspacePath: string; locale: string }) {
  const t = copy(locale);
  const [prefs, setPrefs] = useState<WslPrefs | null>(null);
  useEffect(() => {
    void loadPrefs().then(setPrefs).catch(() => {});
  }, []);

  const meta = metaFor(prefs, workspacePath);

  if (!prefs) return <div className="wsl-file-root wsl-hint">…</div>;
  if (!meta) {
    return (
      <div className="wsl-file-root">
        <div className="wsl-hint">{t.fileNotWsl}</div>
      </div>
    );
  }
  const link = linkOf(prefs, meta);
  if (!link) {
    return (
      <div className="wsl-file-root">
        <div className="wsl-hint">{t.fileHostMissing}</div>
      </div>
    );
  }
  return <Tree link={link} distro={meta.distro} root={workspacePath} locale={locale} />;
}

function Tree({ link, distro, root, locale }: { link: SshLink; distro: string; root: string; locale: string }) {
  const t = copy(locale);
  // 图 1 头部形态:● Ubuntu · 192.168.1.7(远程显 host;本机链路无 host 段)
  const hostTail = link.controlPath ? "" : `${link.target.user}@${link.target.host}`;
  const [expanded, setExpanded] = useState<Record<string, DirEntry[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);

  const load = useCallback(
    async (path: string) => {
      setLoading((s) => ({ ...s, [path]: true }));
      setError(null);
      try {
        const entries = await listDirRemote(link, distro, path);
        setExpanded((s) => ({ ...s, [path]: entries }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading((s) => {
          const n = { ...s };
          delete n[path];
          return n;
        });
      }
    },
    [link, distro],
  );

  useEffect(() => {
    void load(root);
  }, [load, root]);

  const openFile = async (path: string) => {
    setError(null);
    // 首选宿主中央编辑器(客户端已接入的文件开启流);经 remote-files 桥
    // 由 activate 注册的读取器供内容(只读)。桥缺失/读失败回落内置预览。
    const w = window as { __ccguiFiles?: unknown };
    const bridge = w.__ccguiFiles;
    if (bridge && typeof bridge === "object" && "openFile" in bridge) {
      const open = bridge.openFile;
      if (typeof open === "function") {
        try {
          await open(path);
          return;
        } catch {
          /* fall through to inline preview */
        }
      }
    }
    try {
      const r = await readFileRemote(link, distro, path, PREVIEW_MAX_BYTES);
      if (r.truncated || r.content === null) {
        setPreview({ path, content: t.fileTooLarge });
      } else {
        setPreview({ path, content: r.content });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="wsl-file-root">
      <div className="wsl-file-crumb">
        <span className="wsl-file-host">
          <span className="wsl-dot ok" aria-hidden />
          {distro}
          {hostTail ? ` · ${hostTail}` : ""}
        </span>
        <code>{root}</code>
        <button type="button" className="wsl-btn ghost" onClick={() => void load(root)}>
          {t.refresh}
        </button>
      </div>
      {error && <div className="wsl-remote-err">{error}</div>}
      <div className="wsl-file-tree">
        {expanded[root]?.map((e) => (
          <FileRow
            key={e.name}
            name={e.name}
            path={joinPath(root, e.name)}
            isDir={e.isDir}
            depth={0}
            expanded={expanded}
            loading={loading}
            onToggleDir={load}
            onOpenFile={openFile}
            locale={locale}
          />
        ))}
        {loading[root] && <div className="wsl-hint">{t.fileLoading}</div>}
        {expanded[root]?.length === 0 && <div className="wsl-hint">{t.fileEmptyDir}</div>}
      </div>
      {preview && (
        <div className="wsl-file-preview">
          <div className="wsl-file-crumb">
            <code>{preview.path}</code>
            <button type="button" className="wsl-btn ghost" onClick={() => setPreview(null)}>
              ×
            </button>
          </div>
          <pre>{preview.content}</pre>
        </div>
      )}
    </div>
  );
}

function FileRow({
  name,
  path,
  isDir,
  depth,
  expanded,
  loading,
  onToggleDir,
  onOpenFile,
  locale,
}: {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
  expanded: Record<string, DirEntry[]>;
  loading: Record<string, boolean>;
  onToggleDir: (path: string) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
  locale: string;
}) {
  const t = copy(locale);
  const [open, setOpen] = useState(false);
  const children = expanded[path];
  return (
    <>
      <button
        type="button"
        className="wsl-file-row"
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => {
          if (isDir) {
            const next = !open;
            setOpen(next);
            if (next && !children) void onToggleDir(path);
          } else {
            void onOpenFile(path);
          }
        }}
      >
        {isDir ? (
          <span
            className="wsl-file-ic"
            aria-hidden
            dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(name, true, open) }}
          />
        ) : (
          <span
            className="wsl-file-ic"
            aria-hidden
            dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(name, false) }}
          />
        )}
        <span className="wsl-file-name">{isDir ? `${name}/` : name}</span>
        {loading[path] && <span className="wsl-hint">{t.fileLoading}</span>}
      </button>
      {isDir &&
        open &&
        children?.map((c) => (
          <FileRow
            key={c.name}
            name={c.name}
            path={joinPath(path, c.name)}
            isDir={c.isDir}
            depth={depth + 1}
            expanded={expanded}
            loading={loading}
            onToggleDir={onToggleDir}
            onOpenFile={onOpenFile}
            locale={locale}
          />
        ))}
    </>
  );
}

/** 面板文案增补(host.ts Copy 的文件面板子集,独立小契约避免主契约膨胀)。 */
export function fileCopy(locale: string): Pick<Copy, "refresh"> & { notWsl: string } {
  const zh = locale.startsWith("zh");
  return zh
    ? { refresh: "刷新", notWsl: "非 WSL 工作区" }
    : { refresh: "Refresh", notWsl: "Not a WSL workspace" };
}

// getHostCtx 引用保持(tree 未来需要 bridge 扩展时不必改 import 面)
void getHostCtx;


