import stylesCss from "./styles.css?raw";

import { createRoot, type Root } from "react-dom/client";
import type { PluginActivate } from "./ccgui-plugin";
import { WslCard } from "./WslCard";
import { FileTreePanel } from "./FileTreePanel";
import { openAddWorkspacePop, AddWorkspacePop, WSL_ADD_POP_EVENT } from "./AddWorkspacePop";
import { copy, setHostCtx } from "./host";
import { registerRemoteFileHook } from "./remoteFiles";
import { registerWorkspaceUIHook } from "./workspaceUI";
import { registerRemoteSessionSource } from "./sessionSource";
/**
 * 插件入口:宿主动态 import main.js 并以 PluginContext 调默认导出。
 * 双段挂载(react-doctor 同款):宿主 React 树只渲染容器(经 ctx.react),
 * 段内容用插件自带 React createRoot 挂进容器,两棵树互不交错。
 */
const activate: PluginActivate = (ctx) => {
  setHostCtx(ctx);
  // 样式内嵌注入:本地目录安装的宿主可能不加载插件目录的 styles.css
  // (marketplace 三件套才保证),内嵌进 bundle 万无一失。
  ctx.theme.injectCss(stylesCss);
  const unregisterRemoteFiles = registerRemoteFileHook();
  registerWorkspaceUIHook();
  const unregisterSessionSource = registerRemoteSessionSource();
  const h = ctx.react;

  const svgProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;

  function SectionContainer() {
    const ref = h.useRef<HTMLDivElement | null>(null);
    h.useEffect(() => {
      if (!ref.current) return;
      const root = createRoot(ref.current);
      root.render(<WslCard locale={ctx.host.locale} />);
      return () => root.unmount();
    }, []);
    return h.createElement("div", { ref, className: "wsl-plugin-root" });
  }

  // 设置段图标渲染在宿主树里:用 ctx.react 手工建 SVG(插件 React 的组件
  // 交给宿主树渲染违反双树规则)。
  ctx.ui.registerSettingsSection({
    key: "wsl",
    label: () => copy(ctx.host.locale).sectionLabel,
    icon: ({ className }) =>
      h.createElement(
        "svg",
        { ...svgProps, className },
        h.createElement("rect", { x: "3", y: "4", width: "18", height: "12", rx: "1.5" }),
        h.createElement("path", { d: "M8 20h8" }),
        h.createElement("path", { d: "M12 16v4" }),
      ),
    component: SectionContainer,
  });

  // 聊天右侧面板 tab:WSL 工作区的发行版内文件树(非 WSL 工作区显示提示)。
  function FileTabContainer({ workspacePath }: { workspacePath: string }) {
    const ref = h.useRef<HTMLDivElement | null>(null);
    h.useEffect(() => {
      if (!ref.current) return;
      const root = createRoot(ref.current);
      root.render(<FileTreePanel workspacePath={workspacePath} locale={ctx.host.locale} />);
      return () => root.unmount();
    }, [workspacePath]);
    return h.createElement("div", { ref, className: "wsl-plugin-root" });
  }

  ctx.ui.registerPanelTab({
    key: "wsl-files",
    label: () => copy(ctx.host.locale).fileTab,
    icon: ({ className }) =>
      h.createElement(
        "svg",
        { ...svgProps, className },
        h.createElement("path", {
          d: "M4 5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z",
        }),
      ),
    component: FileTabContainer,
  });

  // 添加入口:「+」菜单行 → 左侧滑出浮层(tmd wsadd-pop 复刻,
  // createPortal 挂 body;独立 hash 页已下线)。浮层 React root 独立
  // 于宿主树;关闭即 unmount。
  let popRoot: Root | null = null;
  const onPopOpen = () => {
    if (popRoot) return;
    const hostDiv = document.createElement("div");
    document.body.appendChild(hostDiv);
    popRoot = createRoot(hostDiv);
    popRoot.render(<AddWorkspacePop onClose={() => {
      popRoot?.unmount();
      hostDiv.remove();
      popRoot = null;
    }} />);
  };
  window.addEventListener(WSL_ADD_POP_EVENT, onPopOpen);

  ctx.ui.registerAddMenuRow({
    key: "wsl-workspace",
    label: () => copy(ctx.host.locale).addWorkspaceBtn,
    description: () => copy(ctx.host.locale).addPageDesc,
    onSelect: openAddWorkspacePop,
  });
  return () => {
    window.removeEventListener(WSL_ADD_POP_EVENT, onPopOpen);
    popRoot?.unmount();
    unregisterRemoteFiles();
    unregisterSessionSource();
    setHostCtx(null);
  };
};

export default activate;
