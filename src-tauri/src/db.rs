use crate::model::*;
use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension, Row,
    Transaction,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use unicode_segmentation::UnicodeSegmentation;

const FILE_COLUMNS: &str = "f.id,f.path,f.parent,f.name,f.extension,f.kind,f.bytes,f.modified,f.added,f.status,f.error,f.favorite,f.version,f.note,f.note_version,f.revision,f.identity";

pub struct Step {
    pub sql: String,
    pub args: Vec<SqlValue>,
}
pub struct Guard {
    pub table: String,
    pub id: String,
    pub version: i64,
}
pub struct Undo {
    pub label: String,
    pub steps: Vec<Step>,
    pub guards: Vec<Guard>,
}
pub struct Store {
    pub conn: Connection,
    pub root: PathBuf,
    pub undo: Vec<Undo>,
    pub recovery_notice: String,
}
pub fn sv(s: impl Into<String>) -> SqlValue {
    SqlValue::Text(s.into())
}
pub fn iv(i: i64) -> SqlValue {
    SqlValue::Integer(i)
}
fn step(sql: &str, args: Vec<SqlValue>) -> Step {
    Step {
        sql: sql.into(),
        args,
    }
}
fn read_file(row: &Row<'_>) -> rusqlite::Result<FileRecord> {
    Ok(FileRecord {
        id: row.get(0)?,
        path: row.get(1)?,
        parent: row.get(2)?,
        name: row.get(3)?,
        extension: row.get(4)?,
        kind: row.get(5)?,
        bytes: row.get(6)?,
        modified: row.get(7)?,
        added: row.get(8)?,
        status: row.get(9)?,
        error: row.get(10)?,
        favorite: row.get(11)?,
        version: row.get(12)?,
        note: row.get(13)?,
        note_version: row.get(14)?,
        revision: row.get(15)?,
        identity: row.get(16)?,
        tags: vec![],
        ai_task: None,
    })
}

pub fn validate_tag(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.graphemes(true).count() > 40 || name.chars().any(char::is_control) {
        return Err(err(
            "INVALID_TAG",
            "标签应为 1～40 个字符，不能包含换行或控制字符",
        ));
    }
    Ok(name.into())
}

impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        std::fs::create_dir_all(root).map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        std::fs::create_dir_all(root.join("cache")).map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        let conn = Connection::open(root.join("library.sqlite")).map_err(sql_err)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(sql_err)?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )
        .map_err(sql_err)?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(sql_err)?;
        if version > 2 {
            return Err(err(
                "VERSION_UNSUPPORTED",
                "资料库由较新版本创建，请升级拾签",
            ));
        }
        if version == 0 {
            conn.execute_batch("BEGIN IMMEDIATE;
              CREATE TABLE library_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
              CREATE TABLE files(id TEXT PRIMARY KEY,path TEXT NOT NULL,path_key TEXT NOT NULL UNIQUE,parent TEXT NOT NULL,name TEXT NOT NULL,name_key TEXT NOT NULL,extension TEXT NOT NULL,kind TEXT NOT NULL,bytes INTEGER NOT NULL,modified INTEGER NOT NULL,added INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'available',error TEXT NOT NULL DEFAULT '',favorite INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,note TEXT NOT NULL DEFAULT '',note_key TEXT NOT NULL DEFAULT '',note_version INTEGER NOT NULL DEFAULT 0,revision TEXT NOT NULL,identity TEXT NOT NULL DEFAULT '',removed_at INTEGER);
              CREATE TABLE tags(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,version INTEGER NOT NULL DEFAULT 1,last_used INTEGER NOT NULL DEFAULT 0);
              CREATE TABLE file_tags(file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(file_id,tag_id));
              CREATE INDEX tags_files ON file_tags(tag_id,file_id);
              CREATE INDEX files_added ON files(removed_at,added DESC,id);
              CREATE INDEX files_name ON files(removed_at,name_key,id);
              CREATE INDEX files_modified ON files(removed_at,modified,id);
              CREATE INDEX files_favorite ON files(removed_at,favorite);
              CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
              CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
              INSERT INTO schema_migrations VALUES(1,CAST(strftime('%s','now') AS INTEGER)*1000);
              PRAGMA user_version=1;").map_err(sql_err)?;
            conn.execute("INSERT INTO library_meta VALUES('id',?)", [id()])
                .map_err(sql_err)?;
            conn.execute_batch("COMMIT;").map_err(sql_err)?;
        }
        if version == 1 {
            let backups = root.join("backups");
            std::fs::create_dir_all(&backups).map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
            let snapshot = backups.join("before-auto-tags-schema-v1.sqlite");
            if !snapshot.exists() {
                let mut target = Connection::open(snapshot).map_err(sql_err)?;
                rusqlite::backup::Backup::new(&conn, &mut target)
                    .map_err(sql_err)?
                    .run_to_completion(64, std::time::Duration::from_millis(1), None)
                    .map_err(sql_err)?;
            }
        }
        crate::auto_tags::migrate(&conn)?;
        conn.execute(
            "UPDATE ai_jobs SET status='queued',error='' WHERE status='running'",
            [],
        )
        .map_err(sql_err)?;
        let mut store = Self {
            conn,
            root: root.into(),
            undo: vec![],
            recovery_notice: String::new(),
        };
        store.recovery_notice = store
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key='recoveryNotice'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(sql_err)?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if root.join("restore-state.toml").exists() {
            store.validate()?;
            store.recovery_notice =
                "检测到上次恢复流程中断，数据库完整性已验证。恢复前备份保留在 backups 目录。"
                    .into();
            store.remember_recovery()?;
            std::fs::remove_file(root.join("restore-state.toml"))
                .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        }
        store.recover_transfer()?;
        Ok(store)
    }
    pub fn validate(&self) -> Result<()> {
        validate_database(&self.conn)
    }
    pub fn file(&self, id: &str) -> Result<FileRecord> {
        let mut f = self
            .conn
            .query_row(
                &format!(
                    "SELECT {FILE_COLUMNS} FROM files f WHERE f.id=? AND f.removed_at IS NULL"
                ),
                [id],
                read_file,
            )
            .optional()
            .map_err(sql_err)?
            .ok_or_else(|| err("FILE_NOT_FOUND", "文件记录不存在或已移除"))?;
        f.tags = self.file_tags(id)?;
        f.ai_task = self.ai_task(id)?;
        Ok(f)
    }
    pub fn file_tags(&self, id: &str) -> Result<Vec<Tag>> {
        let mut st=self.conn.prepare("SELECT t.id,t.name,t.version,t.created_by,ft.source,ft.ai_meta FROM tags t JOIN file_tags ft ON t.id=ft.tag_id WHERE ft.file_id=? ORDER BY t.name_key").map_err(sql_err)?;
        let rows = st
            .query_map([id], |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    count: 0,
                    version: r.get(2)?,
                    created_by: r.get(3)?,
                    accepted: false,
                    source: r.get(4)?,
                    ai: serde_json::from_str(&r.get::<_, String>(5)?).ok(),
                })
            })
            .map_err(sql_err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_err)
    }
    pub fn tags(&self) -> Result<Vec<Tag>> {
        let mut st=self.conn.prepare("SELECT t.id,t.name,t.version,COUNT(f.id),t.created_by,EXISTS(SELECT 1 FROM file_tags accepted WHERE accepted.tag_id=t.id AND accepted.source='ai' AND json_extract(accepted.ai_meta,'$.confirmed')=1) FROM tags t LEFT JOIN file_tags ft ON t.id=ft.tag_id LEFT JOIN files f ON f.id=ft.file_id AND f.removed_at IS NULL GROUP BY t.id ORDER BY t.last_used DESC,t.name_key").map_err(sql_err)?;
        let rows = st
            .query_map([], |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    version: r.get(2)?,
                    count: r.get(3)?,
                    created_by: r.get(4)?,
                    accepted: r.get(5)?,
                    ..Default::default()
                })
            })
            .map_err(sql_err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_err)
    }
    /// Suggestions stay attached to files until the user accepts them.
    pub fn tag_pool(&self) -> Result<Vec<Tag>> {
        Ok(self
            .tags()?
            .into_iter()
            .filter(|tag| tag.created_by != "ai" || tag.accepted)
            .collect())
    }
    pub fn bootstrap(&self) -> Result<Value> {
        let (all,inbox,starred,unavailable):(i64,i64,i64,i64)=self.conn.query_row("SELECT COUNT(*),COALESCE(SUM(NOT EXISTS(SELECT 1 FROM file_tags WHERE file_id=f.id)),0),COALESCE(SUM(favorite),0),COALESCE(SUM(status IN ('missing','offline','inaccessible')),0) FROM files f WHERE removed_at IS NULL",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(sql_err)?;
        let mut settings = serde_json::Map::new();
        let mut st = self
            .conn
            .prepare("SELECT key,value FROM settings")
            .map_err(sql_err)?;
        let entries = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(sql_err)?;
        for entry in entries {
            let (k, v) = entry.map_err(sql_err)?;
            settings.insert(k, serde_json::from_str(&v).unwrap_or(Value::String(v)));
        }
        Ok(
            json!({"tags":self.tag_pool()?,"counts":{"all":all,"inbox":inbox,"starred":starred,"unavailable":unavailable,"recent":all},"settings":settings,"undoLabel":self.undo.last().map(|u|u.label.clone()),"dataPath":self.root.to_string_lossy(),"version":env!("CARGO_PKG_VERSION"),"notice":self.recovery_notice}),
        )
    }
    pub fn query(&self, q: &Query) -> Result<Value> {
        let mut sql = " WHERE f.removed_at IS NULL".to_owned();
        let mut args: Vec<SqlValue> = vec![];
        match q.scope.as_str() {
            "inbox" => sql.push_str(" AND NOT EXISTS(SELECT 1 FROM file_tags WHERE file_id=f.id)"),
            "starred" => sql.push_str(" AND f.favorite=1"),
            "unavailable" => sql.push_str(" AND f.status IN ('missing','offline','inaccessible')"),
            _ => {}
        }
        for term in q.text.split_whitespace() {
            sql.push_str(" AND (instr(f.name_key,?)>0 OR instr(f.note_key,?)>0 OR EXISTS(SELECT 1 FROM file_tags ft JOIN tags t ON t.id=ft.tag_id WHERE ft.file_id=f.id AND instr(t.name_key,?)>0))");
            for _ in 0..3 {
                args.push(sv(key(term)));
            }
        }
        let include: HashSet<_> = q.include.iter().collect();
        if include.iter().any(|t| q.exclude.contains(t)) {
            return Err(err("INVALID_FILTER", "同一标签不能同时包含和排除"));
        }
        if !include.is_empty() {
            sql.push_str(" AND (");
            for (i, tag) in include.iter().enumerate() {
                if i > 0 {
                    sql.push_str(if q.mode == "any" { " OR " } else { " AND " });
                }
                sql.push_str("EXISTS(SELECT 1 FROM file_tags WHERE file_id=f.id AND tag_id=?)");
                args.push(sv((*tag).clone()));
            }
            sql.push(')');
        }
        for tag in &q.exclude {
            sql.push_str(
                " AND NOT EXISTS(SELECT 1 FROM file_tags WHERE file_id=f.id AND tag_id=?)",
            );
            args.push(sv(tag.clone()));
        }
        if !q.kinds.is_empty() {
            sql.push_str(" AND f.kind IN (");
            sql.push_str(&vec!["?"; q.kinds.len()].join(","));
            sql.push(')');
            for kind in &q.kinds {
                args.push(sv(kind.clone()));
            }
        }
        if !q.status.is_empty() {
            sql.push_str(" AND f.status=?");
            args.push(sv(q.status.clone()));
        }
        if let Some(from) = q.from {
            sql.push_str(" AND f.modified>=?");
            args.push(iv(from));
        }
        if let Some(to) = q.to {
            sql.push_str(" AND f.modified<?");
            args.push(iv(to));
        }
        if !q.directory.is_empty() {
            let p = crate::fsops::canonical_display(Path::new(&q.directory))
                .unwrap_or(q.directory.clone());
            if q.recursive {
                let prefix = format!("{}\\", p.trim_end_matches(['\\', '/']));
                sql.push_str(" AND (f.parent=? OR substr(f.parent,1,length(?))=?)");
                args.extend([sv(p), sv(prefix.clone()), sv(prefix)]);
            } else {
                sql.push_str(" AND f.parent=?");
                args.push(sv(p));
            }
        }
        let total: i64 = self
            .conn
            .query_row(
                &format!("SELECT COUNT(*) FROM files f{sql}"),
                params_from_iter(args.iter()),
                |r| r.get(0),
            )
            .map_err(sql_err)?;
        let order = match q.sort.as_str() {
            "name" => "f.name_key",
            "modified" => "f.modified",
            "size" => "f.bytes",
            _ => "f.added",
        };
        let direction = if q.direction == "asc" { "ASC" } else { "DESC" };
        let limit = q.limit.clamp(1, 100);
        args.push(iv(limit as i64));
        args.push(iv(q.offset.min(i64::MAX as usize) as i64));
        let mut st=self.conn.prepare(&format!("SELECT {FILE_COLUMNS} FROM files f{sql} ORDER BY {order} {direction},f.id LIMIT ? OFFSET ?")).map_err(sql_err)?;
        let rows = st
            .query_map(params_from_iter(args.iter()), read_file)
            .map_err(sql_err)?;
        let mut files = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_err)?;
        for f in &mut files {
            f.tags = self.file_tags(&f.id)?;
            f.ai_task = self.ai_task(&f.id)?;
        }
        Ok(
            json!({"files":files,"total":total,"offset":q.offset,"hasMore":(q.offset+files.len())<(total as usize)}),
        )
    }
    pub fn create_tag(&mut self, name: &str) -> Result<Tag> {
        self.create_tag_with_source(name, "manual")
    }
    pub fn create_tag_with_source(&mut self, name: &str, source: &str) -> Result<Tag> {
        let name = validate_tag(name)?;
        let k = key(&name);
        if let Some(mut t) = self
            .conn
            .query_row(
                "SELECT id,name,version,created_by FROM tags WHERE name_key=?",
                [&k],
                |r| {
                    Ok(Tag {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        version: r.get(2)?,
                        count: 0,
                        created_by: r.get(3)?,
                        ..Default::default()
                    })
                },
            )
            .optional()
            .map_err(sql_err)?
        {
            if source == "manual" && t.created_by == "ai" {
                self.conn
                    .execute(
                        "UPDATE tags SET created_by='manual',version=version+1 WHERE id=?",
                        [&t.id],
                    )
                    .map_err(sql_err)?;
                t.created_by = "manual".into();
                t.version += 1;
            }
            return Ok(t);
        }
        let tid = id();
        self.conn
            .execute(
                "INSERT INTO tags(id,name,name_key,last_used,created_by) VALUES(?,?,?,?,?)",
                params![tid, name, k, now(), source],
            )
            .map_err(sql_err)?;
        Ok(Tag {
            id: tid,
            name,
            version: 1,
            count: 0,
            created_by: source.into(),
            ..Default::default()
        })
    }
    pub fn save_note(&mut self, v: &Value) -> Result<Value> {
        let fid = str_arg(v, "id")?;
        let text = str_arg(v, "text")?;
        let version = v["version"]
            .as_i64()
            .ok_or_else(|| err("INVALID_INPUT", "缺少备注版本"))?;
        if text.graphemes(true).count() > 10_000 {
            return Err(err("NOTE_TOO_LONG", "备注最多 10,000 个字符"));
        }
        let changed=self.conn.execute("UPDATE files SET note=?,note_key=?,note_version=note_version+1 WHERE id=? AND note_version=? AND removed_at IS NULL",params![text,key(text),fid,version]).map_err(sql_err)?;
        if changed != 1 {
            return Err(err(
                "VERSION_CONFLICT",
                "备注已更新或文件已移除，请保留草稿并重新加载",
            ));
        }
        Ok(json!({"version":version+1,"savedAt":now()}))
    }
    pub fn save_settings(&mut self, v: &Value) -> Result<Value> {
        let name = str_arg(v, "key")?;
        if ![
            "theme",
            "views",
            "density",
            "details",
            "galleryColumns",
            "sidebarCollapsed",
            "sidebarWidth",
            "floatingSize",
            "floatingPosition",
            "floatingAlwaysOnTop",
            "folderAutoTagging",
        ]
        .contains(&name)
        {
            return Err(err("INVALID_INPUT", "不支持的设置"));
        }
        if name == "galleryColumns" && !v["value"].as_u64().is_some_and(|n| (2..=8).contains(&n)) {
            return Err(err("INVALID_INPUT", "瀑布流列数必须在 2 到 8 之间"));
        }
        if name == "sidebarWidth"
            && !v["value"]
                .as_u64()
                .is_some_and(|n| (180..=360).contains(&n))
        {
            return Err(err("INVALID_INPUT", "菜单宽度必须在 180 到 360 像素之间"));
        }
        if name == "floatingSize"
            && !(v["value"]["width"]
                .as_u64()
                .is_some_and(|n| (280..=900).contains(&n))
                && v["value"]["height"]
                    .as_u64()
                    .is_some_and(|n| (320..=1000).contains(&n)))
        {
            return Err(err("INVALID_INPUT", "浮窗尺寸超出支持范围"));
        }
        if name == "floatingAlwaysOnTop" && !v["value"].is_boolean() {
            return Err(err("INVALID_INPUT", "置顶状态必须为布尔值"));
        }
        if name == "floatingPosition"
            && !(v["value"]["x"]
                .as_i64()
                .is_some_and(|x| i32::try_from(x).is_ok())
                && v["value"]["y"]
                    .as_i64()
                    .is_some_and(|y| i32::try_from(y).is_ok()))
        {
            return Err(err("INVALID_INPUT", "浮窗位置必须为有效的屏幕坐标"));
        }
        if matches!(name, "sidebarCollapsed" | "folderAutoTagging") && !v["value"].is_boolean() {
            return Err(err("INVALID_INPUT", "菜单收拢状态必须为布尔值"));
        }
        self.conn.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![name,v["value"].to_string()]).map_err(sql_err)?;
        Ok(json_ok())
    }
    pub fn all_paths(&self) -> Result<Vec<(String, String)>> {
        let mut st = self
            .conn
            .prepare("SELECT id,path FROM files WHERE removed_at IS NULL ORDER BY added DESC")
            .map_err(sql_err)?;
        let rows = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(sql_err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_err)
    }
    pub fn remember(&mut self, u: Undo) {
        self.undo.push(u);
        if self.undo.len() > 20 {
            self.undo.remove(0);
        }
    }
}

