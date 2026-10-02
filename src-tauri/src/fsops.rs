use crate::{
    db::{iv, sv, Guard, Step, Store, Undo},
    model::*,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::{ImageDecoder, ImageReader};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, Metadata},
    io::{BufReader, Cursor, Read},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Clone, Debug)]
pub struct FileMeta {
    pub path: String,
    pub parent: String,
    pub name: String,
    pub extension: String,
    pub kind: String,
    pub bytes: i64,
    pub modified: i64,
    pub revision: String,
    pub identity: String,
}

pub fn canonical_display(path: &Path) -> Result<String> {
    let p = fs::canonicalize(path)
        .map_err(|e| err("ACCESS_DENIED", e))?
        .to_string_lossy()
        .to_string();
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        Ok(format!(r"\\{rest}"))
    } else {
        Ok(p.strip_prefix(r"\\?\").unwrap_or(&p).to_string())
    }
}
pub fn is_hidden(meta: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return meta.file_attributes() & 0x6 != 0;
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        false
    }
}
pub fn is_link(meta: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}
pub fn identity(file: &File) -> String {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } != 0 {
            return format!(
                "{}:{}:{}",
                info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
            );
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(m) = file.metadata() {
            return format!("{}:{}", m.dev(), m.ino());
        }
    }
    String::new()
}
pub fn revision(meta: &Metadata) -> String {
    format!(
        "{}-{}",
        meta.len(),
        meta.modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .unwrap_or_default()
            .as_nanos()
    )
}
pub fn inspect(path: &Path) -> Result<FileMeta> {
    let actual = canonical_display(path)?;
    let file = File::open(&actual).map_err(|e| err("ACCESS_DENIED", e))?;
    let meta = file.metadata().map_err(|e| err("ACCESS_DENIED", e))?;
    if !meta.is_file() {
        return Err(err("INVALID_FILE", "只能加入普通文件"));
    }
    let p = Path::new(&actual);
    let name = p
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let extension = p
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let kind = match extension.as_str() {
        "png" | "jpg" | "jpeg" | "webp" => "image",
        "pdf" => "pdf",
        "txt" | "md" | "markdown" | "log" | "csv" | "tsv" => "text",
        "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" => "office",
        _ => "other",
    }
    .to_string();
    Ok(FileMeta {
        parent: p
            .parent()
            .unwrap_or(Path::new(""))
            .to_string_lossy()
            .to_string(),
        name,
        extension,
        kind,
        bytes: meta.len() as i64,
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .unwrap_or_default()
            .as_millis() as i64,
        revision: revision(&meta),
        identity: identity(&file),
        path: actual,
    })
}

