#!/usr/bin/env bash
#
# 把「要上线的那几个文件」挑出来放进 dist/。
#
# 为什么要挑：仓库根目录里躺着 concept/（约 131 MB 的分镜母版与对照图），
# 它们有保留价值但没必要让每个访客的带宽和 Pages 的构建产物一起承担。
# 白名单比黑名单安全——以后新增的草稿目录默认不会误上线。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist_dir="$repo_root/dist"

rm -rf "$dist_dir"
mkdir -p "$dist_dir"

cp "$repo_root/index.html" "$dist_dir/"
cp "$repo_root/_headers" "$dist_dir/"
cp -R "$repo_root/assets" "$dist_dir/assets"

echo "打包完成：$dist_dir"
du -sh "$dist_dir"
