/**
 * 宿主 workspace-UI 桥对接(window.__ccguiWorkspaceUI,同 webview 全局契约,
 * 与 remoteFiles 的 __ccguiFiles 同款模式):注册两个按工作区路径作答的钩子
 * —— allowedEngines(composer 引擎菜单允许表)与 labelSuffix(侧栏标签后缀)。
 * meta.wsl 的形状从此只在插件侧解释,宿主 UI 不再读 meta 内容。
 * 未加载 prefs / 非 WSL 工作区一律返回 null,宿主走本地默认行为。
 */

import { cachedPrefs, loadPrefs } from "./store";
import { matchWorkspace } from "./remoteFiles";

interface WorkspaceUIBridge {
  registerHooks(
    hooks: {
      allowedEngines(workspacePath: string): string[] | null;
      labelSuffix(workspacePath: string): string | null;
    } | null,
  ): void;
}

let registered = false;

export function registerWorkspaceUIHook(): void {
  registered = false;
  const w = window as { __ccguiWorkspaceUI?: WorkspaceUIBridge };
  const bridge = w.__ccguiWorkspaceUI;
  if (!bridge || typeof bridge.registerHooks !== "function") return;
  // 闭包读缓存而非快照:loadPrefs/savePrefs 后答案自动更新。
  void loadPrefs().catch(() => {});
  bridge.registerHooks({
    allowedEngines(workspacePath) {
      const prefs = cachedPrefs();
      if (!prefs) return null;
      const meta = matchWorkspace(prefs, workspacePath);
      const ids = Object.entries(meta?.enginePaths ?? {})
        .filter(([, v]) => typeof v === "string" && v.length > 0)
        .map(([k]) => k);
      return ids.length > 0 ? ids : null;
    },
    labelSuffix(workspacePath) {
      const prefs = cachedPrefs();
      // 徽章文本:宿主渲染成 .ws-label-badge chip,样式由本插件 injectCss 注入。
      return prefs && matchWorkspace(prefs, workspacePath) ? "WSL" : null;
    },
  });
  registered = true;
}

/** 桥可能在插件 activate 时未就绪(模块加载顺序随宿主构建变化),
 *  面板挂载时补注册一次;已注册则幂等。 */
export function ensureWorkspaceUIHook(): void {
  if (registered) return;
  registerWorkspaceUIHook();
}