pub fn validate_database(conn: &Connection) -> Result<()> {
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(sql_err)?;
    if !(1..=2).contains(&version) {
        return Err(err("BACKUP_VERSION_UNSUPPORTED", "不支持此资料库版本"));
    }
    if version == 2 {
        conn.prepare("SELECT created_by FROM tags LIMIT 0")
            .map_err(sql_err)?;
        conn.prepare("SELECT source,ai_meta FROM file_tags LIMIT 0")
            .map_err(sql_err)?;
        conn.prepare("SELECT file_id,status,error,updated_at FROM ai_jobs LIMIT 0")
            .map_err(sql_err)?;
        let invalid:i64=conn.query_row("SELECT COUNT(*) FROM file_tags WHERE NOT json_valid(ai_meta) OR source NOT IN ('manual','folder','ai')",[],|r|r.get(0)).map_err(sql_err)?;
        if invalid != 0 {
            return Err(err("BACKUP_INVALID", "标签来源记录无效"));
        }
    }
    let check: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(sql_err)?;
    if check != "ok" {
        return Err(err("BACKUP_INVALID", check));
    }
    let violations: Option<String> = conn
        .query_row("PRAGMA foreign_key_check", [], |r| r.get(0))
        .optional()
        .map_err(sql_err)?;
    if violations.is_some() {
        return Err(err("BACKUP_INVALID", "存在失效的关联"));
    }
    conn.prepare(&format!("SELECT {FILE_COLUMNS} FROM files f LIMIT 0"))
        .map_err(sql_err)?;
    for table in [
        "tags",
        "file_tags",
        "settings",
        "library_meta",
        "schema_migrations",
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
                [table],
                |r| r.get(0),
            )
            .map_err(sql_err)?;
        if exists != 1 {
            return Err(err("BACKUP_INVALID", format!("缺少表 {table}")));
        }
    }
    Ok(())
}

