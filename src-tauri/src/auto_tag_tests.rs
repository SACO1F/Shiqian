use crate::{ai, db::Store, fsops, model::*};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
};

struct Fixture {
    store: Store,
    dir: tempfile::TempDir,
    files: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let files = dir.path().join("原文件");
        fs::create_dir_all(&files).unwrap();
        let store = Store::open(&dir.path().join("library")).unwrap();
        Self { store, dir, files }
    }
    fn add(&mut self, name: &str, kind: &str, bytes: &[u8]) -> FileRecord {
        let path = self.files.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        // Test the import persistence boundary with inspected file metadata.
        // OS path canonicalization and the Tauri bridge require the desktop suite.
        let file = fs::File::open(&path).unwrap();
        let meta = file.metadata().unwrap();
        let m = fsops::FileMeta {
            path: path.to_string_lossy().into(),
            parent: path.parent().unwrap().to_string_lossy().into(),
            name: path.file_name().unwrap().to_string_lossy().into(),
            extension: path.extension().unwrap().to_string_lossy().into(),
            kind: kind.into(),
            bytes: meta.len() as i64,
            modified: 0,
            revision: fsops::revision(&meta),
            identity: fsops::identity(&file),
        };
        assert!(self.store.add_file(&m).unwrap());
        let fid: String = self
            .store
            .conn
            .query_row("SELECT id FROM files WHERE path_key=?", [&m.path], |r| {
                r.get(0)
            })
            .unwrap();
        self.store.file(&fid).unwrap()
    }
    fn start(&mut self, fid: &str) -> (FileRecord, i64) {
        self.store.queue_ai(&[fid.to_string()]).unwrap();
        let token = self.store.ai_task(fid).unwrap().unwrap().updated_at;
        self.store.task_status(fid, token, "running", "").unwrap();
        (self.store.file(fid).unwrap(), token)
    }
    fn apply(&mut self, fid: &str, names: &[&str]) {
        let (file, token) = self.start(fid);
        let choices: Vec<_> = names
            .iter()
            .map(|s| (None, s.to_string(), "内容依据".into()))
            .collect();
        self.store
            .apply_ai_checked(&file, token, "test-vision", &choices)
            .unwrap();
    }
    fn patch(&mut self, fid: &str, add: Vec<String>, remove: Vec<String>) {
        let file = self.store.file(fid).unwrap();
        self.store
            .mutate(
                "files.tags",
                &json!({"ids":[fid],"versions":{fid:file.version},"add":add,"remove":remove}),
            )
            .unwrap();
    }
}
fn response(tags: Value) -> Value {
    json!({"choices":[{"finish_reason":"stop","message":{"content":json!({"tags":tags}).to_string()}}]})
}

