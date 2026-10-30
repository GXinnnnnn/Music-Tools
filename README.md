<p align="center"><img src="source/ui/assets/icon.png" width="100" alt="Music Tools"></p>

# Music Tools

为本地音乐建立清晰的属性索引，补充**封面、作者／艺术家、专辑、歌词**等信息。Windows 桌面音乐整理工具，以大封面网格浏览，支持单曲编辑和联网批量补全。

[下载 v0.1.0](https://github.com/GXinnnnnn/Music-Tools/releases/tag/v0.1.0) · [使用与构建](docs/distribution.md) · [在线来源说明](docs/providers.md)

![大封面网格与音乐属性编辑](docs/images/library.png)

## 功能

- **音乐属性索引与编辑**：标题、作者／艺术家、专辑、专辑艺术家、年份、音轨、流派、作曲、作词、注释、封面和歌词。
- **联网批量补全**：默认 QQ 音乐与网易云音乐，同等匹配证据时 QQ 优先；可选 iTunes、酷我、MusicBrainz、VGMdb。逐首比较候选，确认后加入草稿。
- **逐项控制同步**：选择需要补充的字段，分别决定只补空值还是覆盖。支持快捷选择“封面＋作者＋专辑”。
- **封面与歌词工具**：本地／在线封面、图片缩放转换、LRC/TXT、歌词偏移和双语排版、旁置文件导出。
- **批量整理**：文件名提取标签、按标签重命名、查找替换、繁简转换、选择性清空。
- **写入前备份**：完整备份、恢复历史、外部修改冲突检查；清空队列支持撤回。支持深浅主题。

![选择平台与同步字段](docs/images/batch.png)

## 下载与开始

首次公开版本为 **v0.1.0**，面向 **Windows x64**。在 [Releases](https://github.com/GXinnnnnn/Music-Tools/releases/latest) 提供三种下载：

| 文件 | 用途 |
| --- | --- |
| `Music-Tools-0.1.0-Setup-x64.exe` | 安装版，可选择安装目录，含开始菜单入口与卸载程序 |
| `Music-Tools-0.1.0-Portable-x64.zip` | 免安装版，解压后运行文件夹内的 `Music Tools.exe` |
| `Music-Tools-0.1.0-Source.zip` | 项目源码，含构建脚本和依赖声明 |

运行版自带运行环境，无需另装 Node.js 或 Python。便携版须保留整个文件夹，并放在可写位置；数据与备份保存在同级 `data/`。安装版数据位于当前用户应用数据目录。

1. 导入文件或文件夹，也可拖入窗口；空队列可先体验原创演示音频。
2. 单击封面编辑属性；多选后点击“补全所选”，选择来源和同步字段。
3. 检查候选与草稿后写入；需要时从“写入历史”恢复。

![深色主题](docs/images/dark.png)

## 格式与匹配说明

支持 MP3、FLAC、M4A、OGG、OPUS、WAV、AIFF、WMA、WV、DSF 等常见格式；实际读写能力取决于文件容器。程序只整理标签，不转码音频。

搜索发送文件名线索及已选用的文本标签，不上传音频。匹配结果需要核对，尤其是同名歌曲、翻唱与现场版本。第三方服务可能限流或不可用；VGMdb 在部分网络下可能无法连接。完整文件备份会占用相应磁盘空间。

## 开发

Windows x64，Node.js 22.12+：

```sh
npm ci
npm run bootstrap:python
npm start
npm run bootstrap:tests
npm test
npm run package
```

源码中的 Python 音频库与许可证随项目保留；便携 Python 由脚本从官方站点下载并核对 SHA-256。构建说明与桌面验证命令见 [distribution.md](docs/distribution.md)。界面截图仅使用项目原创合成音频。

项目自身代码采用 [GPL-3.0-or-later 许可证](LICENSE)；第三方组件保留各自许可证，详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