fn checked_files(tx: &Transaction<'_>, v: &Value) -> Result<Vec<(String, i64)>> {
    let ids = string_list(v, "ids");
    if ids.is_empty() || ids.len() > 1000 {
        return Err(err("INVALID_INPUT", "请选择 1～1000 个文件"));
    }
    let mut result = vec![];
    let mut seen = HashSet::new();
    for fid in ids {
        if !seen.insert(fid.clone()) {
            continue;
        }
        let expected = v["versions"][&fid]
            .as_i64()
            .ok_or_else(|| err("INVALID_INPUT", "缺少文件版本"))?;
        let actual: Option<i64> = tx
            .query_row(
                "SELECT version FROM files WHERE id=? AND removed_at IS NULL",
                [&fid],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql_err)?;
        if actual != Some(expected) {
            return Err(err("VERSION_CONFLICT", "文件记录已变化，请刷新后重试"));
        }
        result.push((fid, expected));
    }
    Ok(result)
}

impl Store {
    pub fn mutate(&mut self, action: &str, v: &Value) -> Result<Value> {
        let floating_pins = if action == "files.tags" && !string_list(v, "add").is_empty() {
            Some(string_list(&self.floating_presets()?, "ids"))
        } else {
            None
        };

        let mut undo = Undo {
            label: String::new(),
            steps: vec![],
            guards: vec![],
        };
        let tx = self.conn.transaction().map_err(sql_err)?;
        match action {
            "files.tags" => {
                let files = checked_files(&tx, v)?;
                let add = string_list(v, "add");
                let remove = string_list(v, "remove");
                if add.iter().any(|t| remove.contains(t)) {
                    return Err(err("INVALID_INPUT", "同一标签不能同时添加和移除"));
                }
                for tid in add.iter().chain(remove.iter()) {
                    let exists: i64 = tx
                        .query_row("SELECT COUNT(*) FROM tags WHERE id=?", [tid], |r| r.get(0))
                        .map_err(sql_err)?;
                    if exists != 1 {
                        return Err(err("TAG_NOT_FOUND", "标签已删除，请刷新"));
                    }
                }
                for (fid, version) in files {
                    let mut changed = false;
                    for tid in &add {
                        let n = tx
                            .execute(
                                "INSERT OR IGNORE INTO file_tags(file_id,tag_id) VALUES(?,?)",
                                params![fid, tid],
                            )
                            .map_err(sql_err)?;
                        if n > 0 {
                            changed = true;
                            undo.steps.push(step(
                                "DELETE FROM file_tags WHERE file_id=? AND tag_id=?",
                                vec![sv(fid.clone()), sv(tid.clone())],
                            ));
                        } else {
                            let old = crate::auto_tags::association_step(&tx, &fid, tid)?;
                            let confirmed=tx.execute("UPDATE file_tags SET ai_meta=json_set(ai_meta,'$.confirmed',json('true')) WHERE file_id=? AND tag_id=? AND source='ai' AND json_extract(ai_meta,'$.confirmed')=0",params![fid,tid]).map_err(sql_err)?;
                            if confirmed > 0 {
                                changed = true;
                                undo.steps.push(step(
                                    "DELETE FROM file_tags WHERE file_id=? AND tag_id=?",
                                    vec![sv(fid.clone()), sv(tid.clone())],
                                ));
                                if let Some(old) = old {
                                    undo.steps.push(old);
                                }
                            }
                        }
                    }
                    for tid in &remove {
                        let original = crate::auto_tags::association_step(&tx, &fid, tid)?;
                        let n = tx
                            .execute(
                                "DELETE FROM file_tags WHERE file_id=? AND tag_id=?",
                                params![fid, tid],
                            )
                            .map_err(sql_err)?;
                        if n > 0 {
                            changed = true;
                            if let Some(original) = original {
                                undo.steps.push(original);
                            }
                        }
                    }
                    if changed {
                        tx.execute("UPDATE files SET version=version+1 WHERE id=?", [&fid])
                            .map_err(sql_err)?;
                        undo.steps.push(step(
                            "UPDATE files SET version=version+1 WHERE id=?",
                            vec![sv(fid.clone())],
                        ));
                        undo.guards.push(Guard {
                            table: "files".into(),
                            id: fid,
                            version: version + 1,
                        });
                    }
                }
                for tid in &add {
                    tx.execute(
                        "UPDATE tags SET last_used=? WHERE id=?",
                        params![now(), tid],
                    )
                    .map_err(sql_err)?;
                }
                if let Some(mut pins) = floating_pins {
                    for tid in &add {
                        let origin: String = tx
                            .query_row("SELECT created_by FROM tags WHERE id=?", [tid], |r| {
                                r.get(0)
                            })
                            .map_err(sql_err)?;
                        if origin != "folder" && !pins.contains(tid) {
                            pins.push(tid.clone());
                        }
                    }
                    tx.execute("INSERT INTO settings(key,value) VALUES('floatingTags',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [json!(pins).to_string()]).map_err(sql_err)?;
                }
                undo.label = "修改文件标签".into();
                for (id, restore) in crate::auto_tags::cleanup_orphan_ai_tags(&tx)? {
                    // Restore the tag before its associations when main-window undo is used.
                    undo.steps.insert(0, restore);
                    undo.guards.push(Guard {
                        table: "tags".into(),
                        id,
                        version: -1,
                    });
                }
            }
            "files.favorite" | "files.remove" => {
                let files = checked_files(&tx, v)?;
                for (fid, version) in files {
                    if action == "files.favorite" {
                        let old: i64 = tx
                            .query_row("SELECT favorite FROM files WHERE id=?", [&fid], |r| {
                                r.get(0)
                            })
                            .map_err(sql_err)?;
                        let new = if v["value"].as_bool().unwrap_or(false) {
                            1
                        } else {
                            0
                        };
                        if old == new {
                            continue;
                        }
                        tx.execute(
                            "UPDATE files SET favorite=?,version=version+1 WHERE id=?",
                            params![new, fid],
                        )
                        .map_err(sql_err)?;
                        undo.steps.push(step(
                            "UPDATE files SET favorite=?,version=version+1 WHERE id=?",
                            vec![iv(old), sv(fid.clone())],
                        ));
                    } else {
                        tx.execute(
                            "UPDATE files SET removed_at=?,version=version+1 WHERE id=?",
                            params![now(), fid],
                        )
                        .map_err(sql_err)?;
                        undo.steps.push(step(
                            "UPDATE files SET removed_at=NULL,version=version+1 WHERE id=?",
                            vec![sv(fid.clone())],
                        ));
                    }
                    undo.guards.push(Guard {
                        table: "files".into(),
                        id: fid,
                        version: version + 1,
                    });
                }
                undo.label = if action == "files.favorite" {
                    "更改收藏"
                } else {
                    "从文件库移除"
                }
                .into();
            }
            "tags.rename" => {
                let tid = str_arg(v, "id")?;
                let name = validate_tag(str_arg(v, "name")?)?;
                let (old, version): (String, i64) = tx
                    .query_row("SELECT name,version FROM tags WHERE id=?", [tid], |r| {
                        Ok((r.get(0)?, r.get(1)?))
                    })
                    .map_err(sql_err)?;
                if v["version"].as_i64() != Some(version) {
                    return Err(err("VERSION_CONFLICT", "标签已变化"));
                }
                let exists: i64 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM tags WHERE name_key=? AND id<>?",
                        params![key(&name), tid],
                        |r| r.get(0),
                    )
                    .map_err(sql_err)?;
                if exists > 0 {
                    return Err(err("TAG_NAME_CONFLICT", "已存在同名标签"));
                }
                tx.execute(
                    "UPDATE tags SET name=?,name_key=?,version=version+1 WHERE id=?",
                    params![name, key(&name), tid],
                )
                .map_err(sql_err)?;
                undo.steps.push(step(
                    "UPDATE tags SET name=?,name_key=?,version=version+1 WHERE id=?",
                    vec![sv(old.clone()), sv(key(&old)), sv(tid)],
                ));
                undo.guards.push(Guard {
                    table: "tags".into(),
                    id: tid.into(),
                    version: version + 1,
                });
                undo.label = "重命名标签".into();
            }
            "tags.delete" => {
                let tid = str_arg(v, "id")?;
                let (name, version, used, created_by): (String, i64, i64, String) = tx
                    .query_row(
                        "SELECT name,version,last_used,created_by FROM tags WHERE id=?",
                        [tid],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    )
                    .map_err(sql_err)?;
                if v["version"].as_i64() != Some(version) {
                    return Err(err("VERSION_CONFLICT", "标签已变化"));
                }
                let mut st=tx.prepare("SELECT f.id,f.version FROM files f JOIN file_tags ft ON f.id=ft.file_id WHERE ft.tag_id=?").map_err(sql_err)?;
                let rows = st
                    .query_map([tid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
                    .map_err(sql_err)?;
                let files = rows
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(sql_err)?;
                drop(st);
                undo.steps.push(step(
                    "INSERT INTO tags(id,name,name_key,version,last_used,created_by) VALUES(?,?,?,?,?,?)",
                    vec![
                        sv(tid),
                        sv(name.clone()),
                        sv(key(&name)),
                        iv(version + 1),
                        iv(used),
                        sv(created_by),
                    ],
                ));
                for (fid, ver) in files {
                    tx.execute("UPDATE files SET version=version+1 WHERE id=?", [&fid])
                        .map_err(sql_err)?;
                    if let Some(original) = crate::auto_tags::association_step(&tx, &fid, tid)? {
                        undo.steps.push(original);
                    }
                    undo.steps.push(step(
                        "UPDATE files SET version=version+1 WHERE id=?",
                        vec![sv(fid.clone())],
                    ));
                    undo.guards.push(Guard {
                        table: "files".into(),
                        id: fid,
                        version: ver + 1,
                    });
                }
                tx.execute("DELETE FROM tags WHERE id=?", [tid])
                    .map_err(sql_err)?;
                undo.label = "删除标签".into();
                undo.guards.push(Guard {
                    table: "tags".into(),
                    id: tid.into(),
                    version: -1,
                });
            }
            _ => return Err(err("UNKNOWN_ACTION", action)),
        }
        tx.commit().map_err(sql_err)?;
        if !undo.steps.is_empty() {
            self.remember(undo);
        }
        Ok(json_ok())
    }
    pub fn undo_last(&mut self) -> Result<Value> {
        let entry = self
            .undo
            .last()
            .ok_or_else(|| err("NOTHING_TO_UNDO", "没有可撤销的操作"))?;
        let tx = self.conn.transaction().map_err(sql_err)?;
        for g in &entry.guards {
            let ver: Option<i64> = tx
                .query_row(
                    &format!("SELECT version FROM {} WHERE id=?", g.table),
                    [&g.id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(sql_err)?;
            if ver.unwrap_or(-1) != g.version {
                return Err(err("UNDO_CONFLICT", "后续变更使此操作无法安全撤销"));
            }
        }
        for s in &entry.steps {
            tx.execute(&s.sql, params_from_iter(s.args.iter()))
                .map_err(sql_err)?;
        }
        let mut versions: HashMap<(String, String), i64> = HashMap::new();
        // Only advance history guards for entities changed by this undo. Unrelated
        // edits must remain detectable by earlier history entries.
        for g in &entry.guards {
            let ver = tx
                .query_row(
                    &format!("SELECT version FROM {} WHERE id=?", g.table),
                    [&g.id],
                    |r| r.get::<_, i64>(0),
                )
                .optional()
                .map_err(sql_err)?
                .unwrap_or(-1);
            versions.insert((g.table.clone(), g.id.clone()), ver);
        }
        tx.commit().map_err(sql_err)?;
        self.undo.pop();
        for u in &mut self.undo {
            for g in &mut u.guards {
                if let Some(ver) = versions.get(&(g.table.clone(), g.id.clone())) {
                    g.version = *ver;
                }
            }
        }
        Ok(json_ok())
    }
}
