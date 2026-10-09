"""Refresh a local delivery snapshot and checksums after building the application.

Run from any directory. Existing versioned EXE/installer assets are retained;
when absent, copy them from the matching Tauri build output. This does not build
or publish the application, and never includes user data or local archives.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile


def digest(path):
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default=json.loads((root / "package.json").read_text(encoding="utf-8"))["version"])
    args = parser.parse_args()
    version = args.version
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?", version):
        raise ValueError("Invalid release version")
    if version != "0.3.0-beta.1":
        raise ValueError("Add matching guide/validation mappings for this release")
    release = root / "releases" / ("v" + version)
    release.mkdir(parents=True, exist_ok=True)
    prefix = "Shiqian-v" + version
    for destination, source in [
        (prefix + "-Windows-x64.exe", root / "src-tauri/target/release/shiqian.exe"),
        (prefix + "-Windows-x64-setup.exe", root / "src-tauri/target/release/bundle/nsis" / ("拾签_" + version + "_x64-setup.exe")),
    ]:
        target = release / destination
        if not target.exists():
            if not source.is_file():
                raise FileNotFoundError("Build matching application assets first: " + str(source))
            shutil.copy2(source, target)
    # Documentation names are explicit for the current Beta; new versions must
    # provide their own guide instead of silently copying unrelated release text.
    guide = (root / "docs/beta-v0.3-beta1.md").read_text(encoding="utf-8")
    guide = guide.replace("(validation-v0.3-beta1.md)", "(" + prefix + "-validation.zh-CN.md)")
    guide = re.sub(r"!\[资料包导入预览\]\(images/[^)]+\)\n\n", "", guide)
    guide = guide.replace("开发格式与 API 约定见 [资料包格式 v1](transfer-package-format-v1.md)。", "开发格式与 API 约定保存在源码快照的 docs/transfer-package-format-v1.md。")
    (release / (prefix + "-guide.zh-CN.md")).write_text(guide, encoding="utf-8")
    validation = (root / "docs/validation-v0.3-beta1.md").read_text(encoding="utf-8")
    validation = validation.replace("(beta-v0.3-beta1.md)", "(" + prefix + "-guide.zh-CN.md)")
    (release / (prefix + "-validation.zh-CN.md")).write_text(validation, encoding="utf-8")
    files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root).decode("utf-8").split("\0")
    excluded = {".git", "node_modules", "target", "qa", "local-only", ".build", "releases", "packages", "dist"}
    archive = release / (prefix + "-source.zip")
    count = 0
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name in sorted(set(files)):
            # The delivery verification record is produced after ZIP creation.
            if not name or name == "docs/evidence/beta-delivery.log":
                continue
            path = root / name
            if excluded.intersection(Path(name).parts) or path.suffix.lower() in {".sqlite", ".db", ".dpapi", ".sqtagbackup", ".sqtagpack", ".pem", ".key"} or path.name.startswith(".env"):
                raise RuntimeError("Unexpected private/generated source path: " + name)
            if path.is_file():
                bundle.write(path, "Shiqian/" + name)
                count += 1
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise RuntimeError("Invalid source ZIP")
    assets = sorted(path for path in release.iterdir() if path.is_file() and path.name != "SHA256SUMS.txt")
    lines = [digest(path) + "  " + path.name for path in assets]
    (release / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    for line in lines:
        expected, name = line.split("  ", 1)
        if digest(release / name) != expected:
            raise RuntimeError("Checksum mismatch: " + name)
    report = "Source ZIP integrity: PASS (" + str(count) + " files)\nSHA256 assets: PASS (" + str(len(assets)) + " assets)\n"
    report += "Application assets retained from the verified Beta build; source/docs refreshed.\n"
    for path in assets:
        report += path.name + ": " + str(path.stat().st_size) + " bytes\n"
    (root / "docs/evidence/beta-delivery.log").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
