import type { PluginContext } from "./ccgui-plugin";

/**
 * 模块级宿主 ctx 持有(react-doctor 同款模式):activate 时注入,
 * 卸载 disposer 里清空。bridge/storage 封装统一从这里取。
 */
let hostCtx: PluginContext | null = null;

export function setHostCtx(ctx: PluginContext | null): void {
  hostCtx = ctx;
}

export function getHostCtx(): PluginContext {
  if (!hostCtx) throw new Error("wsl: host context not set(插件未激活)");
  return hostCtx;
}

/** 面板文案契约(插件自带,不经宿主 i18n)。中文串 = tmd-cli WSL 面板源串。 */
export interface Copy {
  sectionLabel: string;
  statusRemoteOnly: string;
  statusDetecting: string;
  connected: string;
  distroCountSuffix: string;
  running: string;
  stopped: string;
  setDefault: string;
  showAll: (n: number) => string;
  factsUser: string;
  refresh: string;
  localHint: string;
  remoteHost: string;
  remoteSelectAria: string;
  unselected: string;
  noHostYet: string;
  addHostTitle: string;
  connect: string;
  connecting: string;
  remoteDesc: string;
  addrLabel: string;
  portLabel: string;
  userLabel: string;
  passwordLabel: string;
  editHost: string;
  deleteHost: string;
  confirmDelete: string;
  saveAndSelect: string;
  saveChanges: string;
  cancel: string;
  hostAndUserRequired: string;
  hostExists: string;
  hostFormHint: string;
  noWslOnHost: string;
  engineProbe: string;
  probeHint: string;
  probeDesc: string;
  available: string;
  notFound: string;
  fileNotWsl: string;
  fileHostMissing: string;
  fileLoading: string;
  fileEmptyDir: string;
  fileTooLarge: string;
  dirTitle: string;
  browse: string;
  dirDesc: string;
  goUp: string;
  addWorkspaceBtn: string;
  addedHint: (path: string) => string;
  fileTab: string;
}

