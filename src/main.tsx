import "./styles.css";

import { createRoot } from "react-dom/client";
import type { PluginActivate } from "./ccgui-plugin";
import { WslCard } from "./WslCard";
import { copy, setHostCtx } from "./host";

/**
 * 插件入口:宿主动态 import main.js 并以 PluginContext 调默认导出。
 * 双段挂载(react-doctor 同款):宿主 React 树只渲染容器(经 ctx.react),
 * 段内容用插件自带 React createRoot 挂进容器,两棵树互不交错。
 */
const activate: PluginActivate = (ctx) => {
  setHostCtx(ctx);
  const h = ctx.react;

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
        {
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
          className,
        },
        h.createElement("rect", { x: "3", y: "4", width: "18", height: "12", rx: "1.5" }),
        h.createElement("path", { d: "M8 20h8" }),
        h.createElement("path", { d: "M12 16v4" }),
      ),
    component: SectionContainer,
  });

  // ctx 注册由宿主 disposer 栈兜底;React root 随容器卸载。
  return () => setHostCtx(null);
};

export default activate;
