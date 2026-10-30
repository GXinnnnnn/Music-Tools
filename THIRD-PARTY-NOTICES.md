# Third-party notices

Music Tools bundles the following runtimes/libraries. Its application interface, icons and service adapters are independently implemented. All demo recordings are generated sine waves and all demo covers are original procedural artwork.

- Electron 40.10.6 — Electron contributors, MIT; Chromium and additional third-party notices. Portable release includes `LICENSE` and `LICENSES.chromium.html` alongside the executable. https://github.com/electron/electron
- Python 3.12.10 embedded Windows x64 — Python Software Foundation and contributors; PSF License and bundled dependency notices at `resources/app/source/vendor/python/LICENSE.txt`. Development copy is `source/vendor/python/LICENSE.txt`. https://www.python.org/
- Mutagen 1.48.1 — Mutagen contributors; GPL-2.0-or-later. Complete corresponding Python source is bundled at `resources/app/source/vendor/python-libs/mutagen/`, with license at `resources/app/source/vendor/python-libs/mutagen-1.48.1.dist-info/licenses/COPYING`. Development paths omit `resources/app/`. It is used in a separate Python process for audio tags and no audio transcoding. https://github.com/quodlibet/mutagen
- opencc-js 1.4.2 — The nk2028 Project; MIT, with OpenCC dictionary data and Apache-2.0 third-party notices. The complete unmodified bundle is embedded in `source/core/text-tools.cjs`, with full license text both in that module and `docs/text-tools.md`. Upstream integrity and update provenance are documented there. https://github.com/nk2028/opencc-js

Development-only: Playwright 1.58.2 (Apache-2.0), rcedit 5.0.2 (MIT), electron-builder 26.8.1 (MIT), and imageio-ffmpeg 0.7.0 (BSD-2-Clause wrapper). The optional Windows FFmpeg 7.1 fixture binary is a GPLv3-enabled Gyan build; it is downloaded separately for local tests and is NOT distributed in the repository, source archive, or application. Upstream source/build information: https://www.gyan.dev/ffmpeg/builds/ and https://ffmpeg.org/download.html . Test tooling generates disposable sine-wave fixtures and remains in ignored `tests/core-tools/`.

Project code and original assets are GPL-3.0-or-later; third-party components retain their own licenses. Complete application source and build scripts are available with the matching release source archive and in the project repository: https://github.com/GXinnnnnn/Music-Tools .

Online services are contacted through independent adapters: QQ Music, NetEase Music, Apple iTunes Search, Kuwo, MusicBrainz, VGMdb, Cover Art Archive and LRCLIB. Search results, cover artwork, lyrics, service names and recordings belong to their respective right holders. No credentials, commercial recording assets or original program binaries are embedded.
