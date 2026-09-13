# ccgui-plugin-wsl

CC GUI 插件:WSL 发行版管理器(设置页 section)。能力与 UI 复刻自
[tmd-cli](https://github.com/chenxiangning/tmd-cli) 的 WSL 面板
(`src/plugins/wsl`),按 CC GUI 插件 SDK(`@ccgui/plugin-sdk` ^0.3)重写。

## 功能

- **本机诊断**(Windows 客户端):`wsl.exe -l -v` 发行版列表(名称/WSL 版本/运行态)、
  `--version` 版本行、默认发行版的登录用户与 `$HOME`。表格解析 locale 无关
  (按「末列 ∈ {1,2}」锚定,同 tmd Rust 侧 `parse_wsl_list_impl`)。
- **设默认**:`wsl.exe --set-default <name>`,同步写 wslconfig,插件内记住钉选
  (其余发行版折叠进「显示全部发行版(N)」)。
- **引擎探针**:发行版内逐 binary `command -v`(登录 shell PATH,补
  `~/.profile` 与 `~/.local/bin`;`/mnt/*` Windows 互操作路径不计)。
  bins 为固定清单 `PROBE_BINS`(tmd 取宿主 cli profile 清单,SDK 无对应注册表)。
- **远程探测**:经 `ssh`(BatchMode,仅 key 认证,`StrictHostKeyChecking=accept-new`)
  连 Windows 宿主跑同样的诊断命令;主机簿为插件自持 KV(手动添加表单,
  `host|port|user` 查重)。

## 权限

| 权限 | 用途 |
|---|---|
| `ui:settings-section` | 设置页「WSL 主机」section |
| `storage` | 插件 KV(钉选发行版、远程主机簿、选中主机) |
| `exec:wsl.exe` | 本机诊断 / 设默认 / 发行版内探针 |
| `exec:ssh` | 远程宿主探测(key 认证) |

无网络权限;不访问文件系统;不使用 localStorage。

## 与 tmd-cli 的差异(宿主能力面所限)

tmd 的「添加 WSL 工作区」「SSH 进入会话」「起始目录浏览」依赖宿主的工作区/
PTY 会话表面,CC GUI 插件 SDK 无对应挂点,未复刻;引擎探针保留为纯诊断。
tmd 的 UTF-16LE 专用解码在插件侧简化为 NUL 剥离 —— 诊断表格锚定列全 ASCII,
状态列各 locale 均不读。

## 开发

```bash
pnpm install
pnpm dev        # 无(纯构建型插件);改 src/ 后:
pnpm build      # 产出 main.js + styles.css(仓库根,与 manifest.json 同级)
pnpm typecheck  # tsc --noEmit
pnpm validate   # manifest 校验(镜像宿主规则)
```

本地调试:CC GUI → 设置 → 插件 → 从本地目录安装(指向本仓库根)。

发版:打与 `manifest.json` `version` 一致的 tag(`1.2.0`,不带 `v` 前缀),
GitHub Action 自动构建并把 `main.js` / `manifest.json` / `styles.css` 挂到 Release。

## License

MIT
