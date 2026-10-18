//! User Pine scripts live as plain `.pine` files in `<app data>/indicators` and `<app data>/strategies`.
use crate::model::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PineFile {
    pub name: String,
    pub code: String,
    pub modified: i64,
}

pub fn kind_dir(base: &Path, kind: &str) -> Result<PathBuf> {
    match kind {
        "indicators" | "strategies" => Ok(base.join(kind)),
        _ => Err(Error::Other(format!("unknown script kind '{kind}'"))),
    }
}

/// File-name safe version of a script name (no path separators, no leading dot).
pub fn sanitize(name: &str) -> Result<String> {
    let cleaned: String = name
        .trim()
        .trim_end_matches(".pine")
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | ' ' | '.' | '(' | ')') { c } else { '-' })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim().to_string();
    if cleaned.is_empty() { return Err(Error::Other("script name is empty".into())); }
    Ok(cleaned.chars().take(80).collect())
}

pub fn list(dir: &Path) -> Result<Vec<PineFile>> {
    std::fs::create_dir_all(dir).map_err(|e| Error::Other(e.to_string()))?;
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).map_err(|e| Error::Other(e.to_string()))? {
        let p = e.map_err(|e| Error::Other(e.to_string()))?.path();
        if p.extension().and_then(|s| s.to_str()) != Some("pine") { continue; }
        let Some(name) = p.file_stem().and_then(|s| s.to_str()) else { continue };
        let code = std::fs::read_to_string(&p).map_err(|e| Error::Other(e.to_string()))?;
        let modified = std::fs::metadata(&p).and_then(|m| m.modified()).ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
        out.push(PineFile { name: name.to_string(), code, modified });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

pub fn save(dir: &Path, name: &str, code: &str) -> Result<String> {
    let name = sanitize(name)?;
    std::fs::create_dir_all(dir).map_err(|e| Error::Other(e.to_string()))?;
    std::fs::write(dir.join(format!("{name}.pine")), code).map_err(|e| Error::Other(e.to_string()))?;
    Ok(name)
}

pub fn delete(dir: &Path, name: &str) -> Result<()> {
    let p = dir.join(format!("{}.pine", sanitize(name)?));
    if p.exists() { std::fs::remove_file(p).map_err(|e| Error::Other(e.to_string()))?; }
    Ok(())
}

/// Write bundled scripts that were never seeded before and do not exist yet. Returns the new seeded-name list.
pub fn seed(dir: &Path, bundled: &[PineFile], already: &[String]) -> Result<Vec<String>> {
    std::fs::create_dir_all(dir).map_err(|e| Error::Other(e.to_string()))?;
    let mut seeded: Vec<String> = already.to_vec();
    for f in bundled {
        let name = sanitize(&f.name)?;
        if seeded.contains(&name) { continue; }
        let path = dir.join(format!("{name}.pine"));
        if !path.exists() { std::fs::write(&path, &f.code).map_err(|e| Error::Other(e.to_string()))?; }
        seeded.push(name);
    }
    Ok(seeded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("oviate-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize("My Script.pine").unwrap(), "My Script");
        let t = sanitize("../../etc/passwd").unwrap();
        assert!(!t.contains('/') && !t.contains('\\') && !t.starts_with('.'), "{t}");
        assert_eq!(sanitize("a/b\\c").unwrap(), "a-b-c");
        assert!(sanitize("  ").is_err());
        assert!(sanitize(".hidden").unwrap() == "hidden");
    }

    #[test]
    fn saves_lists_and_deletes() {
        let d = tmp("save");
        assert_eq!(save(&d, "rsi two", "//@version=5\nindicator(\"x\")").unwrap(), "rsi two");
        save(&d, "Alpha", "a").unwrap();
        let l = list(&d).unwrap();
        assert_eq!(l.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["Alpha", "rsi two"]);
        delete(&d, "Alpha").unwrap();
        assert_eq!(list(&d).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn seeds_once_and_respects_deletions_and_user_files() {
        let d = tmp("seed");
        let b = vec![PineFile { name: "sma".into(), code: "A".into(), modified: 0 }, PineFile { name: "ema".into(), code: "B".into(), modified: 0 }];
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("ema.pine"), "USER").unwrap();
        let seeded = seed(&d, &b, &[]).unwrap();
        assert_eq!(seeded, vec!["sma", "ema"]);
        assert_eq!(std::fs::read_to_string(d.join("ema.pine")).unwrap(), "USER");
        delete(&d, "sma").unwrap();
        let again = seed(&d, &b, &seeded).unwrap();
        assert_eq!(again, seeded);
        assert!(!d.join("sma.pine").exists(), "deleted bundled script must not come back");
        let _ = std::fs::remove_dir_all(&d);
    }
}
