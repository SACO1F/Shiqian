use crate::{
    db::Store,
    fsops,
    model::*,
    support,
    transfer::{self, Control},
};
use serde_json::json;
use std::{
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

#[test]
fn staged_transfer_keeps_queries_and_note_edits_responsive_and_rolls_back_cancel() {
    let root = tempfile::tempdir().unwrap();
    let files = root.path().join("files");
    fs::create_dir(&files).unwrap();
    let original = files.join("large.txt");
    fs::write(&original, vec![b'x'; 1024 * 1024]).unwrap();
    let mut sender = Store::open(&root.path().join("sender")).unwrap();
    sender
        .add_file_with_ai(&fsops::inspect(&original).unwrap(), false)
        .unwrap();
    let plan = sender.transfer_plan(&json!({})).unwrap();
    let fingerprint = plan.info["fingerprint"].as_str().unwrap().to_string();
    let archive = files.join("pack.sqtagpack");
    transfer::export(plan, &archive, &fingerprint, &Control::default()).unwrap();
    let fingerprint = transfer::preview(&archive, &Control::default()).unwrap()["fingerprint"]
        .as_str()
        .unwrap()
        .to_string();
    let mut receiver = Store::open(&root.path().join("receiver")).unwrap();
    let existing = files.join("existing.txt");
    fs::write(&existing, b"existing").unwrap();
    receiver
        .add_file_with_ai(&fsops::inspect(&existing).unwrap(), false)
        .unwrap();
    let fid = receiver.query(&Query::default()).unwrap()["files"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let store = Arc::new(Mutex::new(receiver));
    let control = Arc::new(Control::default());
    let (paused_tx, paused_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let once = AtomicBool::new(false);
    let weak = Arc::downgrade(&control);
    control.set_chunk_hook(move || {
        if weak.upgrade().unwrap().status()["phase"] == "复制文件"
            && !once.swap(true, Ordering::SeqCst)
        {
            paused_tx.send(()).unwrap();
            resume_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        }
    });
    let worker_store = store.clone();
    let worker_control = control.clone();
    let destination = files.clone();
    let worker = std::thread::spawn(move || {
        worker_control.run_named("package.import", || {
            transfer::import_shared(
                &worker_store,
                &archive,
                &destination,
                &fingerprint,
                &worker_control,
            )
        })
    });
    paused_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    {
        let mut library = store
            .try_lock()
            .expect("staging must not hold the Store lock");
        assert_eq!(library.query(&Query::default()).unwrap()["total"], 1);
        let record = library.file(&fid).unwrap();
        library
            .save_note(
                &json!({"id":fid,"text":"edited during transfer","version":record.note_version}),
            )
            .unwrap();
    }
    control.cancel.store(true, Ordering::SeqCst);
    resume_tx.send(()).unwrap();
    assert!(worker
        .join()
        .unwrap()
        .unwrap_err()
        .starts_with("TRANSFER_CANCELLED:"));
    let library = store.lock().unwrap();
    assert_eq!(library.file(&fid).unwrap().note, "edited during transfer");
    assert_eq!(library.query(&Query::default()).unwrap()["total"], 1);
    assert!(!library.root.join("transfer-state.json").exists());
    assert_eq!(fs::read_dir(&files).unwrap().count(), 3);
    assert_eq!(control.status()["history"][0]["state"], "cancelled");
}

#[test]
fn transfer_task_history_is_bounded_and_failure_and_cancel_are_distinct() {
    let control = Control::default();
    for _ in 0..14 {
        control
            .run_named("package.inspect", || Ok(json!({"fileCount":1})))
            .unwrap();
    }
    control
        .run_named::<serde_json::Value>("package.import", || {
            Err(err("TRANSFER_CANCELLED", "cancelled"))
        })
        .unwrap_err();
    control
        .run_named::<serde_json::Value>("package.import", || {
            Err(err("CHECKSUM_MISMATCH", "private filename"))
        })
        .unwrap_err();
    let status = control.status();
    assert_eq!(status["busy"], false);
    assert_eq!(status["history"].as_array().unwrap().len(), 12);
    assert_eq!(status["history"][0]["state"], "failed");
    assert_eq!(status["history"][1]["state"], "cancelled");
}

#[test]
fn diagnostic_allowlist_omits_all_private_text_and_export_does_not_overwrite() {
    let snapshot = json!({"schema":2,"files":3,"tags":4,"unavailable":1,"notice":"PRIVATE_PATH","lastBackup":{"path":"PRIVATE_PATH"},"ai":{"failed":2},"settings":{"key":"SECRET","endpoint":"PRIVATE_ENDPOINT"},"note":"PRIVATE_NOTE","name":"PRIVATE_NAME"});
    let tasks = json!({"history":[{"kind":"package.import","state":"failed","error":"PRIVATE_ERROR","result":{"path":"PRIVATE_PATH"}}]});
    let report = support::diagnostic_report(&snapshot, &tasks);
    assert!(!report.contains("PRIVATE_"));
    assert!(!report.contains("SECRET"));
    assert!(report.contains("导入：失败"));
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("report.md");
    support::export_report(&path, &report).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), report);
    assert!(support::export_report(&path, "replacement").is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), report);
}

