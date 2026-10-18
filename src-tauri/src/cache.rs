use crate::model::{Candles, Result};
use crate::news::NewsItem;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

pub struct Cache {
    db: Mutex<Connection>,
}

impl Cache {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path)?;
        Self::init(db)
    }

    #[cfg(test)]
    pub fn memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(db: Connection) -> Result<Self> {
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS candles(
               symbol TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL,
               o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL,
               PRIMARY KEY(symbol, tf, t)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS coverage(
               symbol TEXT NOT NULL, tf TEXT NOT NULL, from_t INTEGER NOT NULL, to_t INTEGER NOT NULL,
               PRIMARY KEY(symbol, tf));
             CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS news(
               id TEXT PRIMARY KEY, provider TEXT NOT NULL, headline TEXT NOT NULL, source TEXT NOT NULL,
               summary TEXT NOT NULL, url TEXT NOT NULL, ts INTEGER NOT NULL);
             CREATE INDEX IF NOT EXISTS news_ts ON news(ts);
             CREATE TABLE IF NOT EXISTS news_symbols(id TEXT NOT NULL, symbol TEXT NOT NULL, PRIMARY KEY(id, symbol));
             CREATE INDEX IF NOT EXISTS news_symbols_sym ON news_symbols(symbol);
             CREATE TABLE IF NOT EXISTS news_windows(key TEXT NOT NULL, from_t INTEGER NOT NULL, to_t INTEGER NOT NULL, fetched_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS ai_summaries(k TEXT PRIMARY KEY, body TEXT NOT NULL, created INTEGER NOT NULL);",
        )?;
        Ok(Self { db: Mutex::new(db) })
    }

    pub fn coverage(&self, symbol: &str, tf: &str) -> Result<Option<(i64, i64)>> {
        let db = self.db.lock().unwrap();
        let mut st = db.prepare("SELECT from_t, to_t FROM coverage WHERE symbol=?1 AND tf=?2")?;
        let mut rows = st.query(params![symbol, tf])?;
        Ok(match rows.next()? {
            Some(r) => Some((r.get(0)?, r.get(1)?)),
            None => None,
        })
    }

    /// Insert candles and widen the covered range. Ranges are assumed contiguous (fetches always extend the edge).
    pub fn store(&self, symbol: &str, tf: &str, c: &Candles, from: i64, to: i64) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        {
            let mut st = tx.prepare_cached(
                "INSERT OR REPLACE INTO candles(symbol,tf,t,o,h,l,c,v) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            )?;
            for i in 0..c.len() {
                st.execute(params![symbol, tf, c.t[i], c.o[i], c.h[i], c.l[i], c.c[i], c.v[i]])?;
            }
        }
        tx.execute(
            "INSERT INTO coverage(symbol,tf,from_t,to_t) VALUES(?1,?2,?3,?4)
             ON CONFLICT(symbol,tf) DO UPDATE SET from_t=MIN(from_t,excluded.from_t), to_t=MAX(to_t,excluded.to_t)",
            params![symbol, tf, from, to],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn load(&self, symbol: &str, tf: &str, from: i64, to: i64) -> Result<Candles> {
        let db = self.db.lock().unwrap();
        let mut st = db.prepare_cached(
            "SELECT t,o,h,l,c,v FROM candles WHERE symbol=?1 AND tf=?2 AND t>=?3 AND t<=?4 ORDER BY t",
        )?;
        let mut out = Candles::default();
        let mut rows = st.query(params![symbol, tf, from, to])?;
        while let Some(r) = rows.next()? {
            out.push(r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?);
        }
        Ok(out)
    }

    pub fn news_put(&self, items: &[NewsItem]) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        {
            let mut ins = tx.prepare_cached("INSERT OR IGNORE INTO news(id,provider,headline,source,summary,url,ts) VALUES(?1,?2,?3,?4,?5,?6,?7)")?;
            let mut upd = tx.prepare_cached("UPDATE news SET summary=?2 WHERE id=?1 AND summary='' AND ?2<>''")?;
            let mut sym = tx.prepare_cached("INSERT OR IGNORE INTO news_symbols(id,symbol) VALUES(?1,?2)")?;
            for i in items {
                ins.execute(params![i.id, i.provider, i.headline, i.source, i.summary, i.url, i.ts])?;
                upd.execute(params![i.id, i.summary])?;
                for s in &i.symbols { sym.execute(params![i.id, s])?; }
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Cached news in [from, to], newest first; `symbol = None` returns everything.
    pub fn news_query(&self, symbol: Option<&str>, from: i64, to: i64, limit: usize) -> Result<Vec<NewsItem>> {
        let db = self.db.lock().unwrap();
        let sql = format!(
            "SELECT n.id,n.provider,n.headline,n.source,n.summary,n.url,n.ts,
                    (SELECT group_concat(symbol,',') FROM news_symbols WHERE id=n.id)
             FROM news n {} WHERE n.ts>=?1 AND n.ts<=?2 ORDER BY n.ts DESC LIMIT {limit}",
            if symbol.is_some() { "JOIN news_symbols s ON s.id=n.id AND s.symbol=?3" } else { "" }
        );
        let mut st = db.prepare(&sql)?;
        let map = |r: &rusqlite::Row| -> rusqlite::Result<NewsItem> {
            let syms: Option<String> = r.get(7)?;
            Ok(NewsItem {
                id: r.get(0)?, provider: r.get(1)?, headline: r.get(2)?, source: r.get(3)?, summary: r.get(4)?, url: r.get(5)?, ts: r.get(6)?,
                symbols: syms.map(|s| s.split(',').map(str::to_string).collect()).unwrap_or_default(),
            })
        };
        let rows = match symbol {
            Some(s) => st.query_map(params![from, to, s], map)?.collect::<rusqlite::Result<Vec<_>>>()?,
            None => st.query_map(params![from, to], map)?.collect::<rusqlite::Result<Vec<_>>>()?,
        };
        Ok(rows)
    }

    pub fn news_get(&self, id: &str) -> Result<Option<NewsItem>> {
        let db = self.db.lock().unwrap();
        let mut st = db.prepare("SELECT id,provider,headline,source,summary,url,ts FROM news WHERE id=?1")?;
        let mut rows = st.query(params![id])?;
        Ok(match rows.next()? {
            Some(r) => Some(NewsItem { id: r.get(0)?, provider: r.get(1)?, headline: r.get(2)?, source: r.get(3)?, summary: r.get(4)?, url: r.get(5)?, ts: r.get(6)?, symbols: vec![] }),
            None => None,
        })
    }

    /// True when [from, to] was fetched before and is still fresh (past windows never expire).
    pub fn news_window_covered(&self, key: &str, from: i64, to: i64, now: i64, ttl: i64) -> Result<bool> {
        let db = self.db.lock().unwrap();
        let past = to < now - 86400;
        let mut st = db.prepare("SELECT COUNT(*) FROM news_windows WHERE key=?1 AND from_t<=?2 AND to_t>=?3 AND (?4 OR fetched_at>?5)")?;
        let n: i64 = st.query_row(params![key, from, to, past, now - ttl], |r| r.get(0))?;
        Ok(n > 0)
    }

    pub fn news_window_mark(&self, key: &str, from: i64, to: i64, now: i64) -> Result<()> {
        let db = self.db.lock().unwrap();
        db.execute("INSERT INTO news_windows(key,from_t,to_t,fetched_at) VALUES(?1,?2,?3,?4)", params![key, from, to, now])?;
        Ok(())
    }

    pub fn ai_get(&self, k: &str) -> Result<Option<String>> {
        let db = self.db.lock().unwrap();
        let mut st = db.prepare("SELECT body FROM ai_summaries WHERE k=?1")?;
        let mut rows = st.query(params![k])?;
        Ok(match rows.next()? { Some(r) => Some(r.get(0)?), None => None })
    }

    pub fn ai_put(&self, k: &str, body: &str, now: i64) -> Result<()> {
        let db = self.db.lock().unwrap();
        db.execute("INSERT OR REPLACE INTO ai_summaries(k,body,created) VALUES(?1,?2,?3)", params![k, body, now])?;
        Ok(())
    }

    pub fn kv_get(&self, k: &str) -> Result<Option<String>> {
        let db = self.db.lock().unwrap();
        let mut st = db.prepare("SELECT v FROM kv WHERE k=?1")?;
        let mut rows = st.query(params![k])?;
        Ok(match rows.next()? {
            Some(r) => Some(r.get(0)?),
            None => None,
        })
    }

    pub fn kv_set(&self, k: &str, v: &str) -> Result<()> {
        let db = self.db.lock().unwrap();
        db.execute("INSERT OR REPLACE INTO kv(k,v) VALUES(?1,?2)", params![k, v])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_load_and_coverage() {
        let c = Cache::memory().unwrap();
        let mut d = Candles::default();
        d.push(100, 1.0, 2.0, 0.5, 1.5, 9.0);
        d.push(160, 1.5, 2.5, 1.0, 2.0, 7.0);
        c.store("AAPL", "1m", &d, 100, 160).unwrap();
        c.store("AAPL", "1m", &d, 50, 120).unwrap();
        assert_eq!(c.coverage("AAPL", "1m").unwrap(), Some((50, 160)));
        let l = c.load("AAPL", "1m", 0, 1000).unwrap();
        assert_eq!(l.len(), 2);
        assert_eq!(l.c[1], 2.0);
        let item = |id: &str, ts: i64, sym: &[&str]| NewsItem { id: id.into(), headline: id.into(), source: "s".into(), provider: "p".into(), summary: String::new(), url: String::new(), ts, symbols: sym.iter().map(|s| s.to_string()).collect() };
        c.news_put(&[item("a", 100, &["AAPL"]), item("b", 200, &[]), item("c", 300, &["AAPL", "MSFT"])]).unwrap();
        assert_eq!(c.news_query(None, 0, 1000, 10).unwrap().len(), 3);
        let apple = c.news_query(Some("AAPL"), 0, 1000, 10).unwrap();
        assert_eq!(apple.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["c", "a"]);
        assert_eq!(apple[0].symbols.len(), 2);
        assert!(!c.news_window_covered("AAPL", 0, 10, 1_000_000, 600).unwrap());
        c.news_window_mark("AAPL", 0, 10, 1_000_000).unwrap();
        assert!(c.news_window_covered("AAPL", 0, 10, 1_000_000, 600).unwrap());
        assert!(c.news_window_covered("AAPL", 0, 10, 2_000_000, 600).unwrap(), "past windows never expire");
        c.kv_set("a", "b").unwrap();
        assert_eq!(c.kv_get("a").unwrap().as_deref(), Some("b"));
    }
}
