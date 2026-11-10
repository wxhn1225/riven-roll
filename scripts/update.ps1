Set-Location $PSScriptRoot\..

Write-Host "=== 拉取上游更新 ==="
git fetch upstream

$newCommits = git log --oneline main..upstream/main
if (-not $newCommits) {
    Write-Host "上游没有新提交，无需更新。"
    exit 0
}

Write-Host "发现上游新提交："
$newCommits | ForEach-Object { Write-Host $_ }
Write-Host ""

$confirm = Read-Host "是否合并并重新部署？(y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "已取消。"
    exit 0
}

Write-Host "=== 合并上游 ==="
git merge upstream/main

Write-Host "=== 本地验证 ==="
npm ci
npm test
npm run build

Write-Host "=== 重新部署 ==="
docker compose up -d --build

Write-Host ""
Write-Host "部署完成：http://localhost:14444"
