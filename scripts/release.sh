#!/usr/bin/env bash
# 发版收口脚本:本地校验 → 构建 → 计算资产 SHA-256 → 打 tag 推送。
#
# tag 推上去后 .github/workflows/release.yml 会重新构建并把 main.js /
# manifest.json 挂到 GitHub Release(样式已内联 main.js,无独立 CSS 资产)(tag 名必须等于
# manifest.json 的 version,workflow 里有强校验)。
#
# 市场安装链(宿主 plugins/market.rs):索引仓
# zhukunpenglinyutong/ccgui-plugins 的 community-plugins.json 登记行 →
# plugins/<id>.json 钉 version + 每文件 sha256 → 宿主从本仓库的
# GitHub Release 拉 {version} 资产并逐文件核对哈希。所以本脚本同时把
# 索引仓需要的两个 JSON 片段写到 dist/market/——发版后把它们提交进索引
# 仓即可(或 PR)。
#
# 用法: pnpm release            # 以 manifest.json 当前版本发版
#       pnpm release 0.5.0      # 先把版本写进 package.json+manifest.json 再发
set -euo pipefail
cd "$(dirname "$0")/.."

# ── 可选:版本参数,同步写 package.json + manifest.json ──
if [ $# -ge 1 ]; then
  node -e "
    const fs = require('fs');
    for (const f of ['package.json', 'manifest.json']) {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      d.version = process.argv[1];
      fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
    }
  " "$1"
  git add package.json manifest.json
  git commit -m "chore: bump $1"
fi

VERSION=$(node -p "require('./manifest.json').version")
TAG="v$VERSION"

# ── 前置:干净工作区 + 代码校验 + 构建 ──
[ -z "$(git status --porcelain)" ] || { echo "✗ 工作区有未提交改动,先提交"; exit 1; }
pnpm validate
pnpm typecheck
pnpm build
grep -q "\"version\": \"$VERSION\"" manifest.json || { echo "✗ manifest 版本异常"; exit 1; }

# ── 市场索引片段:宿主 market.rs 按 repo+version 拉 Release 资产并核对哈希 ──
mkdir -p dist/market
SHA() { shasum -a 256 "$1" | cut -d' ' -f1; }
cat > dist/market/community-plugins.json <<EOF
{ "id": "$(node -p "require('./manifest.json').id")", "repo": "$(node -p "require('./manifest.json').repo")", "name": "$(node -p "require('./manifest.json').name")", "description": $(node -p "JSON.stringify(require('./manifest.json').description)"), "author": "$(node -p "require('./manifest.json').author")" }
EOF
node -e "
  const m = require('./manifest.json');
  const crypto = require('crypto'), fs = require('fs');
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const detail = {
    id: m.id,
    tier: m.tier,
    version: m.version,
    minAppVersion: m.minAppVersion,
    sdkVersion: m.sdkVersion,
    permissions: m.permissions,
    // 样式经 ?raw 内联进 main.js(injectCss 应用),styles.css 不是分发资产。
    sha256: Object.fromEntries(['main.js', 'manifest.json'].map(f => [f, sha(f)])),
  };
  fs.writeFileSync('dist/market/plugins-wsl.json', JSON.stringify(detail, null, 2) + '\n');
"
echo "── 市场索引片段(dist/market/,发版后提交进 ccgui-plugins 索引仓)──"
cat dist/market/community-plugins.json
cat dist/market/plugins-wsl.json

# ── tag + 推送 ──
git tag -a "$TAG" -m "release $TAG"
git push origin HEAD "refs/tags/$TAG"
echo "✓ $TAG 已推送 — Actions 构建中: https://github.com/$(node -p "require('./manifest.json').repo")/actions"
echo "  构建完成后把 dist/market/ 两个文件提交进索引仓,市场即可安装 $VERSION"
