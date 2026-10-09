[CmdletBinding()]
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\')
$rootPrefix = $projectRoot + '\'
$cleanupDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time').ToString('yyyy-MM-dd')
if (-not (Test-Path -LiteralPath ($rootPrefix + 'package.json')) -or -not (Test-Path -LiteralPath ($rootPrefix + 'src-tauri\Cargo.toml'))) { throw 'Not a Shiqian project directory' }
$paths = @('qa', 'node_modules', 'src-tauri\target', 'src-tauri\tests\core-harness\target', 'dist', 'public\pdf-assets', 'src-tauri\gen', '.build', 'tsconfig.tsbuildinfo')
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) })
$plans = @()
foreach ($relative in $paths) {
    $absolute = [IO.Path]::GetFullPath([IO.Path]::Combine($projectRoot, $relative))
    if (-not $absolute.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Cleanup escaped project: $relative" }
    if (-not (Test-Path -LiteralPath $absolute)) { continue }
    $item = Get-Item -LiteralPath $absolute -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing link: $relative" }
    $children = @()
    if ($item.PSIsContainer) {
        $children = @(Get-ChildItem -LiteralPath $absolute -Recurse -Force)
        if (@($children | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw "Target contains links: $relative" }
    }
    $files = if ($item.PSIsContainer) { @($children | Where-Object { -not $_.PSIsContainer }) } else { @($item) }
    $bytes = ($files | Measure-Object -Property Length -Sum).Sum
    if (-not $bytes) { $bytes = 0 }
    $active = @($running | Where-Object { $_.ExecutablePath.Equals($absolute, [StringComparison]::OrdinalIgnoreCase) -or $_.ExecutablePath.StartsWith($absolute.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
    $plans += [PSCustomObject]@{ Relative=$relative.Replace('\','/'); Absolute=$absolute; Files=$files.Count; Bytes=[long]$bytes; Active=$active }
}
# All targets are checked before mutation. Keep one native shell for all file operations.
$totalBytes = [long]0
$totalFiles = 0
$rows = @()
foreach ($plan in $plans) {
    if ($plan.Active) { $status = 'Running; preserved' }
    elseif ($DryRun) { $status = 'Preview; untouched' }
    else {
        Remove-Item -LiteralPath $plan.Absolute -Recurse -Force
        if (Test-Path -LiteralPath $plan.Absolute) { throw "Cleanup incomplete: $($plan.Relative)" }
        $totalBytes += $plan.Bytes
        $totalFiles += $plan.Files
        $status = 'Removed'
    }
    Write-Output ('{0}: {1} files, {2:N2} MiB, {3}' -f $plan.Relative, $plan.Files, ($plan.Bytes / 1MB), $status)
    $rows += '| ' + $plan.Relative + ' | ' + $plan.Files + ' | ' + ('{0:F2}' -f ($plan.Bytes / 1MB)) + ' | ' + $status + ' |'
}
Write-Output ('Total removed: {0} files, {1:N2} GiB' -f $totalFiles, ($totalBytes / 1GB))
if (-not $DryRun -and $totalFiles -gt 0) {
    $report = @('# 本地项目清理记录', '', ('日期：' + $cleanupDate + '。范围：本项目内的生成文件和隔离测试资料。'), '', '| 路径 | 文件数 | 逻辑大小（MiB） | 结果 |', '| --- | ---: | ---: | --- |') + $rows + @(
        '', ('合计删除 {0} 个文件，{1} 字节，约 {2:F2} GiB。数字为逻辑大小，不等于磁盘实际占用。' -f $totalFiles, $totalBytes, ($totalBytes / 1GB)), '',
        '删除前核对绝对路径在项目内、无目录链接、无运行中的目标程序；采用 PowerShell 原生操作，删除后逐项确认目标不存在。', '',
        '保留源码、锁文件、测试脚本、归档证据、文档截图、.git 历史、全部 releases 交付版本、packages 本地归档及 local-only 素材。运行中的发布程序及正式用户资料库未操作。', '',
        'QA 目录中的合成资料和临时运行副本已删除；真实用户应用数据目录不属于本次范围。', '',
        '后续开发先运行 npm ci，再运行 npm run desktop。Rust 缓存已清理，首次编译会比增量构建慢。安装包仍可直接从 releases/v0.3.0-beta.1 使用。', '',
        '复用清理脚本：scripts/clean-local.ps1 -DryRun 预览；去掉 -DryRun 执行。固定生成目录之外的内容不会删除，遇到目录链接停止，遇到目标下的运行程序保留该目标。'
    )
    [IO.File]::WriteAllLines(($rootPrefix + 'docs\cleanup-' + $cleanupDate + '.md'), $report, [Text.UTF8Encoding]::new($false))
}
