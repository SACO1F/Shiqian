// Compile the production modules directly, without booting a Tauri WebView.
// This complements desktop integration testing; it does not replace it.
#![allow(dead_code)]
#[path = "../../src/ai.rs"]
mod ai;
#[path = "../../src/ai_worker.rs"]
mod ai_worker;
#[path = "../../src/annotation.rs"]
mod annotation;
#[cfg(test)]
#[path = "../../src/auto_tag_tests.rs"]
mod auto_tag_tests;
#[path = "../../src/auto_tags.rs"]
mod auto_tags;
#[path = "../../src/backup.rs"]
mod backup;
#[path = "../../src/db.rs"]
mod db;
#[path = "../../src/fsops.rs"]
mod fsops;
#[path = "../../src/model.rs"]
mod model;

#[path = "../../src/transfer.rs"]
mod transfer;
#[cfg(test)]
#[path = "../../src/transfer_tests.rs"]
mod transfer_tests;
