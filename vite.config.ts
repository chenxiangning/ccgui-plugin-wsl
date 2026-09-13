import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// 需要 Tailwind 时再装并解开注释：
//   pnpm add -D tailwindcss @tailwindcss/vite
//   import tailwindcss from "@tailwindcss/vite";
//   plugins: [react(), tailwindcss()]
// 然后在 src/main.tsx 顶部 `import "./styles.css"`（@import "tailwindcss"; 起手）。

/**
 * 单文件 ESM 产物（计划 ADR-2）：不做 external、不做动态 import——
 * 宿主通过 blob URL 加载 main.js，裸导入在那里无法解析。
 * 产物落在仓库根、与 manifest.json 同级（Obsidian 约定），
 * 因此宿主的「从本地目录安装」直接指向仓库根。
 */
export default defineConfig({
  plugins: [react()],
  define: {
    // 依赖里带 Node 风格 NODE_ENV 判断；webview 里没有 `process`。
    "process.env.NODE_ENV": '"production"',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: ".",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: "src/main.tsx",
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        // 接住 define 改不掉的漏网之鱼（如 vendor 代码里的
        // `process.env?.X` 可选链）：模块作用域 shim 遮蔽缺失的 Node 全局。
        banner: "var process = { env: { NODE_ENV: 'production' } };",
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css") ? "styles.css" : (asset.name ?? "asset"),
      },
    },
  },
});