fn backup_fixture(f: &Fixture, legacy: bool) -> PathBuf {
    use sha2::{Digest, Sha256};
    let db = f.dir.path().join("backup-fixture.sqlite");
    let mut target = rusqlite::Connection::open(&db).unwrap();
    rusqlite::backup::Backup::new(&f.store.conn, &mut target)
        .unwrap()
        .run_to_completion(64, std::time::Duration::from_millis(1), None)
        .unwrap();
    if legacy {
        target.execute_batch("DROP TABLE ai_jobs; ALTER TABLE tags DROP COLUMN created_by; ALTER TABLE file_tags DROP COLUMN source; ALTER TABLE file_tags DROP COLUMN ai_meta; DELETE FROM schema_migrations WHERE version=2; PRAGMA user_version=1;").unwrap();
    }
    let library_id: String = target
        .query_row("SELECT value FROM library_meta WHERE key='id'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let file_count: i64 = target
        .query_row(
            "SELECT COUNT(*) FROM files WHERE removed_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let tag_count: i64 = target
        .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
        .unwrap();
    drop(target);
    let bytes = fs::read(db).unwrap();
    let manifest=format!("backup_format = 1\nschema_version = {}\napp_version = '0.2.2'\ncreated_at = 1\nlibrary_id = '{library_id}'\nfile_count = {file_count}\ntag_count = {tag_count}\n",if legacy {1}else{2});
    let path = f.dir.path().join("fixture.sqtagbackup");
    let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    for (name, data) in [
        ("manifest.toml", manifest.into_bytes()),
        (
            "checksums.sha256",
            format!("{:x}  metadata.sqlite", Sha256::digest(&bytes)).into_bytes(),
        ),
        ("metadata.sqlite", bytes),
    ] {
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&data).unwrap();
    }
    zip.finish().unwrap();
    path
}
#[test]
fn legacy_backup_restores_and_migrates_all_manual_annotations() {
    let mut f = Fixture::new();
    f.store
        .save_settings(&json!({"key":"folderAutoTagging","value":false}))
        .unwrap();
    let file = f.add("old.txt", "text", b"old");
    let tag = f.store.create_tag("历史标签").unwrap();
    f.patch(&file.id, vec![tag.id], vec![]);
    let backup = backup_fixture(&f, true);
    f.store.restore_backup(&backup).unwrap();
    f.store.validate().unwrap();
    let restored = f.store.file(&file.id).unwrap();
    assert_eq!(restored.tags[0].name, "历史标签");
    assert_eq!(restored.tags[0].source, "manual");
    assert!(!f.store.ai_config().unwrap().enabled);
}
#[test]
fn externally_written_backup_cannot_enable_ai_or_resume_uploads() {
    let mut f = Fixture::new();
    let file = f.add("a.txt", "text", b"a");
    f.store.save_ai_settings(&json!({"config":{"enabled":true,"endpoint":"https://example.com/v1","model":"vision","allowNewTags":true}})).unwrap();
    f.store.queue_ai(&[file.id.clone()]).unwrap();
    let backup = backup_fixture(&f, false);
    f.store.restore_backup(&backup).unwrap();
    assert!(!f.store.ai_config().unwrap().enabled);
    assert!(f.store.ai_config().unwrap().endpoint.is_empty());
    assert_eq!(
        f.store.ai_task(&file.id).unwrap().unwrap().status,
        "cancelled"
    );
}

fn simple_pdf(text: Option<&str>) -> Vec<u8> {
    let content = text
        .map(|t| format!("BT /F1 12 Tf 50 150 Td ({t}) Tj ET"))
        .unwrap_or_default();
    let objects=[
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".into(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
        format!("<< /Length {} >>\nstream\n{content}\nendstream",content.len()),
    ];
    let mut out = String::from("%PDF-1.4\n");
    let mut offsets = vec![0];
    for (i, obj) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.push_str(&format!("{} 0 obj\n{obj}\nendobj\n", i + 1));
    }
    let xref = out.len();
    out.push_str("xref\n0 6\n0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        out.push_str(&format!("{offset:010} 00000 n \n"));
    }
    out.push_str(&format!(
        "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    ));
    out.into_bytes()
}

#[test]
fn pdf_extracts_real_text_and_rejects_pages_without_text() {
    let mut f = Fixture::new();
    let file = f.add("brief.pdf", "pdf", &simple_pdf(Some("Brand design brief")));
    assert!(ai::content(&f.store.root, &file).unwrap()["text"]
        .as_str()
        .unwrap()
        .contains("Brand design brief"));
    let blank = f.add("blank.pdf", "pdf", &simple_pdf(None));
    assert!(ai::content(&f.store.root, &blank)
        .unwrap_err()
        .starts_with("AI_UNSUPPORTED"));
}
#[test]
fn spreadsheets_and_slides_extract_content_and_legacy_office_is_unsupported() {
    let mut f = Fixture::new();
    for (name, entry, xml, expected) in [
        (
            "budget.xlsx",
            "xl/sharedStrings.xml",
            "<sst><si><t>Marketing budget</t></si></sst>",
            "Marketing budget",
        ),
        (
            "pitch.pptx",
            "ppt/slides/slide1.xml",
            "<p:sld xmlns:p='p' xmlns:a='a'><a:t>Project launch</a:t></p:sld>",
            "Project launch",
        ),
    ] {
        let mut bytes = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut bytes);
            zip.start_file(entry, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(xml.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        let file = f.add(name, "office", &bytes.into_inner());
        assert!(ai::content(&f.store.root, &file).unwrap()["text"]
            .as_str()
            .unwrap()
            .contains(expected));
    }
    let old = f.add("old.doc", "office", b"old binary office");
    assert!(ai::content(&f.store.root, &old)
        .unwrap_err()
        .starts_with("AI_UNSUPPORTED"));
}
#[test]
fn interrupted_jobs_resume_after_reopening_the_library() {
    let mut f = Fixture::new();
    let file = f.add("a.txt", "text", b"a");
    f.start(&file.id);
    let root = f.store.root.clone();
    drop(f.store);
    let store = Store::open(&root).unwrap();
    assert_eq!(store.ai_task(&file.id).unwrap().unwrap().status, "queued");
}
#[cfg(windows)]
#[test]
fn credentials_are_encrypted_and_a_service_switch_does_not_reuse_them() {
    let mut f = Fixture::new();
    let mut config = json!({"enabled":false,"endpoint":"https://example.com/v1","model":"vision","allowNewTags":true});
    let saved = f
        .store
        .save_ai_settings(&json!({"config":config,"apiKey":"synthetic-test-key"}))
        .unwrap();
    assert_eq!(saved["hasKey"], true);
    assert!(!saved.to_string().contains("synthetic-test-key"));
    assert_eq!(ai::read_key(&f.store.root).unwrap(), "synthetic-test-key");
    let bytes = fs::read(f.store.root.join("ai-key.dpapi")).unwrap();
    assert!(!bytes.windows(18).any(|w| w == b"synthetic-test-key"));
    config["endpoint"] = json!("https://second.example.com/v1");
    f.store.save_ai_settings(&json!({"config":config})).unwrap();
    assert!(ai::read_key(&f.store.root).unwrap().is_empty());
}

#[test]
fn folder_defaults_to_direct_parent_and_reuses_existing_pool() {
    let mut f = Fixture::new();
    let tag = f.store.create_tag("海报").unwrap();
    let file = f.add("素材/海报/封面.txt", "text", b"poster");
    assert_eq!(file.tags.len(), 1);
    assert_eq!(file.tags[0].id, tag.id);
    assert_eq!(file.tags[0].source, "folder");
    assert_eq!(file.tags[0].created_by, "manual");
    assert!(file.ai_task.is_none());
    let next = f.add("素材/海报/第二份.txt", "text", b"poster");
    assert_eq!(next.tags[0].id, tag.id);
    assert_eq!(f.store.tags().unwrap().len(), 1);
}
#[test]
fn folder_can_be_disabled_and_backfilled_without_replacing_manual_tags() {
    let mut f = Fixture::new();
    f.store
        .save_settings(&json!({"key":"folderAutoTagging","value":false}))
        .unwrap();
    let file = f.add("项目/需求.txt", "text", b"brief");
    assert!(file.tags.is_empty());
    let manual = f.store.create_tag("重点").unwrap();
    f.patch(&file.id, vec![manual.id.clone()], vec![]);
    f.store
        .save_settings(&json!({"key":"folderAutoTagging","value":true}))
        .unwrap();
    assert_eq!(f.store.fill_folder_tags().unwrap()["changed"], 1);
    assert_eq!(f.store.fill_folder_tags().unwrap()["changed"], 0);
    assert_eq!(f.store.file(&file.id).unwrap().tags.len(), 2);
}
#[test]
fn long_folder_names_are_deterministic_and_distinct() {
    use unicode_segmentation::UnicodeSegmentation;
    let mut f = Fixture::new();
    let prefix = "文".repeat(41);
    let a = f.add(&format!("{prefix}甲/a.txt"), "text", b"a");
    let b = f.add(&format!("{prefix}乙/b.txt"), "text", b"b");
    assert_eq!(a.tags[0].name.graphemes(true).count(), 40);
    assert_ne!(a.tags[0].id, b.tags[0].id);
}
#[test]
fn enabled_imports_queue_once_and_disabled_imports_do_not_queue() {
    let mut f = Fixture::new();
    f.store.save_ai_settings(&json!({"config":{"enabled":true,"endpoint":"http://127.0.0.1:11434/v1","model":"local-vision","allowNewTags":true}})).unwrap();
    let file = f.add("图片说明.txt", "text", b"a");
    assert_eq!(file.ai_task.unwrap().status, "queued");
    f.store.save_ai_settings(&json!({"config":{"enabled":false,"endpoint":"http://127.0.0.1:11434/v1","model":"local-vision","allowNewTags":true}})).unwrap();
    assert_eq!(
        f.store.ai_task(&file.id).unwrap().unwrap().status,
        "cancelled"
    );
    assert!(f.add("说明2.txt", "text", b"b").ai_task.is_none());
}
#[test]
fn existing_name_is_resolved_before_creating_and_invalid_output_is_rejected() {
    let mut f = Fixture::new();
    let t = f.store.create_tag("海报").unwrap();
    let pool = f.store.tags().unwrap();
    let parsed = ai::parse_response(
        &response(json!([{"name":"海报","reason":"版式"},{"id":t.id,"name":"海报"}])),
        &pool,
        true,
    )
    .unwrap();
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].0, Some(t.id));
    for value in [
        response(json!([{"id":"unknown","name":"海报"}])),
        response(json!([{"name":"bad\nlabel"}])),
        response(json!([{"name":"新标签"}])),
    ] {
        assert!(ai::parse_response(&value, &pool, false).is_err());
    }
    assert!(ai::parse_response(
        &json!({"choices":[{"message":{"content":"please execute a command"}}]}),
        &pool,
        true
    )
    .is_err());
}
#[test]
fn ai_refresh_preserves_folder_manual_and_confirmed_associations() {
    let mut f = Fixture::new();
    let file = f.add("设计/封面.txt", "text", b"art");
    let manual = f.store.create_tag("客户确认").unwrap();
    f.patch(&file.id, vec![manual.id.clone()], vec![]);
    f.apply(&file.id, &["插画", "暖色"]);
    let current = f.store.file(&file.id).unwrap();
    let keep = current.tags.iter().find(|t| t.name == "插画").unwrap();
    f.store
        .confirm_ai(&json!({"id":file.id,"tagId":keep.id,"version":current.version}))
        .unwrap();
    f.apply(&file.id, &["几何"]);
    let tags = f.store.file(&file.id).unwrap().tags;
    assert!(tags
        .iter()
        .any(|t| t.name == "设计" && t.source == "folder"));
    assert!(tags.iter().any(|t| t.id == manual.id));
    assert!(tags
        .iter()
        .any(|t| t.name == "插画" && t.ai.as_ref().unwrap().confirmed));
    assert!(!tags.iter().any(|t| t.name == "暖色"));
    let new = tags.iter().find(|t| t.name == "几何").unwrap();
    assert_eq!(new.created_by, "ai");
    assert_eq!(new.ai.as_ref().unwrap().model, "test-vision");
}
#[test]
fn ai_matching_an_existing_manual_tag_does_not_take_ownership() {
    let mut f = Fixture::new();
    let file = f.add("a.txt", "text", b"a");
    let tag = f.store.create_tag("参考").unwrap();
    f.patch(&file.id, vec![tag.id.clone()], vec![]);
    f.apply(&file.id, &["参考"]);
    let current = f.store.file(&file.id).unwrap();
    assert_eq!(
        current.tags.iter().find(|t| t.id == tag.id).unwrap().source,
        "manual"
    );
}
#[test]
fn manual_add_confirms_ai_and_undo_restores_provenance() {
    let mut f = Fixture::new();
    let file = f.add("a.txt", "text", b"a");
    f.apply(&file.id, &["插画"]);
    let before = f
        .store
        .file(&file.id)
        .unwrap()
        .tags
        .into_iter()
        .find(|t| t.name == "插画")
        .unwrap();
    f.patch(&file.id, vec![before.id.clone()], vec![]);
    assert!(
        f.store
            .file(&file.id)
            .unwrap()
            .tags
            .iter()
            .find(|t| t.id == before.id)
            .unwrap()
            .ai
            .as_ref()
            .unwrap()
            .confirmed
    );
    f.store.undo_last().unwrap();
    let after = f
        .store
        .file(&file.id)
        .unwrap()
        .tags
        .into_iter()
        .find(|t| t.id == before.id)
        .unwrap();
    assert_eq!(json!(before.ai), json!(after.ai));
}
#[test]
fn removing_and_deleting_tags_can_undo_full_ai_metadata() {
    let mut f = Fixture::new();
    let file = f.add("a.txt", "text", b"a");
    f.apply(&file.id, &["插画"]);
    let before = f
        .store
        .file(&file.id)
        .unwrap()
        .tags
        .into_iter()
        .find(|t| t.name == "插画")
        .unwrap();
    f.patch(&file.id, vec![], vec![before.id.clone()]);
    f.store.undo_last().unwrap();
    assert_eq!(
        json!(
            f.store
                .file(&file.id)
                .unwrap()
                .tags
                .iter()
                .find(|t| t.id == before.id)
                .unwrap()
                .ai
        ),
        json!(before.ai)
    );
    f.store
        .mutate(
            "tags.delete",
            &json!({"id":before.id,"version":before.version}),
        )
        .unwrap();
    f.store.undo_last().unwrap();
    let after = f
        .store
        .file(&file.id)
        .unwrap()
        .tags
        .into_iter()
        .find(|t| t.id == before.id)
        .unwrap();
    assert_eq!(after.created_by, "ai");
    assert_eq!(json!(after.ai), json!(before.ai));
}
#[test]
fn stale_file_or_job_result_never_overwrites_newer_annotations() {
    let mut f = Fixture::new();
    let file = f.add("a.txt", "text", b"a");
    let (snapshot, token) = f.start(&file.id);
    let manual = f.store.create_tag("保留").unwrap();
    f.patch(&file.id, vec![manual.id], vec![]);
    let choices = vec![(None, "不应创建".into(), "reason".into())];
    assert!(f
        .store
        .apply_ai_checked(&snapshot, token, "model", &choices)
        .is_err());
    let (snapshot, token) = f.start(&file.id);
    f.store.queue_ai(&[file.id.clone()]).unwrap();
    assert!(f
        .store
        .apply_ai_checked(&snapshot, token, "model", &choices)
        .is_err());
    assert!(!f.store.tags().unwrap().iter().any(|t| t.name == "不应创建"));
}
#[test]
fn invalid_ai_batch_is_atomic_and_retains_old_unconfirmed_results() {
    let mut f = Fixture::new();
    let file = f.add("a.txt", "text", b"a");
    f.apply(&file.id, &["原AI标签"]);
    let before = f.store.file(&file.id).unwrap();
    let (snapshot, token) = f.start(&file.id);
    assert!(f
        .store
        .apply_ai_checked(
            &snapshot,
            token,
            "model",
            &[
                (None, "有效".into(), "".into()),
                (None, "\n".into(), "".into())
            ]
        )
        .is_err());
    assert_eq!(
        json!(f.store.file(&file.id).unwrap().tags),
        json!(before.tags)
    );
}
#[test]
fn backup_preserves_sources_but_never_enables_remote_analysis() {
    let mut f = Fixture::new();
    let file = f.add("a.txt", "text", b"a");
    f.apply(&file.id, &["插画"]);
    let cfg = json!({"enabled":true,"endpoint":"http://127.0.0.1:11434/v1","model":"local-vision","allowNewTags":true});
    f.store.save_ai_settings(&json!({"config":cfg})).unwrap();
    f.store.queue_ai(&[file.id.clone()]).unwrap();
    let path = f.dir.path().join("library.sqtagbackup");
    f.store.export_backup(&path).unwrap();
    f.store.restore_backup(&path).unwrap();
    assert!(!f.store.ai_config().unwrap().enabled);
    assert_eq!(
        f.store.ai_task(&file.id).unwrap().unwrap().status,
        "cancelled"
    );
    assert!(f
        .store
        .file(&file.id)
        .unwrap()
        .tags
        .iter()
        .any(|t| t.source == "ai"));
}
#[test]
fn schema_one_migrates_with_recovery_copy_and_manual_origins() {
    let mut f = Fixture::new();
    f.store
        .save_settings(&json!({"key":"folderAutoTagging","value":false}))
        .unwrap();
    let file = f.add("a.txt", "text", b"a");
    let tag = f.store.create_tag("旧标签").unwrap();
    f.patch(&file.id, vec![tag.id.clone()], vec![]);
    f.store.conn.execute_batch("DROP TABLE ai_jobs; ALTER TABLE tags DROP COLUMN created_by; ALTER TABLE file_tags DROP COLUMN source; ALTER TABLE file_tags DROP COLUMN ai_meta; DELETE FROM schema_migrations WHERE version=2; PRAGMA user_version=1;").unwrap();
    let root = f.store.root.clone();
    drop(f.store);
    let store = Store::open(&root).unwrap();
    assert_eq!(store.file(&file.id).unwrap().tags[0].source, "manual");
    assert!(root
        .join("backups/before-auto-tags-schema-v1.sqlite")
        .exists());
    store.validate().unwrap();
}
#[test]
fn config_rejects_secret_urls_and_remote_plaintext() {
    for endpoint in [
        "http://example.com/v1",
        "https://user:key@example.com/v1",
        "https://example.com/v1?key=secret",
        "file:///C:/secret",
    ] {
        let mut config = ai::Config {
            enabled: true,
            endpoint: endpoint.into(),
            model: "vision".into(),
            allow_new_tags: true,
        };
        assert!(config.validate().is_err());
    }
    let mut config = ai::Config {
        enabled: true,
        endpoint: "http://localhost:11434/v1/".into(),
        model: "vision".into(),
        allow_new_tags: true,
    };
    config.validate().unwrap();
    assert!(!config.endpoint.ends_with('/'));
}
#[test]
fn real_text_and_office_contents_are_extracted_and_limited() {
    let mut f = Fixture::new();
    let file = f.add("brief.txt", "text", "需求内容".repeat(5000).as_bytes());
    let part = ai::content(&f.store.root, &file).unwrap();
    assert!(part["text"].as_str().unwrap().contains("需求内容"));
    assert!(part["text"].as_str().unwrap().chars().count() < 12100);
    let mut bytes = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut bytes);
        zip.start_file(
            "word/document.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(
            b"<w:document xmlns:w='x'><w:p><w:t>Brand &amp; Design</w:t></w:p></w:document>",
        )
        .unwrap();
        zip.finish().unwrap();
    }
    let office = f.add("brief.docx", "office", &bytes.into_inner());
    let part = ai::content(&f.store.root, &office).unwrap();
    assert!(part["text"].as_str().unwrap().contains("Brand"));
    assert!(part["text"].as_str().unwrap().contains("Design"));
}
#[test]
fn image_payload_contains_pixels_and_requests_do_not_include_local_paths() {
    let mut f = Fixture::new();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(100, 80)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let file = f.add("private/photo.png", "image", &bytes.into_inner());
    let content = ai::content(&f.store.root, &file).unwrap();
    assert!(content["image_url"]["url"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    let config = ai::Config::default();
    let body = ai::request_body(&config, &file, &f.store.tags().unwrap(), content)
        .unwrap()
        .to_string();
    assert!(!body.contains(&file.path));
    assert!(!body.contains("apiKey"));
    assert!(body.contains("photo.png"));
}
#[test]
fn compatible_http_transport_and_response_parsing_use_a_real_local_server() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut all = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            let n = stream.read(&mut buffer).unwrap();
            all.extend_from_slice(&buffer[..n]);
            if let Some(end) = all.windows(4).position(|w| w == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&all[..end]).to_lowercase();
                let len: usize = header
                    .lines()
                    .find_map(|s| {
                        s.strip_prefix("content-length:")
                            .map(|s| s.trim().parse().unwrap())
                    })
                    .unwrap();
                if all.len() >= end + 4 + len {
                    break;
                }
            }
        }
        let text = String::from_utf8(all).unwrap();
        assert!(text.starts_with("POST /v1/chat/completions"));
        assert!(text.contains("Bearer test-only-key"));
        let body = response(json!([{"name":"几何","reason":"圆形图案"}])).to_string();
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let config = ai::Config {
        enabled: true,
        endpoint,
        model: "test-model".into(),
        allow_new_tags: true,
    };
    let value = ai::send(
        &config,
        "test-only-key",
        &json!({"model":"test-model","messages":[]}),
    )
    .unwrap();
    assert_eq!(ai::parse_response(&value, &[], true).unwrap()[0].1, "几何");
    server.join().unwrap();
}