#[test]
fn recovery_notice_survives_restart_and_backup_status_is_local() {
    let root = tempfile::tempdir().unwrap();
    let library_path = root.path().join("library");
    let mut library = Store::open(&library_path).unwrap();
    library.recovery_notice = "synthetic interrupted task".into();
    library.remember_recovery().unwrap();
    let archive = root.path().join("backup.sqtagbackup");
    library.export_backup(&archive).unwrap();
    assert!(
        library.support_snapshot().unwrap()["lastBackup"]["createdAt"]
            .as_i64()
            .unwrap()
            > 0
    );
    drop(library);
    let mut library = Store::open(&library_path).unwrap();
    assert_eq!(library.recovery_notice, "synthetic interrupted task");
    library.restore_backup(&archive).unwrap();
    assert_eq!(
        library.support_snapshot().unwrap()["lastBackup"]["kind"],
        "beforeRestore"
    );
    assert_eq!(
        library
            .conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key='recoveryNotice'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn retry_only_failed_ai_preserves_completed_and_cancelled_tasks() {
    let root = tempfile::tempdir().unwrap();
    let mut library = Store::open(&root.path().join("library")).unwrap();
    library.conn.execute("INSERT INTO settings(key,value) VALUES('ai',?)", [json!({"enabled":true,"endpoint":"https://example.test/v1","model":"synthetic","allowNewTags":true}).to_string()]).unwrap();
    for (i, state) in [
        "failed",
        "done",
        "cancelled",
        "unsupported",
        "running",
        "queued",
    ]
    .iter()
    .enumerate()
    {
        let path = root.path().join(format!("{i}.txt"));
        fs::write(&path, b"synthetic").unwrap();
        library
            .add_file_with_ai(&fsops::inspect(&path).unwrap(), false)
            .unwrap();
        library.conn.execute("INSERT INTO ai_jobs(file_id,status,error,updated_at) SELECT id,?,'synthetic',1 FROM files WHERE name=?", rusqlite::params![state,format!("{i}.txt")]).unwrap();
    }
    assert_eq!(library.retry_failed_ai().unwrap()["queued"], 1);
    let summary = library.ai_summary().unwrap();
    assert_eq!(summary["failed"], 0);
    assert_eq!(summary["queued"], 2);
    assert_eq!(summary["done"], 1);
    assert_eq!(summary["cancelled"], 1);
}

#[test]
fn floating_position_is_local_validated_and_removed_from_transport_backup() {
    let root = tempfile::tempdir().unwrap();
    let mut store = Store::open(&root.path().join("library")).unwrap();
    store
        .save_settings(&json!({"key":"floatingPosition","value":{"x":-1200,"y":80}}))
        .unwrap();
    for value in [
        json!({"x":2147483648_i64,"y":0}),
        json!({"x":0.5,"y":0}),
        json!({"x":0}),
    ] {
        assert!(store
            .save_settings(&json!({"key":"floatingPosition","value":value}))
            .is_err());
    }
    drop(store);
    let store = Store::open(&root.path().join("library")).unwrap();
    assert_eq!(
        store.bootstrap().unwrap()["settings"]["floatingPosition"]["x"],
        -1200
    );
    let backup = root.path().join("position.sqtagbackup");
    store.export_backup(&backup).unwrap();
    let inspected = crate::backup::inspect_backup(&backup, &store.root).unwrap();
    let count: i64 = inspected
        .conn
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key='floatingPosition'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}
