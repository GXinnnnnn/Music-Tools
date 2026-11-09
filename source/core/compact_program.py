"""Optional, manual, reversible Windows compression of inventoried program files.

Portable usage (close Music Tools first)::
    python.exe -I -B compact_program.py --root PORTABLE_ROOT [--undo] [--json]

Only .music-tools-generated.json format 1 entries are considered. No directory
recursion, deletion, CompactOS changes, elevation, or application startup hooks.
The build inventory is an ownership list, not a cryptographic authenticity proof:
a person allowed to replace the whole program can also replace this helper.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack, contextmanager
import ctypes
from ctypes import wintypes
import json
import locale
import os
from pathlib import Path, PureWindowsPath
import re
import stat
import subprocess
import sys

INVENTORY = ".music-tools-generated.json"
ALGORITHMS = ("XPRESS8K",)
MAX_COMMAND = 28000  # UTF-16 units, leaving headroom below CreateProcess's 32767.
MAX_BATCH = 64
REPARSE_POINT = 0x400
FORBIDDEN = {"data", "music", "usermusic", "user-music", "user_music", "音乐"}
RESERVED = re.compile(r"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)", re.I)


class PolicyError(ValueError):
    """The inventory or a path cannot safely authorize an operation."""


def _no_links(path: Path):
    """Use lstat on every ancestor, including the user-supplied root."""
    for part in reversed((path, *path.parents)):
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & REPARSE_POINT:
            raise PolicyError(f"Links/reparse points are forbidden: {part}")
    return path.lstat()


def _relative(value):
    if not isinstance(value, str) or not value or len(value) > 24000:
        raise PolicyError("Inventory entries must be nonempty relative path strings")
    parts = value.split("/")
    if (PureWindowsPath(value).is_absolute() or PureWindowsPath(value).drive
            or "\\" in value or any(ord(c) < 32 for c in value)
            or any(c in value for c in ':*?\"<>|')
            or any(not p or p in (".", "..") or p.endswith((".", " "))
                   or RESERVED.match(p) or p.casefold() in FORBIDDEN for p in parts)):
        raise PolicyError(f"Unsafe generated inventory entry: {value!r}")
    if value.casefold() == INVENTORY.casefold():
        raise PolicyError("The ownership inventory cannot inventory itself")
    return parts


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PolicyError(f"Duplicate inventory JSON key: {key}")
        result[key] = value
    return result


def _inventory(root):
    filename = root / INVENTORY
    info = _no_links(filename)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise PolicyError("Inventory must be an ordinary, unlinked file")
    if info.st_size > 16 * 1024 * 1024:
        raise PolicyError("Inventory is unexpectedly large")
    try:
        raw = filename.read_bytes()
        saved = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise PolicyError(f"Invalid inventory JSON: {error}") from error
    if (not isinstance(saved, dict) or type(saved.get("format")) is not int
            or saved["format"] != 1 or not isinstance(saved.get("files"), list)):
        raise PolicyError("Inventory must contain format: 1 and a files array")
    names = saved["files"]
    if len(names) > 100000:
        raise PolicyError("Inventory contains too many entries")
    paths, seen = [], set()
    # Validate the whole list before inspecting or changing any candidate file.
    for name in names:
        parts = _relative(name)
        key = name.casefold()
        if key in seen:
            raise PolicyError(f"Duplicate inventory path: {name}")
        seen.add(key)
        paths.append((name, root.joinpath(*parts)))
    return filename, raw, paths


class Windows:
    def __init__(self):
        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.GetCompressedFileSizeW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD)]
        self.api.GetCompressedFileSizeW.restype = wintypes.DWORD
        self.api.GetSystemDirectoryW.argtypes = [wintypes.LPWSTR, wintypes.UINT]
        self.api.GetSystemDirectoryW.restype = wintypes.UINT
        self.api.GetVolumePathNameW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
        self.api.GetVolumePathNameW.restype = wintypes.BOOL
        self.api.GetVolumeInformationW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD),
            ctypes.POINTER(wintypes.DWORD), wintypes.LPWSTR, wintypes.DWORD]
        self.api.GetVolumeInformationW.restype = wintypes.BOOL
        self.api.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
            ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        self.api.CreateFileW.restype = wintypes.HANDLE
        self.api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.api.CloseHandle.restype = wintypes.BOOL

    @contextmanager
    def lock(self, path, inventory=False):
        # GENERIC_READ makes Windows enforce sharing (attribute-only handles do
        # not reliably deny writes). Inventory denies writes; all deny renames.
        handle = self.api.CreateFileW(str(path), 0x80000000, 1 if inventory else 3,
            None, 3, 0x02000000 | 0x00200000, None)
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            yield
        finally:
            self.api.CloseHandle(handle)

    def physical(self, path):
        high = wintypes.DWORD(0)
        ctypes.set_last_error(0)
        low = self.api.GetCompressedFileSizeW(str(path), ctypes.byref(high))
        error = ctypes.get_last_error()
        if low == 0xFFFFFFFF and error:
            raise ctypes.WinError(error)
        return (high.value << 32) | low

    def filesystem(self, root):
        volume, filesystem = ctypes.create_unicode_buffer(32768), ctypes.create_unicode_buffer(256)
        if not self.api.GetVolumePathNameW(str(root), volume, len(volume)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not self.api.GetVolumeInformationW(volume.value, None, 0, None, None, None,
                                               filesystem, len(filesystem)):
            raise ctypes.WinError(ctypes.get_last_error())
        return filesystem.value

    def compact(self):
        directory = ctypes.create_unicode_buffer(32768)
        count = self.api.GetSystemDirectoryW(directory, len(directory))
        if not count or count >= len(directory):
            raise OSError("Cannot find the Windows system directory")
        executable = Path(directory.value) / "compact.exe"
        if not executable.is_file():
            raise OSError("Windows compact.exe is unavailable")
        return executable


def _units(args):
    return len(subprocess.list2cmdline([str(arg) for arg in args]).encode("utf-16-le")) // 2


def _batches(base, entries):
    batch = []
    for entry in entries:
        if _units([*base, str(entry[1])]) > MAX_COMMAND:
            raise PolicyError(f"Generated path exceeds command-line budget: {entry[0]}")
        if batch and (len(batch) >= MAX_BATCH or _units([*base, *(str(p) for _, p in batch), str(entry[1])]) > MAX_COMMAND):
            yield batch
            batch = []
        batch.append(entry)
    if batch:
        yield batch


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


def compact_program(root, *, undo=False, algorithm="XPRESS8K"):
    if algorithm not in ALGORITHMS:
        raise PolicyError("Only XPRESS8K is supported")
    root = Path(os.path.abspath(root))  # Do not resolve away evidence of a junction.
    if not stat.S_ISDIR(_no_links(root).st_mode):
        raise PolicyError("Program root must be an ordinary directory")
    result = {"status": "skipped", "root": str(root), "operation": "undo" if undo else "compress",
              "algorithm": algorithm, "total": 0, "processed": 0, "skipped": 0, "failed": 0,
              "logicalBytesBefore": 0, "logicalBytesAfter": 0,
              "physicalBytesBefore": 0, "physicalBytesAfter": 0, "errors": []}
    windows = Windows() if os.name == "nt" else None
    with ExitStack() as locks:
        if windows:
            # Pin root ancestors first, before reading the ownership list.
            for directory in reversed((root, *root.parents)):
                locks.enter_context(windows.lock(directory))
                _no_links(directory)
            locks.enter_context(windows.lock(root / INVENTORY, inventory=True))
        inventory, inventory_bytes, entries = _inventory(root)
        result["total"] = len(entries)
        good, pinned, identities = [], set(), {}
        physical_ids = set()
        inventory_id = (inventory.stat().st_dev, inventory.stat().st_ino)
        canonical_root = root.resolve(strict=True)
        for name, filename in entries:
            try:
                # Pin each existing ancestor before descending into it.
                for directory in reversed(filename.parents):
                    if directory == root or root not in directory.parents:
                        continue
                    if directory not in pinned:
                        _no_links(directory)
                        if windows:
                            locks.enter_context(windows.lock(directory))
                        _no_links(directory)
                        pinned.add(directory)
                info = _no_links(filename)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise PolicyError(f"Expected a regular file with no hard links: {name}")
                if windows:
                    locks.enter_context(windows.lock(filename))
                    info = _no_links(filename)
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                        raise PolicyError(f"Generated file changed during validation: {name}")
                # Expand DOS short names too: an alias must not bypass the
                # data/user-music policy or name the same file twice.
                try:
                    canonical = filename.resolve(strict=True).relative_to(canonical_root)
                except ValueError as error:
                    raise PolicyError(f"Generated file escapes the program root: {name}") from error
                _relative(canonical.as_posix())
                physical_id = (info.st_dev, info.st_ino)
                if physical_id == inventory_id or physical_id in physical_ids:
                    raise PolicyError(f"Aliased/duplicate generated file: {name}")
                physical_ids.add(physical_id)
                identities[name] = _identity(info)
                good.append((name, filename))
            except OSError as error:
                result["skipped"] += 1
                result["errors"].append({"file": name, "error": str(error)})
        if not windows or sys.getwindowsversion().major < 10:
            result["reason"] = "Optional program compression requires Windows 10 or later; normal use is unchanged."
            result["skipped"] = len(entries)
            return result
        filesystem = windows.filesystem(root)
        result["filesystem"] = filesystem
        if filesystem.upper() != "NTFS":
            result["reason"] = f"Optional compression requires NTFS (found {filesystem}); normal use is unchanged."
            result["skipped"] = len(entries)
            return result
        executable = windows.compact()
        base = [str(executable), "/U" if undo else "/C", "/EXE" if undo else f"/EXE:{algorithm}", "/A", "/Q"]
        # Materialize all bounded batches before the first compression invocation.
        batches = list(_batches(base, good))
        measured = []
        for name, filename in good:
            try:
                physical = windows.physical(filename)
                result["logicalBytesBefore"] += filename.stat().st_size
                result["physicalBytesBefore"] += physical
                measured.append((name, filename))
            except OSError as error:
                result["errors"].append({"file": name, "error": f"Cannot measure before operation: {error}"})
        # Denying inventory writes plus this comparison also detects pre-lock races.
        if inventory.read_bytes() != inventory_bytes:
            raise PolicyError("Inventory changed during validation")
        for name, filename in good:
            if _identity(_no_links(filename)) != identities[name]:
                raise PolicyError(f"Generated file changed during validation: {name}")
        def invoke(batch):
            try:
                completed = subprocess.run([*base, *(str(filename) for _, filename in batch)],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    encoding=locale.getpreferredencoding(False), errors="replace", shell=False,
                    creationflags=subprocess.CREATE_NO_WINDOW, timeout=300)
                if completed.returncode:
                    return "exit", {"files": [name for name, _ in batch],
                        "exitCode": completed.returncode,
                        "error": (completed.stderr or completed.stdout or "compact.exe failed")[-4000:]}
                return "ok", None
            except (OSError, subprocess.TimeoutExpired) as error:
                return "launch", {"files": [name for name, _ in batch], "error": str(error)}

        def record(batch, outcome, error):
            if outcome == "ok":
                result["processed"] += len(batch)
            else:
                result["failed"] += len(batch)
                result["errors"].append(error)

        for batch in batches:
            outcome, error = invoke(batch)
            if outcome == "exit" and len(batch) > 1:
                # A locked/unsupported file must not hide successful neighbours.
                # Repeating /C or /U is harmless and gives per-file exit status.
                for entry in batch:
                    single = [entry]
                    record(single, *invoke(single))
            else:
                record(batch, outcome, error)
        for name, filename in measured:
            try:
                result["logicalBytesAfter"] += filename.stat().st_size
                result["physicalBytesAfter"] += windows.physical(filename)
            except OSError as error:
                result["errors"].append({"file": name, "error": f"Cannot measure after operation: {error}"})
        result["status"] = "partial" if result["errors"] else "ok"
        result["savedPhysicalBytes"] = result["physicalBytesBefore"] - result["physicalBytesAfter"]
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="Manually compress inventoried program files with Windows XPRESS8K. Close Music Tools first. Normal use needs no compression.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4], help="Portable root containing .music-tools-generated.json")
    parser.add_argument("--algorithm", choices=ALGORITHMS, default="XPRESS8K")
    parser.add_argument("--undo", action="store_true", help="Restore ordinary uncompressed program files")
    parser.add_argument("--json", action="store_true", help="Emit one JSON result for build/dev tools")
    options = parser.parse_args(argv)
    try:
        result = compact_program(options.root, undo=options.undo, algorithm=options.algorithm)
        code = 1 if result["failed"] else 0
    except (OSError, ValueError) as error:
        result = {"status": "error", "processed": 0, "error": str(error)}
        code = 2
    if options.json:
        print(json.dumps(result, ensure_ascii=True))
    else:
        print("Optional program compression: " + result["status"])
        print(result.get("reason", result.get("error", f"Processed {result.get('processed', 0)}, skipped {result.get('skipped', 0)}, failed {result.get('failed', 0)} files.")))
        if "physicalBytesBefore" in result:
            print(f"Logical bytes: {result['logicalBytesBefore']} -> {result['logicalBytesAfter']}; physical bytes: {result['physicalBytesBefore']} -> {result['physicalBytesAfter']}")
        for error in result.get("errors", []):
            print(json.dumps(error, ensure_ascii=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
