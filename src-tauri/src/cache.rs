use crate::model::{Candles, Result};
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
             CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);",
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
        c.kv_set("a", "b").unwrap();
        assert_eq!(c.kv_get("a").unwrap().as_deref(), Some("b"));
    }
}