impl Store {
    pub fn add_file(&mut self, m: &FileMeta) -> Result<bool> {
        if Path::new(&m.path).starts_with(&self.root) {
            return Err(err("APP_DATA_EXCLUDED", "已排除应用资料库、缓存及备份目录"));
        }
        let existing: Option<(String, String, Option<i64>)> = self
            .conn
            .query_row(
                "SELECT id,identity,removed_at FROM files WHERE path_key=?",
                [&m.path],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(sql_err)?;
        if let Some((fid, identity, removed)) = existing {
            if !identity.is_empty() && !m.identity.is_empty() && identity != m.identity {
                self.conn.execute("UPDATE files SET status='inaccessible',error='原位置已被另一文件占用，请重新关联确认' WHERE id=?",[fid]).map_err(sql_err)?;
                return Err(err(
                    "FILE_REPLACED",
                    "原位置的文件身份已变化，已保留标注，请重新关联",
                ));
            }
            self.conn.execute("UPDATE files SET bytes=?,modified=?,revision=?,status='available',error='',removed_at=NULL,version=version+? WHERE id=?",params![m.bytes,m.modified,m.revision,if removed.is_some(){1}else{0},fid]).map_err(sql_err)?;
            return Ok(removed.is_some());
        }
        self.conn.execute("INSERT INTO files(id,path,path_key,parent,name,name_key,extension,kind,bytes,modified,added,revision,identity) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",params![id(),m.path,m.path,m.parent,m.name,key(&m.name),m.extension,m.kind,m.bytes,m.modified,now(),m.revision,m.identity]).map_err(sql_err)?;
        Ok(true)
    }
    pub fn refresh_file(&mut self, fid: &str) -> Result<FileRecord> {
        let old = self.file(fid)?;
        match inspect(Path::new(&old.path)) {
            Ok(m) => {
                if !old.identity.is_empty() && !m.identity.is_empty() && old.identity != m.identity
                {
                    self.conn.execute("UPDATE files SET status='inaccessible',error='原位置已被另一文件占用，请重新关联确认' WHERE id=?",[fid]).map_err(sql_err)?;
                } else {
                    self.conn.execute("UPDATE files SET bytes=?,modified=?,revision=?,status='available',error='' WHERE id=?",params![m.bytes,m.modified,m.revision,fid]).map_err(sql_err)?;
                }
            }
            Err(e) => {
                let (status, reason) = match fs::metadata(&old.path) {
                    Err(io) if io.kind() == std::io::ErrorKind::NotFound => {
                        let root = Path::new(&old.path).ancestors().last();
                        if root.map(|p| p.exists()).unwrap_or(false) {
                            ("missing", "文件不在原位置，请重新关联".to_string())
                        } else {
                            ("offline", "存储位置暂不可用，请连接后刷新".to_string())
                        }
                    }
                    _ => ("inaccessible", e),
                };
                self.conn
                    .execute(
                        "UPDATE files SET status=?,error=? WHERE id=?",
                        params![status, reason, fid],
                    )
                    .map_err(sql_err)?;
            }
        }
        self.file(fid)
    }
    pub fn relink(&mut self, v: &Value) -> Result<Value> {
        let fid = str_arg(v, "id")?;
        let old = self.file(fid)?;
        if v["version"].as_i64() != Some(old.version) {
            return Err(err("VERSION_CONFLICT", "文件记录已变化"));
        }
        let m = inspect(Path::new(str_arg(v, "path")?))?;
        if Path::new(&m.path).starts_with(&self.root) {
            return Err(err("INVALID_FILE", "不能关联应用数据文件"));
        }
        let other: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM files WHERE path_key=? AND id<>?",
                params![m.path, fid],
                |r| r.get(0),
            )
            .map_err(sql_err)?;
        if other > 0 {
            return Err(err(
                "PATH_ALREADY_LINKED",
                "此位置已关联其他记录，请查看已有文件",
            ));
        }
        let tx = self.conn.transaction().map_err(sql_err)?;
        tx.execute("UPDATE files SET path=?,path_key=?,parent=?,name=?,name_key=?,extension=?,kind=?,bytes=?,modified=?,revision=?,identity=?,status='available',error='',version=version+1 WHERE id=?",params![m.path,m.path,m.parent,m.name,key(&m.name),m.extension,m.kind,m.bytes,m.modified,m.revision,m.identity,fid]).map_err(sql_err)?;
        tx.commit().map_err(sql_err)?;
        let steps=vec![Step{sql:"UPDATE files SET path=?,path_key=?,parent=?,name=?,name_key=?,extension=?,kind=?,bytes=?,modified=?,revision=?,identity=?,status=?,error=?,version=version+1 WHERE id=?".into(),args:vec![sv(old.path.clone()),sv(old.path),sv(old.parent),sv(old.name.clone()),sv(key(&old.name)),sv(old.extension),sv(old.kind),iv(old.bytes),iv(old.modified),sv(old.revision),sv(old.identity),sv(old.status),sv(old.error),sv(fid)]}];
        self.remember(Undo {
            label: "重新关联文件".into(),
            steps,
            guards: vec![Guard {
                table: "files".into(),
                id: fid.into(),
                version: old.version + 1,
            }],
        });
        Ok(json_ok())
    }
}

pub fn cache_path(root: &Path, f: &FileRecord, large: bool) -> PathBuf {
    let key = format!("{}\0{}\0{}", f.id, f.revision, f.identity);
    root.join("cache").join(format!(
        "{:x}-{}-v1.png",
        Sha256::digest(key.as_bytes()),
        if large { 1800 } else { 420 }
    ))
}

