# ccgui-plugin-wsl

CC GUI 插件:WSL 发行版管理器 + 远程 WSL 工作区。能力与 UI 复刻自
[tmd-cli](https://github.com/chenxiangning/tmd-cli) 的 WSL 面板
(`src/plugins/wsl`),按 CC GUI 插件 SDK(`@ccgui/plugin-sdk` ^0.3.3)重写,
会话/工作区复用宿主能力(而非 tmd 的 PTY 幕布路线)。

## 功能

- **本机诊断**(Windows 客户端):`wsl.exe -l -v` 发行版列表(名称/WSL 版本/
  运行态)、`--version` 版本行、默认发行版的登录用户与 `$HOME`。表格解析
  locale 无关(按「末列 ∈ {1,2}」锚定,同 tmd Rust 侧 `parse_wsl_list_impl`)。
- **设默认**:`wsl.exe --set-default <name>`,同步写 wslconfig,插件内记住钉选
  (其余发行版折叠进「显示全部发行版(N)」)。
- **引擎探针**:发行版内逐 binary `command -v`(登录 shell PATH,补
  `~/.profile` 与 `~/.local/bin`;`/mnt/*` Windows 互操作路径不计)。探针输出
  白名单过滤 —— wsl.exe 的杂散警告行(冷启动/localhost 代理,UTF-16 经
  lossy 常变乱码)一律不认。bins 为固定清单 `PROBE_BINS`。
- **远程探测**:经 `ssh` 连 Windows 宿主跑同样的诊断命令。认证两路:
  密码(macOS/Linux 经系统自带 `expect` 起 PTY 非交互送入,密码经 env 传递
  不落 argv,明文存本机插件 KV)或 SSH key(`BatchMode`);Windows 客户端
  通常无 `expect`,仅支持 key 认证。密码用户连接成功即建立 SSH
  ControlMaster(`/tmp/ccgui-wsl-<hostId>`,`ControlPersist 8h`),此后插件
  探针与宿主引擎 spawn 全部免密复用。主机簿为插件自持 KV:手动添加/编辑/
  删除(两段确认),`host|port|user` 查重。
- **添加 WSL 工作区**(tmd AddWslTab 复刻):composer「+」菜单的
  「WSL 发行版工作区」行 → 独立页(`#/p/plugin:wsl:add-workspace`):
  选宿主 → 连接 → 选发行版 → 逐级浏览目录(`~` 起始)→「添加工作区」。
  登记 = 宿主 `ctx.workspaces.add(path, { wsl: meta })`(侧栏出现工作区;
  meta 携带 host/port/user/controlPath/workspace/enginePaths)+ 插件 KV。
  登记失败**如实报错**,不静默标记。
- **WSL 文件面板**(聊天右侧「WSL 文件」tab):已登记的 WSL 工作区显示
  发行版内目录树(懒加载 `ls -1ap`)+ 文件只读预览(512KB 截断)+
  claude 会话条(扫描发行版内 `~/.claude/projects` jsonl,点击经
  `ctx.sessions.selectSession` 打开,resume 走远程 CLI `--resume`)。
- **发起会话**(宿主侧适配,见下):在登记的 WSL 工作区里正常发消息,
  宿主把引擎进程包装成 `ssh → wsl.exe -d <distro> -- bash <脚本>` 在发行版
  内执行;引擎 bin 用探针检出的**发行版内路径**(meta.enginePaths),
  cwd 由脚本 `cd` 到登记目录。

## 权限

| 权限 | 用途 |
|---|---|
| `ui:settings-section` | 设置页「WSL 主机」section |
| `ui:panel-tab` | 聊天右侧「WSL 文件」tab |
| `ui:add-menu` | composer「+」菜单「WSL 发行版工作区」行 |
| `ui:page` | 添加工作区独立页(`#/p/plugin:wsl:add-workspace`) |
| `storage` | 主机簿 / 工作区登记 KV |
| `exec:wsl.exe` | 本机诊断 / 设默认 / 发行版内探针 |
| `exec:ssh` | 远程探测与文件/会话读取(key 路径 / ControlMaster 复用) |
| `exec:expect` | 远程探测(密码认证路径,macOS/Linux 系统自带) |
| `host:workspace` | `ctx.workspaces.add`(登记 WSL 工作区进宿主侧栏) |
| `host:session` | `ctx.sessions.selectSession`(打开远程会话) |

无网络权限;不访问文件系统 API;不使用 localStorage。

## 宿主配套(codemoss ≥ SDK 0.3.3)

插件依赖宿主这三处适配(均已在 codemoss 仓 `cxn-1.0.0` 分支落地):

1. `ctx.workspaces.add(path, meta)` —— `host:workspace`;Rust
   `add_workspace` 带 meta 时跳过本机 `is_dir` 校验,meta 存 sqlite
   `workspaces.meta`。
2. `ctx.sessions.selectSession(engine, sessionId, workspacePath)` ——
   `host:session`;工作区已登记即放行(远程会话宿主扫描不到)。
3. `engine/wsl_transport.rs` —— 工作区 meta 带 `wsl` 时,`send_message` 把
   引擎命令包装为 ssh → wsl.exe 执行(脚本经 stdin tee 明文落盘,run 命令串
   只含固定词,cmd/PowerShell 均不拆;kill 进程组 → ssh 断 → 远端 SIGHUP)。

## 与 tmd-cli 的差异

- 会话不走 PTY 幕布:复用宿主 headless CLI 管道(stdio NDJSON),UI/会话表/
  中断语义全复用;因此没有 tmd 的「WSL 终端 tab」。
- 已打开的远程会话**历史回放**暂不可用(loadSessionPage 读本机 jsonl;
  续聊 `--resume` 正常)。需要宿主 registerSource 扩展,未做。
- codex 引擎的本地 provider env 不跨机(远端 CLI 读发行版内自己的配置)。
- tmd 的 UTF-16LE 专用解码在插件侧简化为 NUL 剥离 —— 诊断表格锚定列全
  ASCII,状态列各 locale 均不读。

## 开发

```bash
pnpm install
pnpm build      # 产出 main.js + styles.css(仓库根,与 manifest.json 同级)
pnpm typecheck  # tsc --noEmit
pnpm validate   # manifest 校验(镜像宿主规则)
```

本地调试:CC GUI → 设置 → 插件 → 从本地目录安装(指向本仓库根,先 build)。
宿主需为带 0.3.3 SDK 的 codemoss 构建(`pnpm dev` 或重新打包)。

发版:打与 `manifest.json` `version` 一致的 tag(`1.2.0`,不带 `v` 前缀),
GitHub Action 自动构建并把 `main.js` / `manifest.json` / `styles.css` 挂到 Release。

## License

MIT
