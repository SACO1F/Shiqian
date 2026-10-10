"""Refresh a local delivery snapshot and checksums after building the application.

Run from any directory. Existing assets must match current verified build outputs;
refreshing same-version assets requires explicit --refresh-binaries. This does not build
or publish the application, and never includes user data or local archives.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tomllib
import zipfile


def digest(path):
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def validate_versions(root, expected):
    values = [json.loads((root / name).read_text(encoding="utf-8"))["version"] for name in ("package.json", "package-lock.json", "src-tauri/tauri.conf.json")]
    lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
    values.append(lock["packages"][""]["version"])
    values.append(tomllib.loads((root / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))["package"]["version"])
    cargo_lock = tomllib.loads((root / "src-tauri/Cargo.lock").read_text(encoding="utf-8"))
    values.extend(p["version"] for p in cargo_lock["package"] if p["name"] == "shiqian")
    if len(values) != 6 or any(version != expected for version in values):
        raise RuntimeError("Version mismatch: requested release must match all six source manifests")


def validate_binary(path, expected):
    if not path.is_file():
        raise FileNotFoundError("Build matching application assets first: " + str(path))
    literal = "'" + str(path).replace("'", "''") + "'"
    version = subprocess.check_output(["powershell.exe", "-NoProfile", "-Command", "(Get-Item -LiteralPath " + literal + ").VersionInfo.ProductVersion"], text=True).strip()
    if version != expected:
        raise RuntimeError("Binary version mismatch: " + str(path) + " (" + version + ")")


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default=json.loads((root / "package.json").read_text(encoding="utf-8"))["version"])
    parser.add_argument("--refresh-binaries", action="store_true", help="Explicitly replace this version's delivery binaries with matching verified build outputs")
    args = parser.parse_args()
    version = args.version
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?", version):
        raise ValueError("Invalid release version")
    validate_versions(root, version)
    mappings = {"0.3.0-beta.1": "beta1", "0.3.0-beta.2": "beta2", "0.3.0-beta.3": "beta3", "0.3.0-beta.4": "beta4", "0.3.0-beta.5": "beta5", "0.3.0-beta.6": "beta6", "0.3.0-beta.7": "beta7", "0.3.0-beta.8": "beta8", "0.3.0-beta.9": "beta9"}
    mappings["0.3.0-beta.10"] = "beta10"
    mappings["0.3.0-beta.12"] = "beta12"
    if version not in mappings:
        raise ValueError("Add matching guide/validation mappings for this release")
    suffix = mappings[version]
    release = root / "releases" / ("v" + version)
    release.mkdir(parents=True, exist_ok=True)
    prefix = "Shiqian-v" + version
    binary_assets = [
        (prefix + "-Windows-x64.exe", root / "src-tauri/target/release/shiqian.exe"),
        (prefix + "-Windows-x64-setup.exe", root / "src-tauri/target/release/bundle/nsis" / ("拾签_" + version + "_x64-setup.exe")),
    ]
    # Check both outputs and existing assets before replacing any delivery file.
    for destination, source in binary_assets:
        validate_binary(source, version)
        target = release / destination
        if target.exists() and not args.refresh_binaries:
            validate_binary(target, version)
            if digest(target) != digest(source):
                raise RuntimeError("Stale delivery binary: " + destination + "; use --refresh-binaries after verification")
    for destination, source in binary_assets:
        target = release / destination
        if not target.exists() or args.refresh_binaries:
            shutil.copy2(source, target)
    # Documentation names are explicit for the current Beta; new versions must
    # provide their own guide instead of silently copying unrelated release text.
    guide = (root / ("docs/beta-v0.3-" + suffix + ".md")).read_text(encoding="utf-8")
    guide = guide.replace("(validation-v0.3-" + suffix + ".md)", "(" + prefix + "-validation.zh-CN.md)")
    guide = re.sub(r"!\[资料包导入预览\]\(images/[^)]+\)\n\n", "", guide)
    guide = guide.replace("开发格式与 API 约定见 [资料包格式 v1](transfer-package-format-v1.md)。", "开发格式与 API 约定保存在源码快照的 docs/transfer-package-format-v1.md。")
    (release / (prefix + "-guide.zh-CN.md")).write_text(guide, encoding="utf-8")
    validation = (root / ("docs/validation-v0.3-" + suffix + ".md")).read_text(encoding="utf-8")
    validation = validation.replace("(beta-v0.3-" + suffix + ".md)", "(" + prefix + "-guide.zh-CN.md)")
    if suffix == "beta10":
        validation = validation.replace("[RC 实机清单](beta10-rc-checklist.md)", "RC 实机清单（源码快照内 `docs/beta10-rc-checklist.md`）")
    validation = re.sub(r"\[([^]]+)\]\((evidence/[^)]+)\)", r"\1（源码快照内 `docs/\2`）", validation)
    (release / (prefix + "-validation.zh-CN.md")).write_text(validation, encoding="utf-8")
    files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root).decode("utf-8").split("\0")
    excluded = {".git", "node_modules", "target", "qa", "local-only", ".build", "releases", "packages", "dist"}
    archive = release / (prefix + "-source.zip")
    count = 0
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name in sorted(set(files)):
            # The delivery verification record is produced after ZIP creation.
            if not name or re.fullmatch(r"docs/evidence/beta\d*-delivery\.log", name):
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
    report += "All six source versions and both native binary versions: PASS\nApplication assets match current build outputs; source/docs refreshed.\n"
    for path in assets:
        report += path.name + ": " + str(path.stat().st_size) + " bytes\n"
    (root / ("docs/evidence/beta-delivery.log" if suffix == "beta1" else "docs/evidence/" + suffix + "-delivery.log")).write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
