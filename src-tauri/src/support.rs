//! Local support data. Diagnostic reports use an explicit allowlist, never raw settings/errors.
use crate::{db::Store, model::*};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::{io::Write, path::Path};

impl Store {
    pub fn support_snapshot(&self) -> Result<Value> {
        let files: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM files WHERE removed_at IS NULL",
                [],
                |r| r.get(0),
            )
            .map_err(sql_err)?;
        let tags: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
            .map_err(sql_err)?;
        let unavailable: i64 = self.conn.query_row("SELECT COUNT(*) FROM files WHERE removed_at IS NULL AND status IN ('missing','offline','inaccessible')", [], |r| r.get(0)).map_err(sql_err)?;
        let schema: i64 = self
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(sql_err)?;
        let last: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key='lastBackup'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql_err)?;
        Ok(
            json!({"version":env!("CARGO_PKG_VERSION"),"schema":schema,"files":files,"tags":tags,"unavailable":unavailable,"ai":self.ai_summary()?,"lastBackup":last.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"notice":self.recovery_notice}),
        )
    }
    pub fn retry_failed_ai(&self) -> Result<Value> {
        if !self.ai_config()?.enabled {
            return Err(err("AI_NOT_ENABLED", "请先配置并启用 AI 自动标注"));
        }
        // Only failed tasks, never already completed, unsupported or user-cancelled work.
        let count = self.conn.execute("UPDATE ai_jobs SET status='queued',error='',updated_at=MAX(updated_at+1,?) WHERE status='failed' AND file_id IN (SELECT id FROM files WHERE removed_at IS NULL)", [now()]).map_err(sql_err)?;
        Ok(json!({"queued":count}))
    }
    pub fn remember_backup(&self, path: &Path, kind: &str) -> Result<()> {
        self.conn.execute("INSERT INTO settings(key,value) VALUES('lastBackup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [json!({"createdAt":now(),"path":path.to_string_lossy(),"kind":kind}).to_string()]).map_err(sql_err)?;
        Ok(())
    }
    pub fn remember_recovery(&self) -> Result<()> {
        self.conn.execute("INSERT INTO settings(key,value) VALUES('recoveryNotice',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [json!(self.recovery_notice).to_string()]).map_err(sql_err)?;
        Ok(())
    }
}

pub fn diagnostic_report(snapshot: &Value, transfer: &Value) -> String {
    let mut report = format!("# 拾签本地诊断\n\n版本：{}\n系统：{} {}\n资料库格式：{}\n文件记录：{}\n标签：{}\n不可用文件：{}\n恢复提示：{}\n\nAI 任务计数：\n", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH, snapshot["schema"], snapshot["files"], snapshot["tags"], snapshot["unavailable"], if snapshot["notice"].as_str().unwrap_or("").is_empty() {"无"} else {"有，请在本机查看"});
    for (key, label) in [
        ("queued", "等待"),
        ("running", "处理中"),
        ("done", "完成"),
        ("failed", "失败"),
        ("unsupported", "未支持"),
        ("cancelled", "取消"),
    ] {
        report.push_str(&format!(
            "- {label}：{}\n",
            snapshot["ai"][key].as_u64().unwrap_or(0)
        ));
    }
    report.push_str(&format!(
        "\n资料包任务：{}\n已处理字节：{}\n已处理文件：{}\n",
        if transfer["busy"].as_bool().unwrap_or(false) {
            "进行中"
        } else {
            "空闲"
        },
        transfer["bytes"].as_u64().unwrap_or(0),
        transfer["completed"].as_u64().unwrap_or(0)
    ));
    if let Some(history) = transfer["history"].as_array() {
        report.push_str("\n本次运行的资料包任务（最多 12 项）：\n");
        for task in history.iter().take(12) {
            // Names, paths, arbitrary errors, AI models/endpoints and results are deliberately omitted.
            let kind = match task["kind"].as_str().unwrap_or("") {
                "package.inspect" => "校验",
                "package.import" => "导入",
                "package.export" => "导出",
                "backup.restore" => "恢复",
                _ => "资料包",
            };
            let state = match task["state"].as_str().unwrap_or("") {
                "done" => "完成",
                "cancelled" => "取消",
                "failed" => "失败",
                _ => "进行中",
            };
            report.push_str(&format!("- {kind}：{state}\n"));
        }
    }
    report.push_str("\n此报告仅包含版本、计数和任务状态，不包含文件名、文件路径、正文、备注、标签名称、AI 服务地址或密钥。\n报告由用户在本机导出，不会自动上传。\n");
    report
}
pub fn export_report(path: &Path, text: &str) -> Result<Value> {
    if path.extension().and_then(|s| s.to_str()) != Some("md") {
        return Err(err("INVALID_INPUT", "诊断报告扩展名应为 .md"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_INPUT", "请选择保存位置"))?;
    let mut output =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| err("DIAGNOSTICS_FAILED", e))?;
    output
        .write_all(text.as_bytes())
        .map_err(|e| err("DIAGNOSTICS_FAILED", e))?;
    output
        .as_file()
        .sync_all()
        .map_err(|e| err("DIAGNOSTICS_FAILED", e))?;
    output
        .persist_noclobber(path)
        .map_err(|e| err("DIAGNOSTICS_FAILED", format!("{e}；请选择未使用的文件名")))?;
    Ok(json!({"path":path.to_string_lossy()}))
}
