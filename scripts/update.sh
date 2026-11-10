#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== 拉取上游更新 ==="
git fetch upstream

new_commits=$(git log --oneline main..upstream/main)
if [ -z "$new_commits" ]; then
    echo "上游没有新提交，无需更新。"
    exit 0
fi

echo "发现上游新提交："
echo "$new_commits"
echo ""

read -rp "是否合并并重新部署？(y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "已取消。"
    exit 0
fi

echo "=== 合并上游 ==="
git merge upstream/main

echo "=== 本地验证 ==="
npm ci
npm test
npm run build

echo "=== 重新部署 ==="
docker compose up -d --build

echo ""
echo "部署完成：http://localhost:14444"
