# 构建与发布

Music Tools v1.0.0 面向 Windows x64。安装版、便携版均内置 Electron 40.10.6、Python 3.12.10、Mutagen 和离线繁简转换组件，使用者无需安装 Node.js 或 Python。源代码包面向开发者。

## 下载文件

| 文件 | 用途 |
| --- | --- |
| `Music-Tools-1.0.0-Setup-x64.exe` | 当前用户安装，可选安装目录，提供快捷方式和卸载入口 |
| `Music-Tools-1.0.0-Portable-x64.zip` | 解压后运行 `Music Tools/Music Tools.exe`，保留整个目录 |
| `Music-Tools-1.0.0-Source.zip` | 项目源码、构建脚本与许可证，不包含运行库二进制 |

三个文件的 SHA-256 校验值见 GitHub 发行说明；本地归档同时生成 `SHA256SUMS.txt`。

文件名版本由根目录的 `package.json` 决定。

## 从源码构建

使用 Windows x64 和 Node.js 22.12 或更新版本。在项目根目录执行：

```powershell
npm ci
npm run bootstrap:python
npm start
# 构建安装版和便携目录
npm run package
```

`npm ci` 按锁文件安装 Electron、rcedit、electron-builder 等开发依赖。首次构建还可能下载 NSIS 编译器，需要联网。构建输出位于 `release/`，构建记录位于 `artifacts/`。安装文件名为 `Music Tools Setup 1.0.0 x64.exe`。

Python 引导脚本下载官方嵌入式运行库，完整校验后才解压：

```text
https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip
SHA256: 4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3
```

运行库位于 `source/vendor/python/`，不加入 Git 或源码 ZIP。脚本检查精确版本与 64 位架构；已有运行库会验证并保留。打包也会在缺失时自动引导。支持离线指定同一归档：

```powershell
node scripts/bootstrap-python.cjs --archive 'C:\Downloads\python-3.12.10-embed-amd64.zip'
node scripts/bootstrap-python.cjs --check
```

可分别执行 `node scripts/package.cjs --portable-only` 或 `--installer-only`；后者要求已有同版本的便携构建清单。可通过 `MUSIC_TOOLS_MAKENSIS` 指定 NSIS 编译器，或 `MUSIC_TOOLS_BUILDER_MODULE` 指定已安装的 electron-builder 模块。`MUSIC_TOOLS_ELECTRON_DIST` 可指定相同版本的 Electron 目录，`ELECTRON_BUILDER_CACHE` 可指定编译器缓存。

## 验证

基础回归使用临时生成的音频，不使用个人音乐。可选测试工具通过单独脚本下载，仅用于本地测试：

```powershell
npm run bootstrap:tests
npm test
npm run test:ui
npm run test:ui:tools
npm run test:ui:policy
npm run test:ui:lyrics
npm run test:ui:workspace
npm run test:ui:lyric-results
npm run test:release
npm run test:installer
```

测试引导从 PyPI 下载 imageio-ffmpeg 0.7.0 Windows wheel，校验固定 SHA-256，解压到忽略的 `tests/core-tools/`。其中的 FFmpeg 为 GPLv3 构建，保留上游许可；这些测试工具不进入源码归档、安装包或便携包。

安装测试在 `artifacts/installer-smoke/` 下的独立目录安装、启动、运行引擎、卸载，并用哨兵音频和数据检查保留行为。已有 Music Tools 安装或快捷方式注册时会拒绝测试，避免覆盖用户环境。可显式传入安装包：

```powershell
node scripts/installer-check.cjs '.\release\Music Tools Setup 1.0.0 x64.exe'
```

## 生成公开归档

在已审核、已跟踪源文件的 Git 工作区执行：

```powershell
npm run release:archives
```

或对无 Git 元数据的已审核源码目录使用：

```powershell
node scripts/public-release.cjs --staging .
# 只生成源码 ZIP
node scripts/public-release.cjs --staging . --source-only
```

源码通过显式白名单收录：根说明、许可证、版本和依赖清单，应用代码、原创演示音频、Mutagen 源码及许可、公开构建和测试脚本，以及 `docs/distribution.md`、`docs/providers.md`、`docs/text-tools.md`、`docs/lyrics.md` 与 `docs/images/` 图片。个人音乐、备份、历史报告、测试资料、开发机路径、运行库二进制、Node 依赖和本地测试工具不进入归档。

便携 ZIP 仅收录 `.music-tools-generated.json` 枚举的生成文件，包括清单本身，排除 `data/` 和后来放入的其他文件。两个 ZIP 使用 DEFLATE 压缩、固定文件时间与稳定排序，并在替换成品前完整检查 ZIP。归档脚本不会执行 Git 提交、推送或 GitHub 发布。

核对下载文件：

```powershell
Get-FileHash '.\Music-Tools-1.0.0-Source.zip' -Algorithm SHA256
Get-FileHash '.\Music-Tools-1.0.0-Portable-x64.zip' -Algorithm SHA256
Get-FileHash '.\Music-Tools-1.0.0-Setup-x64.exe' -Algorithm SHA256
Get-Content '.\SHA256SUMS.txt'
```

## 数据位置与更新

便携版将配置、历史和备份存放于旁边的 `data/`；安装版使用当前用户的应用数据目录。备份开关保存于该目录中的 `preferences.json`，默认开启；关闭后不再创建新备份或写入历史，已有备份仍可恢复。原文件没有任何原生标签或图片时也跳过备份；恢复历史仍会保留当前版本的安全备份。安装钩子创建 `resources/installed-mode` 标记，便携目录不含该标记。现有便携数据不会自动导入安装版。

安装目录必须为空或为带标记的旧安装。卸载仅删除构建清单中的程序文件，再删除空目录，保留新增音频、用户数据与备份。更新和卸载前请关闭软件；锁定程序文件会明确报错，可关闭后重试。打包更新保留现有便携 `data/` 和未知新增文件。

Electron 的 `LICENSE` 保留在程序旁，项目 GPL 许可证另存为 `LICENSE-Music-Tools`，第三方说明一并分发。安装包未签名，Windows 可能显示未知发布者提示。