pub fn preview(root: &Path, f: &FileRecord, large: bool) -> Result<Value> {
    if f.status != "available" {
        return Err(err("FILE_UNAVAILABLE", &f.error));
    }
    let cached = cache_path(root, f, large);
    if cached.is_file() {
        let b = fs::read(&cached).map_err(|e| err("CACHE_ERROR", e))?;
        return Ok(json!({"kind":"image","data":B64.encode(b),"revision":f.revision}));
    }
    let file = File::open(&f.path).map_err(|e| err("ACCESS_DENIED", e))?;
    let meta = file.metadata().map_err(|e| err("ACCESS_DENIED", e))?;
    let real_id = identity(&file);
    if (!f.identity.is_empty() && !real_id.is_empty() && f.identity != real_id)
        || revision(&meta) != f.revision
    {
        return Err(err("FILE_CHANGED", "文件已变化，请刷新预览"));
    }
    let result = match f.kind.as_str() {
        "image" => {
            if meta.len() > 100 * 1024 * 1024 {
                return Err(err(
                    "PREVIEW_TOO_LARGE",
                    "图片超过 100 MB，请使用外部程序打开",
                ));
            }
            let mut reader = ImageReader::new(BufReader::new(file))
                .with_guessed_format()
                .map_err(|e| err("PREVIEW_FAILED", e))?;
            let mut limits = image::Limits::default();
            limits.max_alloc = Some(256 * 1024 * 1024);
            reader.limits(limits);
            let mut decoder = reader
                .into_decoder()
                .map_err(|e| err("PREVIEW_FAILED", e))?;
            let (w, h) = decoder.dimensions();
            if (w as u64) * (h as u64) > 40_000_000 {
                return Err(err(
                    "PREVIEW_TOO_LARGE",
                    "图片超过 40 MP，请使用外部程序打开",
                ));
            }
            let orientation = decoder
                .orientation()
                .map_err(|e| err("PREVIEW_FAILED", e))?;
            let mut img =
                image::DynamicImage::from_decoder(decoder).map_err(|e| err("PREVIEW_FAILED", e))?;
            img.apply_orientation(orientation);
            let size = if large { 1800 } else { 420 };
            let thumb = img.thumbnail(size, size);
            let mut buffer = Cursor::new(Vec::new());
            thumb
                .write_to(&mut buffer, image::ImageFormat::Png)
                .map_err(|e| err("PREVIEW_FAILED", e))?;
            let bytes = buffer.into_inner();
            fs::write(&cached, &bytes).map_err(|e| err("CACHE_ERROR", e))?;
            json!({"kind":"image","data":B64.encode(bytes),"revision":f.revision,"width":w,"height":h})
        }
        "pdf" => {
            if meta.len() > 30 * 1024 * 1024 {
                return Err(err(
                    "PREVIEW_TOO_LARGE",
                    "PDF 超过 30 MB，请使用外部程序打开",
                ));
            }
            let mut bytes = vec![];
            file.take(30 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| err("PREVIEW_FAILED", e))?;
            if bytes.len() > 30 * 1024 * 1024 {
                return Err(err("PREVIEW_TOO_LARGE", "PDF 过大"));
            }
            json!({"kind":"pdf","data":B64.encode(bytes),"revision":f.revision})
        }
        "text" => {
            let mut bytes = vec![];
            file.take(200 * 1024)
                .read_to_end(&mut bytes)
                .map_err(|e| err("PREVIEW_FAILED", e))?;
            let text = if bytes.starts_with(&[0xff, 0xfe]) {
                encoding_rs::UTF_16LE.decode(&bytes[2..]).0.into_owned()
            } else if bytes.starts_with(&[0xfe, 0xff]) {
                encoding_rs::UTF_16BE.decode(&bytes[2..]).0.into_owned()
            } else {
                match std::str::from_utf8(&bytes) {
                    Ok(s) => s.trim_start_matches('\u{feff}').to_string(),
                    Err(e) if e.error_len().is_none() && meta.len() > bytes.len() as u64 => {
                        // A byte-limited preview may end halfway through a UTF-8 character.
                        std::str::from_utf8(&bytes[..e.valid_up_to()])
                            .map_err(|e| err("ENCODING_UNSUPPORTED", e))?
                            .trim_start_matches('\u{feff}')
                            .to_string()
                    }
                    Err(_) => {
                        let (s, _, errors) = encoding_rs::GB18030.decode(&bytes);
                        if errors {
                            return Err(err(
                                "ENCODING_UNSUPPORTED",
                                "无法识别文本编码，请使用外部程序打开",
                            ));
                        }
                        s.into_owned()
                    }
                }
            };
            if text.contains('\0') {
                return Err(err("PREVIEW_UNSUPPORTED", "文件不是可显示的纯文本"));
            }
            json!({"kind":"text","text":text,"truncated":meta.len()>200*1024,"revision":f.revision})
        }
        _ => json!({"kind":"unsupported","revision":f.revision}),
    };
    if fs::metadata(&f.path)
        .map(|m| revision(&m) != f.revision)
        .unwrap_or(true)
    {
        let _ = fs::remove_file(&cached);
        return Err(err("FILE_CHANGED", "预览期间文件已变化，请刷新"));
    }
    Ok(result)
}

pub fn store_pdf_preview(root: &Path, f: &FileRecord, large: bool, data: &str) -> Result<Value> {
    if f.kind != "pdf" {
        return Err(err("INVALID_INPUT", "仅 PDF 预览可写入此缓存"));
    }
    if data.len() > 12 * 1024 * 1024 {
        return Err(err("PREVIEW_TOO_LARGE", "预览缓存过大"));
    }
    let bytes = B64.decode(data).map_err(|e| err("INVALID_INPUT", e))?;
    let reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| err("INVALID_INPUT", e))?;
    let (w, h) = reader
        .into_dimensions()
        .map_err(|e| err("INVALID_INPUT", e))?;
    if w > 2400 || h > 2400 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(err("INVALID_INPUT", "缓存不是有效的限尺寸 PNG"));
    }
    fs::write(cache_path(root, f, large), bytes).map_err(|e| err("CACHE_ERROR", e))?;
    Ok(json_ok())
}

pub fn reveal(path: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            System::Com::{
                CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName},
        };
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        unsafe {
            let com = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
            let mut pidl = std::ptr::null_mut();
            let hr = SHParseDisplayName(
                wide.as_ptr(),
                std::ptr::null_mut(),
                &mut pidl,
                0,
                std::ptr::null_mut(),
            );
            let ok = hr >= 0
                && !pidl.is_null()
                && SHOpenFolderAndSelectItems(pidl, 0, std::ptr::null(), 0) >= 0;
            if !pidl.is_null() {
                CoTaskMemFree(pidl.cast());
            }
            if com >= 0 {
                CoUninitialize();
            }
            if ok {
                return Ok(());
            }
        }
    }
    let parent = Path::new(path)
        .parent()
        .ok_or_else(|| err("FILE_MISSING", "父目录不可用"))?;
    open::that(parent).map_err(|e| err("OPEN_FAILED", e))
}