export function copy(locale: string): Copy {
  if (locale.startsWith("zh")) {
    return {
      sectionLabel: "WSL 主机",
      statusRemoteOnly: "经 SSH 连接远程宿主",
      statusDetecting: "检测中…",
      connected: "已连接",
      distroCountSuffix: "个发行版",
      running: "运行中",
      stopped: "已停止",
      setDefault: "设默认",
      showAll: (n) => `显示全部发行版(${n})`,
      factsUser: "默认发行版用户",
      refresh: "重新检测",
      localHint:
        "本机数据由 wsl.exe 实时采集;「设默认」会同步写入 wslconfig(版本列旁的标记即当前默认发行版)。",
      remoteHost: "远程主机",
      remoteSelectAria: "远程 WSL 宿主",
      unselected: "未选择",
      noHostYet: "(尚无主机,点右侧手动添加)",
      addHostTitle: "手动添加主机",
      connect: "连接",
      connecting: "连接中…",
      remoteDesc: "点【连接】探测远程【发行版】与已装【引擎】,自动展开发行版面板。",
      addrLabel: "地址",
      portLabel: "端口",
      userLabel: "用户",
      passwordLabel: "密码",
      editHost: "编辑",
      deleteHost: "删除",
      confirmDelete: "确认删除",
      saveAndSelect: "保存并选择",
      saveChanges: "保存修改",
      cancel: "取消",
      hostAndUserRequired: "主机地址与用户名必填",
      hostExists: "该主机已存在(同地址/端口/用户名),请在下拉中选择",
      hostFormHint:
        "密码经 macOS/Linux 系统自带 expect 非交互送入(不落 argv),明文存于本机插件数据库;留空则走 SSH key 认证(BatchMode)。Windows 客户端暂仅支持 key 认证。",
      noWslOnHost: "宿主未检测到 WSL 发行版(未安装或 wsl.exe 不在 PATH)。",
      engineProbe: "引擎探针",
      probeHint: "仅计发行版内安装(登录 shell PATH,含 ~/.local/bin);/mnt/*(Windows 互操作)路径不计",
      probeDesc: "检出 = 该【CLI】在发行版内可直接调用;路径经登录 shell PATH 解析。",
      available: "可用",
      notFound: "未检出",
      fileNotWsl: "非 WSL 工作区(在 WSL 主机设置页「添加工作区」登记后,这里展示发行版内文件)。",
      fileHostMissing: "该工作区的远程主机已删除,无法读取文件。请重新登记工作区。",
      fileLoading: "加载中…",
      fileEmptyDir: "(空目录)",
      fileTooLarge: "文件超过 512KB,暂不支持预览。",
      dirTitle: "起始目录 / 添加工作区",
      browse: "浏览目录",
      dirDesc: "逐级进入项目目录后点【添加工作区】;已登记的目录会在聊天右侧面板展示【发行版内文件】。",
      goUp: "上一级",
      addWorkspaceBtn: "添加工作区",
      addedHint: (path) => `已登记 ${path};在聊天右侧面板查看文件。`,
      fileTab: "WSL 文件",
    };
  }
  return {
    sectionLabel: "WSL Hosts",
    statusRemoteOnly: "Connect a remote host via SSH",
    statusDetecting: "Detecting…",
    connected: "Connected",
    distroCountSuffix: "distros",
    running: "running",
    stopped: "stopped",
    setDefault: "Set default",
    showAll: (n) => `Show all distros (${n})`,
    factsUser: "Default distro user",
    refresh: "Re-detect",
    localHint:
      "Local data is collected live via wsl.exe; \"Set default\" also updates wslconfig (the marker next to the version column is the current default).",
    remoteHost: "Remote host",
    remoteSelectAria: "Remote WSL host",
    unselected: "None selected",
    noHostYet: "(no hosts yet — use the + button to add one)",
    addHostTitle: "Add host manually",
    connect: "Connect",
    connecting: "Connecting…",
    remoteDesc:
      "Click 【Connect】 to probe remote 【distros】 and installed 【engines】; the distro panel expands automatically.",
    addrLabel: "Host",
    portLabel: "Port",
    userLabel: "User",
    passwordLabel: "Password",
    editHost: "Edit",
    deleteHost: "Delete",
    confirmDelete: "Confirm delete",
    saveAndSelect: "Save & select",
    saveChanges: "Save changes",
    cancel: "Cancel",
    hostAndUserRequired: "Host address and username are required",
    hostExists: "Host already exists (same address/port/user) — pick it in the dropdown",
    hostFormHint:
      "Passwords are fed non-interactively via the system expect (macOS/Linux; never on argv) and stored in the plugin's local database. Leave empty for SSH key auth (BatchMode). Windows clients currently support key auth only.",
    noWslOnHost: "No WSL distros detected on the host (not installed, or wsl.exe not in PATH).",
    engineProbe: "Engine probe",
    probeHint:
      "Only in-distro installs count (login-shell PATH incl. ~/.local/bin); /mnt/* (Windows interop) paths are excluded",
    probeDesc:
      "Detected = the 【CLI】 can be invoked inside the distro; resolved via login-shell PATH.",
    available: "Available",
    notFound: "Not found",
    fileNotWsl:
      "Not a WSL workspace (register it via \"Add workspace\" in the WSL Hosts settings section to browse distro files here).",
    fileHostMissing: "The remote host for this workspace was deleted; files are unreadable. Re-register the workspace.",
    fileLoading: "Loading…",
    fileEmptyDir: "(empty directory)",
    fileTooLarge: "File exceeds 512KB; preview not supported.",
    dirTitle: "Start directory / Add workspace",
    browse: "Browse",
    dirDesc:
      "Navigate into the project directory and click 【Add workspace】; registered dirs get a 【distro file】 browser in the chat side panel.",
    goUp: "Up",
    addWorkspaceBtn: "Add workspace",
    addedHint: (path) => `Registered ${path}; open the chat side panel to browse files.`,
    fileTab: "WSL Files",
  };
}
