use crate::{db::Store, fsops, model::*};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

pub struct ExportPlan {
    pub name: String,
    pub files: Vec<(String, String)>,
    pub data_root: PathBuf,
}
impl Store {
    // Read a consistent association snapshot, then release the database lock before copying.
    pub fn tag_export_plan(&self, id: &str) -> Result<ExportPlan> {
        let tag = self
            .tags()?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| err("TAG_NOT_FOUND", "标签已删除"))?;
        let mut stmt = self.conn.prepare("SELECT f.path,f.identity FROM files f JOIN file_tags ft ON ft.file_id=f.id WHERE ft.tag_id=? AND f.removed_at IS NULL ORDER BY f.path").map_err(sql_err)?;
        let rows = stmt
            .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(sql_err)?;
        let files = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_err)?;
        if files.is_empty() {
            return Err(err("EXPORT_EMPTY", "此标签没有关联文件"));
        }
        Ok(ExportPlan {
            name: tag.name,
            files,
            data_root: self.root.clone(),
        })
    }
}
fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(90)
        .collect();
    let s = s.trim().trim_end_matches(['.', ' ']);
    let base = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    if s.is_empty() {
        "标签文件".into()
    } else if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && matches!(base.as_bytes()[3], b'1'..=b'9'))
    {
        format!("_{s}")
    } else {
        s.into()
    }
}
fn reserve_directory(parent: &Path, name: &str) -> Result<PathBuf> {
    for i in 1..=10000 {
        let path = parent.join(if i == 1 {
            name.to_owned()
        } else {
            format!("{name} ({i})")
        });
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(err("EXPORT_DESTINATION", e)),
        }
    }
    Err(err("EXPORT_DESTINATION", "目标文件夹同名项过多"))
}
fn reserve_file(folder: &Path, name: &str) -> io::Result<(PathBuf, File)> {
    let name_path = Path::new(name);
    let stem = safe_name(
        name_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("文件"),
    );
    let ext = name_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| safe_name(s).chars().take(20).collect::<String>())
        .unwrap_or_default();
    let ext = if ext.is_empty() {
        ext
    } else {
        format!(".{ext}")
    };
    for i in 1..=10000 {
        let name = if i == 1 {
            format!("{stem}{ext}")
        } else {
            format!("{stem} ({i}){ext}")
        };
        let path = folder.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "同名文件过多"))
}
fn copy_one(folder: &Path, source: &str, expected_identity: &str) -> Result<String> {
    let path = Path::new(source);
    let meta = fs::symlink_metadata(path).map_err(|e| err("FILE_UNAVAILABLE", e))?;
    if !meta.is_file() || fsops::is_link(&meta) {
        return Err(err("FILE_UNAVAILABLE", "原文件不是普通文件"));
    }
    let mut input = File::open(path).map_err(|e| err("FILE_UNAVAILABLE", e))?;
    let before = input.metadata().map_err(|e| err("FILE_UNAVAILABLE", e))?;
    if !expected_identity.is_empty() && fsops::identity(&input) != expected_identity {
        return Err(err("FILE_CHANGED", "原路径已被其他文件替换，请重新关联"));
    }
    let (target, mut output) = reserve_file(
        folder,
        path.file_name().and_then(|s| s.to_str()).unwrap_or("文件"),
    )
    .map_err(|e| err("COPY_FAILED", e))?;
    let copied = (|| -> Result<()> {
        let bytes = io::copy(&mut input, &mut output).map_err(|e| err("COPY_FAILED", e))?;
        output.sync_all().map_err(|e| err("COPY_FAILED", e))?;
        let after = input.metadata().map_err(|e| err("COPY_FAILED", e))?;
        if bytes != before.len() || fsops::revision(&before) != fsops::revision(&after) {
            return Err(err("FILE_CHANGED", "复制时原文件发生变化，请重试"));
        }
        Ok(())
    })();
    drop(output);
    if let Err(e) = copied {
        let _ = fs::remove_file(&target);
        return Err(e);
    }
    Ok(target.file_name().unwrap().to_string_lossy().into_owned())
}
pub fn export(plan: ExportPlan, destination: &Path) -> Result<Value> {
    let parent = fs::canonicalize(destination).map_err(|e| err("EXPORT_DESTINATION", e))?;
    if !parent.is_dir() {
        return Err(err("EXPORT_DESTINATION", "请选择已有文件夹"));
    }
    let data_root = fs::canonicalize(&plan.data_root).map_err(|e| err("EXPORT_DESTINATION", e))?;
    if parent.starts_with(data_root) {
        return Err(err("EXPORT_DESTINATION", "请选择应用资料库以外的文件夹"));
    }
    let folder = reserve_directory(&parent, &safe_name(&plan.name))?;
    let mut manifest = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(folder.join("_拾签导出清单.txt"))
        .map_err(|e| err("EXPORT_MANIFEST", e))?;
    writeln!(
        manifest,
        "拾签 · 标签文件导出\n标签：{}\n文件数：{}\n",
        plan.name,
        plan.files.len()
    )
    .map_err(|e| err("EXPORT_MANIFEST", e))?;
    let mut copied = 0;
    let mut failures = vec![];
    for (source, identity) in &plan.files {
        let line = match copy_one(&folder, source, identity) {
            Ok(name) => {
                copied += 1;
                format!("成功：{name}\n来源：{source}\n")
            }
            Err(error) => {
                failures.push(json!({"path":source,"error":error}));
                format!("失败：{source}\n原因：{error}\n")
            }
        };
        manifest.write_all(line.as_bytes()).map_err(|e| {
            err(
                "EXPORT_MANIFEST",
                format!(
                    "导出清单写入失败；已复制的文件位于 {}：{e}",
                    folder.display()
                ),
            )
        })?;
    }
    writeln!(manifest, "\n已复制：{copied}；失败：{}", failures.len())
        .and_then(|_| manifest.sync_all())
        .map_err(|e| err("EXPORT_MANIFEST", e))?;
    Ok(
        json!({"path":fsops::canonical_display(&folder)?,"copied":copied,"total":plan.files.len(),"failed":failures.len(),"failures":failures}),
    )
}
