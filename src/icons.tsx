/** 内联 SVG 图标（phosphor 同位替身，免整个图标库依赖）。
 *  全部渲染在插件自有子树（普通组件）；设置段 icon 由 main.tsx 用 ctx.react 手建。 */

import type { ReactNode } from "react";

interface IconProps {
  size?: string;
  className?: string;
}

function svg(children: ReactNode, { size = "0.875rem", className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function DesktopIcon(props: IconProps = {}) {
  return svg(
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </>,
    props,
  );
}

export function PlusIcon(props: IconProps = {}) {
  return svg(
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
    props,
  );
}

export function CaretRightIcon(props: IconProps = {}) {
  return svg(<path d="M9 6l6 6-6 6" />, { ...props, size: props.size ?? "0.625rem" });
}

export function CaretDownIcon(props: IconProps = {}) {
  return svg(<path d="M6 9l6 6 6-6" />, { ...props, size: props.size ?? "0.625rem" });
}
