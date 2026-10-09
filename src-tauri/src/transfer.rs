//! Portable originals + annotations. No database, settings, paths or credentials in the archive.
use crate::{
    db::{validate_tag, Store},
    fsops,
    model::*,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
};
use unicode_segmentation::UnicodeSegmentation;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const MAX_FILES: usize = 10_000;
const MAX_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_MANIFEST: u64 = 32 * 1024 * 1024;
#[derive(Default)]
pub struct Control {
    pub busy: AtomicBool,
    pub cancel: AtomicBool,
    pub bytes: AtomicU64,
    phase: Mutex<String>,
}
struct BusyGuard<'a>(&'a Control);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::SeqCst);
    }
}
impl Control {
    pub fn run<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(err("TRANSFER_BUSY", "另一项资料包任务正在进行"));
        }
        let _guard = BusyGuard(self);
        self.cancel.store(false, Ordering::SeqCst);
        self.bytes.store(0, Ordering::SeqCst);
        self.phase("校验");
        f()
    }
    fn phase(&self, text: &str) {
        if let Ok(mut p) = self.phase.lock() {
            *p = text.into();
        }
    }
    pub fn status(&self) -> Value {
        json!({"busy":self.busy.load(Ordering::SeqCst),"bytes":self.bytes.load(Ordering::SeqCst),"phase":self.phase.lock().map(|p|p.clone()).unwrap_or_default()})
    }
    fn check(&self) -> Result<()> {
        if self.cancel.load(Ordering::SeqCst) {
            Err(err(
                "TRANSFER_CANCELLED",
                "资料包任务已取消，原文件与原有标注保留",
            ))
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    name: String,
    entry: String,
    bytes: u64,
    sha256: String,
    note: String,
    favorite: bool,
    added: i64,
    modified: i64,
    tags: Vec<Tag>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    format: u32,
    package_id: String,
    app_version: String,
    created_at: i64,
    files: Vec<Entry>,
}
pub struct Plan {
    files: Vec<FileRecord>,
    pub info: Value,
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn digest<R: Read, W: Write>(
    input: &mut R,
    output: &mut W,
    expected: u64,
    control: &Control,
) -> Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut count = 0u64;
    loop {
        control.check()?;
        let n = input.read(&mut buffer).map_err(|e| err("TRANSFER_IO", e))?;
        if n == 0 {
            break;
        }
        count += n as u64;
        if count > expected {
            return Err(err("FILE_CHANGED", "文件长度发生变化或超过资料包声明"));
        }
        output
            .write_all(&buffer[..n])
            .map_err(|e| err("TRANSFER_IO", e))?;
        hasher.update(&buffer[..n]);
        control.bytes.fetch_add(n as u64, Ordering::SeqCst);
    }
    if count != expected {
        return Err(err("FILE_CHANGED", "文件长度与资料包声明不一致"));
    }
    Ok(format!("{:x}", hasher.finalize()))
}
fn valid_time(value: i64) -> bool {
    (0..=253_402_300_799_999).contains(&value)
}
fn safe_name(name: &str) -> bool {
    // All archive names are generated. Imported filenames must work on Windows too.
    if name.is_empty()
        || name.len() > 240
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return false;
    }
    let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    ![
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&base.as_str())
}
fn summary(m: &Manifest, fingerprint: &str) -> Value {
    let names: HashSet<_> = m
        .files
        .iter()
        .flat_map(|f| f.tags.iter().map(|t| key(&t.name)))
        .collect();
    json!({"fingerprint":fingerprint,"packageId":m.package_id,"fileCount":m.files.len(),"tagCount":names.len(),"bytes":m.files.iter().map(|f|f.bytes).sum::<u64>(),"version":m.app_version,"createdAt":m.created_at,"files":m.files.iter().take(100).map(|f|json!({"name":f.name,"tagCount":f.tags.len(),"favorite":f.favorite,"hasNote":!f.note.is_empty()})).collect::<Vec<_>>()})
}
impl Store {
    pub fn transfer_plan(&self, v: &Value) -> Result<Plan> {
        let mut ids = string_list(v, "ids");
        if ids.is_empty() {
            let tag = v["tagId"].as_str().unwrap_or("");
            let mut s=self.conn.prepare("SELECT id FROM files WHERE removed_at IS NULL AND (?='' OR EXISTS(SELECT 1 FROM file_tags WHERE file_id=files.id AND tag_id=?)) ORDER BY id LIMIT 10001").map_err(sql_err)?;
            ids = s
                .query_map(params![tag, tag], |r| r.get(0))
                .map_err(sql_err)?
                .collect::<std::result::Result<Vec<String>, _>>()
                .map_err(sql_err)?;
        }
        ids.sort();
        ids.dedup();
        if ids.is_empty() || ids.len() > MAX_FILES {
            return Err(err(
                "TRANSFER_LIMIT",
                "请选择 1 至 10,000 个文件，可分批交接",
            ));
        }
        let mut files = Vec::new();
        let mut missing = vec![];
        let mut bytes = 0u64;
        for fid in ids {
            let f = self.file(&fid)?;
            if !safe_name(&f.name) {
                return Err(err(
                    "TRANSFER_FILENAME",
                    format!("文件名过长或无法跨设备使用：{}", f.name),
                ));
            }
            match fsops::inspect(Path::new(&f.path)) {
                Ok(meta) if meta.identity == f.identity && meta.revision == f.revision => {
                    bytes = bytes
                        .checked_add(meta.bytes as u64)
                        .ok_or_else(|| err("TRANSFER_LIMIT", "资料过大"))?;
                }
                _ => missing.push(f.name.clone()),
            }
            files.push(f);
        }
        if bytes > MAX_BYTES {
            return Err(err("TRANSFER_LIMIT", "单个资料包最多 8 GB，请分批交接"));
        }
        let fingerprint = sha(&serde_json::to_vec(&files).map_err(|e| err("TRANSFER_FAILED", e))?);
        let info = json!({"fileCount":files.len(),"bytes":bytes,"missing":missing,"fingerprint":fingerprint,"files":files.iter().take(100).map(|f|json!({"name":f.name,"tagCount":f.tags.len(),"favorite":f.favorite,"hasNote":!f.note.is_empty()})).collect::<Vec<_>>()});
        Ok(Plan { files, info })
    }
}
pub fn export(plan: Plan, path: &Path, expected: &str, control: &Control) -> Result<Value> {
    if plan.info["fingerprint"].as_str() != Some(expected) {
        return Err(err("TRANSFER_CHANGED", "资料已变化，请重新预览"));
    }
    if !plan.info["missing"].as_array().unwrap().is_empty() {
        return Err(err(
            "TRANSFER_MISSING",
            "部分原文件缺失或变化，请刷新或重新关联后导出",
        ));
    }
    if path.extension().and_then(|e| e.to_str()) != Some("sqtagpack") {
        return Err(err("TRANSFER_PATH", "资料包扩展名必须为 .sqtagpack"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| err("TRANSFER_PATH", "请选择保存位置"))?;
    let mut output = tempfile::NamedTempFile::new_in(parent).map_err(|e| err("TRANSFER_IO", e))?;
    let mut manifest = Manifest {
        format: 1,
        package_id: id(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        created_at: now(),
        files: vec![],
    };
    control.phase("打包文件");
    {
        let mut zip = ZipWriter::new(output.as_file_mut());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (i, f) in plan.files.iter().enumerate() {
            let meta = fs::symlink_metadata(&f.path).map_err(|e| err("TRANSFER_IO", e))?;
            if fsops::is_link(&meta) || !meta.is_file() {
                return Err(err("TRANSFER_LINK", "资料包不接受链接或目录"));
            }
            let mut input = File::open(&f.path).map_err(|e| err("TRANSFER_IO", e))?;
            let before = input.metadata().map_err(|e| err("TRANSFER_IO", e))?;
            if fsops::identity(&input) != f.identity || fsops::revision(&before) != f.revision {
                return Err(err("FILE_CHANGED", &f.name));
            }
            let entry = format!("files/{i:05}/{}", f.name);
            zip.start_file(&entry, options)
                .map_err(|e| err("TRANSFER_IO", e))?;
            let hash = digest(&mut input, &mut zip, before.len(), control)?;
            if fsops::revision(&input.metadata().map_err(|e| err("TRANSFER_IO", e))?) != f.revision
            {
                return Err(err("FILE_CHANGED", &f.name));
            }
            manifest.files.push(Entry {
                name: f.name.clone(),
                entry,
                bytes: before.len(),
                sha256: hash,
                note: f.note.clone(),
                favorite: f.favorite,
                added: f.added,
                modified: f.modified,
                tags: f.tags.clone(),
            });
        }
        let content = serde_json::to_vec(&manifest).map_err(|e| err("TRANSFER_FAILED", e))?;
        if content.len() as u64 > MAX_MANIFEST {
            return Err(err("TRANSFER_LIMIT", "标注清单过大，请分批交接"));
        }
        zip.start_file("manifest.json", options)
            .map_err(|e| err("TRANSFER_IO", e))?;
        zip.write_all(&content).map_err(|e| err("TRANSFER_IO", e))?;
        zip.start_file("manifest.sha256", options)
            .map_err(|e| err("TRANSFER_IO", e))?;
        zip.write_all(sha(&content).as_bytes())
            .map_err(|e| err("TRANSFER_IO", e))?;
        zip.finish().map_err(|e| err("TRANSFER_IO", e))?;
    }
    control.check()?;
    output
        .as_file()
        .sync_all()
        .map_err(|e| err("TRANSFER_IO", e))?;
    output
        .persist_noclobber(path)
        .map_err(|e| err("TRANSFER_IO", format!("{e}；请选择未使用的文件名")))?;
    Ok(
        json!({"path":path.to_string_lossy(),"fileCount":manifest.files.len(),"bytes":manifest.files.iter().map(|f|f.bytes).sum::<u64>()}),
    )
}
fn inspect(path: &Path, control: &Control) -> Result<(ZipArchive<File>, Manifest, String)> {
    let mut zip = ZipArchive::new(File::open(path).map_err(|e| err("TRANSFER_IO", e))?)
        .map_err(|e| err("INVALID_PACKAGE", e))?;
    if zip.len() < 3 || zip.len() > MAX_FILES + 2 {
        return Err(err("INVALID_PACKAGE", "资料包文件数异常"));
    }
    let content = {
        let mut f = zip
            .by_name("manifest.json")
            .map_err(|e| err("INVALID_PACKAGE", e))?;
        if f.size() > MAX_MANIFEST {
            return Err(err("INVALID_PACKAGE", "资料清单过大"));
        }
        let mut b = vec![];
        (&mut f)
            .take(MAX_MANIFEST + 1)
            .read_to_end(&mut b)
            .map_err(|e| err("INVALID_PACKAGE", e))?;
        if b.len() as u64 > MAX_MANIFEST {
            return Err(err("INVALID_PACKAGE", "资料清单过大"));
        }
        b
    };
    let checksum = {
        let mut f = zip
            .by_name("manifest.sha256")
            .map_err(|e| err("INVALID_PACKAGE", e))?;
        let mut b = vec![];
        (&mut f)
            .take(65)
            .read_to_end(&mut b)
            .map_err(|e| err("INVALID_PACKAGE", e))?;
        b
    };
    if checksum != sha(&content).as_bytes() {
        return Err(err("CHECKSUM_MISMATCH", "资料清单校验失败"));
    }
    let m: Manifest = serde_json::from_slice(&content).map_err(|e| err("INVALID_PACKAGE", e))?;
    if !valid_time(m.created_at)
        || m.app_version.len() > 100
        || m.format != 1
        || uuid::Uuid::parse_str(&m.package_id).is_err()
        || m.files.is_empty()
        || m.files.len() > MAX_FILES
        || m.files.len() + 2 != zip.len()
    {
        return Err(err("INVALID_PACKAGE", "不支持的资料包版本或清单"));
    }
    let mut expected = HashSet::from(["manifest.json".to_string(), "manifest.sha256".to_string()]);
    let mut total = 0u64;
    for (i, f) in m.files.iter().enumerate() {
        if !safe_name(&f.name)
            || f.entry != format!("files/{i:05}/{}", f.name)
            || !expected.insert(f.entry.clone())
            || f.sha256.len() != 64
            || !f.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || f.note.graphemes(true).count() > 10000
            || !valid_time(f.added)
            || !valid_time(f.modified)
            || f.tags.len() > 1000
        {
            return Err(err("INVALID_PACKAGE", "无效的文件名称、大小或标注"));
        }
        let mut tag_names = HashSet::new();
        for t in &f.tags {
            validate_tag(&t.name)?;
            if t.ai
                .as_ref()
                .map(|a| {
                    !valid_time(a.updated_at) || a.model.len() > 1000 || a.reason.len() > 10000
                })
                .unwrap_or(false)
            {
                return Err(err("INVALID_PACKAGE", "无效的 AI 来源信息"));
            }
            if !tag_names.insert(key(&t.name))
                || !["manual", "folder", "ai"].contains(&t.source.as_str())
                || !["manual", "folder", "ai"].contains(&t.created_by.as_str())
                || (t.source == "ai" && t.ai.is_none())
            {
                return Err(err("INVALID_PACKAGE", "无效的标签来源或重复标签"));
            }
        }
        total = total
            .checked_add(f.bytes)
            .ok_or_else(|| err("INVALID_PACKAGE", "资料过大"))?;
        if total > MAX_BYTES {
            return Err(err("TRANSFER_LIMIT", "资料包超过 8 GB"));
        }
    }
    let mut actual = HashSet::new();
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|e| err("INVALID_PACKAGE", e))?;
        if !expected.contains(f.name())
            || !actual.insert(f.name().to_string())
            || f.is_dir()
            || f.unix_mode()
                .map(|m| m & 0o170000 == 0o120000)
                .unwrap_or(false)
        {
            return Err(err("INVALID_PACKAGE", "资料包含额外、重复或链接条目"));
        }
    }
    control.phase("校验文件");
    for f in &m.files {
        let mut z = zip
            .by_name(&f.entry)
            .map_err(|e| err("INVALID_PACKAGE", e))?;
        if z.size() != f.bytes
            || digest(&mut z, &mut std::io::sink(), f.bytes, control)? != f.sha256
        {
            return Err(err("CHECKSUM_MISMATCH", &f.name));
        }
    }
    Ok((zip, m, sha(&content)))
}
pub fn preview(path: &Path, control: &Control) -> Result<Value> {
    let (_, m, fingerprint) = inspect(path, control)?;
    Ok(summary(&m, &fingerprint))
}
impl Store {
    pub fn import_package(
        &mut self,
        path: &Path,
        destination: &Path,
        expected: &str,
        control: &Control,
    ) -> Result<Value> {
        let (mut zip, m, fingerprint) = inspect(path, control)?;
        if fingerprint != expected {
            return Err(err("TRANSFER_CHANGED", "资料包已变化，请重新预览"));
        }
        let receipt = format!("packageReceipt:{}", m.package_id);
        if self
            .conn
            .query_row("SELECT value FROM settings WHERE key=?", [&receipt], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .map_err(sql_err)?
            .is_some()
        {
            return Err(err(
                "PACKAGE_ALREADY_IMPORTED",
                "本库已导入这份资料包；请查看原导入文件，避免重复",
            ));
        }
        let parent = fs::canonicalize(destination).map_err(|e| err("TRANSFER_PATH", e))?;
        if !parent.is_dir()
            || parent
                .starts_with(fs::canonicalize(&self.root).map_err(|e| err("TRANSFER_PATH", e))?)
        {
            return Err(err("TRANSFER_PATH", "请选择应用资料库之外的文件夹"));
        }
        if self.root.join("transfer-state.json").exists() {
            return Err(err(
                "TRANSFER_RECOVERY",
                "存在未处理的资料包中断记录，请重启后查看恢复提示",
            ));
        }
        let folder = parent.join(format!("拾签资料-{}", m.package_id));
        fs::create_dir(&folder).map_err(|e| {
            err(
                "TRANSFER_PATH",
                format!("{e}；请另选目录，已有文件夹不会覆盖"),
            )
        })?;
        // The marker is durable before extraction. On a crash copies are retained, never silently deleted.
        let marker = self.root.join("transfer-state.json");
        let marker_result = (|| -> Result<()> {
            let mut journal =
                tempfile::NamedTempFile::new_in(&self.root).map_err(|e| err("TRANSFER_IO", e))?;
            journal.write_all(json!({"packageId":m.package_id,"path":folder.to_string_lossy(),"receipt":receipt}).to_string().as_bytes()).map_err(|e|err("TRANSFER_IO",e))?;
            journal
                .as_file()
                .sync_all()
                .map_err(|e| err("TRANSFER_IO", e))?;
            journal
                .persist_noclobber(&marker)
                .map_err(|e| err("TRANSFER_IO", e))?;
            Ok(())
        })();
        if let Err(e) = marker_result {
            let _ = fs::remove_dir(&folder);
            return Err(e);
        }
        control.phase("复制并导入");
        let mut created = vec![];
        let mut directories = vec![];
        let outcome = (|| -> Result<Value> {
            let mut extracted = vec![];
            for (i, f) in m.files.iter().enumerate() {
                control.check()?;
                // Numbered names preserve extensions and disambiguate all same-name files.
                let directory = folder.join(format!("{:05}", i + 1));
                fs::create_dir(&directory).map_err(|e| err("TRANSFER_IO", e))?;
                directories.push(directory.clone());
                let target = directory.join(&f.name);
                let mut out = File::options()
                    .create_new(true)
                    .write(true)
                    .open(&target)
                    .map_err(|e| err("TRANSFER_IO", e))?;
                created.push(target.clone());
                let mut z = zip
                    .by_name(&f.entry)
                    .map_err(|e| err("INVALID_PACKAGE", e))?;
                if digest(&mut z, &mut out, f.bytes, control)? != f.sha256 {
                    return Err(err("CHECKSUM_MISMATCH", &f.name));
                }
                if f.modified >= 0 {
                    out.set_times(std::fs::FileTimes::new().set_modified(
                        std::time::UNIX_EPOCH + std::time::Duration::from_millis(f.modified as u64),
                    ))
                    .map_err(|e| err("TRANSFER_IO", e))?;
                }
                out.sync_all().map_err(|e| err("TRANSFER_IO", e))?;
                drop(out);
                extracted.push(fsops::inspect(&target)?);
            }
            control.check()?;
            self.conn
                .execute_batch("SAVEPOINT package_import")
                .map_err(sql_err)?;
            let commit = (|| -> Result<Value> {
                let mut file_ids = vec![];
                let saved: Option<String> = self
                    .conn
                    .query_row(
                        "SELECT value FROM settings WHERE key='floatingTags'",
                        [],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(sql_err)?;
                let mut pins: Vec<String> = saved
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default();
                for (f, meta) in m.files.iter().zip(&extracted) {
                    control.check()?;
                    let fid = id();
                    self.conn.execute("INSERT INTO files(id,path,path_key,parent,name,name_key,extension,kind,bytes,modified,added,revision,identity,note,note_key,favorite) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",params![fid,meta.path,meta.path,meta.parent,meta.name,key(&meta.name),meta.extension,meta.kind,meta.bytes,meta.modified,f.added,meta.revision,meta.identity,f.note,key(&f.note),f.favorite]).map_err(sql_err)?;
                    for t in &f.tags {
                        let tag = self.create_tag_with_source(&t.name, &t.created_by)?;
                        let ai =
                            t.ai.as_ref()
                                .map(|a| serde_json::to_string(a).unwrap())
                                .unwrap_or_else(|| "{}".into());
                        self.conn.execute("INSERT INTO file_tags(file_id,tag_id,source,ai_meta) VALUES(?,?,?,?)",params![fid,tag.id,t.source,ai]).map_err(sql_err)?;
                        if t.source == "ai"
                            && t.ai.as_ref().map(|a| a.confirmed).unwrap_or(false)
                            && tag.created_by != "folder"
                            && !pins.contains(&tag.id)
                        {
                            pins.push(tag.id);
                        }
                    }
                    file_ids.push(fid);
                }
                self.conn.execute("INSERT INTO settings(key,value) VALUES('floatingTags',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[json!(pins).to_string()]).map_err(sql_err)?;
                self.conn.execute("INSERT INTO settings(key,value) VALUES(?,?)",params![receipt,json!({"path":folder.to_string_lossy(),"ids":file_ids,"importedAt":now()}).to_string()]).map_err(sql_err)?;
                self.validate()?;
                control.check()?;
                Ok(
                    json!({"path":folder.to_string_lossy(),"fileCount":file_ids.len(),"ids":file_ids,"packageId":m.package_id}),
                )
            })();
            match commit {
                Ok(value) => {
                    if let Err(e) = self.conn.execute_batch("RELEASE package_import") {
                        let _ = self
                            .conn
                            .execute_batch("ROLLBACK TO package_import; RELEASE package_import");
                        return Err(sql_err(e));
                    }
                    self.undo.clear();
                    Ok(value)
                }
                Err(e) => {
                    let _ = self
                        .conn
                        .execute_batch("ROLLBACK TO package_import; RELEASE package_import");
                    Err(e)
                }
            }
        })();
        match outcome {
            Ok(mut v) => {
                if fs::remove_file(&marker).is_err() {
                    v["notice"] = json!("导入已完成；下次启动将核对并清理恢复记录");
                }
                Ok(v)
            }
            Err(e) => {
                // Remove only files created by this invocation; never recurse through user directories.
                let mut cleaned = true;
                for p in created {
                    if fs::remove_file(p).is_err() {
                        cleaned = false;
                    }
                }
                for directory in directories.into_iter().rev() {
                    if fs::remove_dir(directory).is_err() {
                        cleaned = false;
                    }
                }
                if fs::remove_dir(&folder).is_err() {
                    cleaned = false;
                }
                if cleaned {
                    let _ = fs::remove_file(&marker);
                }
                Err(e)
            }
        }
    }
    pub fn recover_transfer(&mut self) -> Result<()> {
        let marker = self.root.join("transfer-state.json");
        if !marker.exists() {
            return Ok(());
        }
        let bytes = fs::read(&marker).map_err(|e| err("TRANSFER_RECOVERY", e))?;
        let record: Value =
            serde_json::from_slice(&bytes).map_err(|e| err("TRANSFER_RECOVERY", e))?;
        self.validate()?;
        let receipt = record["receipt"]
            .as_str()
            .ok_or_else(|| err("TRANSFER_RECOVERY", "资料包恢复记录损坏，请保留数据目录"))?;
        let committed = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key=?",
                [receipt],
                |r| r.get::<_, i64>(0),
            )
            .map_err(sql_err)?
            != 0;
        let notice = if committed {
            "上次资料包导入已完成，资料库完整性已验证。".to_string()
        } else {
            format!("上次资料包导入中断，数据库未加入该批记录。已复制的文件保留在 {}；请检查后移走或删除该文件夹，再重新导入。",record["path"].as_str().unwrap_or("导入目录"))
        };
        let recovery = self.root.join("backups");
        fs::create_dir_all(&recovery).map_err(|e| err("TRANSFER_RECOVERY", e))?;
        let mut report = File::options()
            .create_new(true)
            .write(true)
            .open(recovery.join(format!("transfer-recovery-{}.txt", id())))
            .map_err(|e| err("TRANSFER_RECOVERY", e))?;
        report
            .write_all(notice.as_bytes())
            .map_err(|e| err("TRANSFER_RECOVERY", e))?;
        report.sync_all().map_err(|e| err("TRANSFER_RECOVERY", e))?;
        self.recovery_notice = format!("{} {}", self.recovery_notice, notice).trim().into();
        fs::remove_file(marker).map_err(|e| err("TRANSFER_RECOVERY", e))?;
        Ok(())
    }
}
