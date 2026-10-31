import { inTauri } from './api';
import { setIndicatorSource } from './pine/indlib.ts';

export type ScriptKind = 'indicators' | 'strategies';
export interface ScriptFile { name: string; code: string; title: string; shortTitle: string; overlay: boolean; modified: number }

const bundledIndicators = import.meta.glob('/indicators/*.pine', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Cheap header parse for listings; the real metadata comes from running the script. */
export function scriptMeta(code: string): { title: string; shortTitle: string; overlay: boolean } {
  const m = /(?:indicator|strategy|study)\s*\(([^\n]*)/.exec(code);
  const args = m?.[1] ?? '';
  // quoted strings may contain parentheses, e.g. "Relative Strength Index (RSI)"
  const str = (re: RegExp) => re.exec(args)?.[2];
  const title = str(/^\s*(?:title\s*=\s*)?(["'])(.*?)\1/) ?? 'Untitled';
  const shortTitle = str(/shorttitle\s*=\s*(["'])(.*?)\1/) ?? title;
  const overlay = /overlay\s*=\s*true/.test(args);
  return { title, shortTitle, overlay };
}

const toFile = (name: string, code: string, modified = 0): ScriptFile => ({ name, code, modified, ...scriptMeta(code) });

class Library {
  indicators = $state<ScriptFile[]>([]);
  strategies = $state<ScriptFile[]>([]);
  folder = $state<Record<ScriptKind, string>>({ indicators: '', strategies: '' });
  loaded = $state(false);

  /** Set by the account sync: a script was saved or deleted on this device (not by the sync itself). */
  onChange: ((kind: ScriptKind, name: string) => void) | null = null;

  list(kind: ScriptKind) { return kind === 'indicators' ? this.indicators : this.strategies; }
  get(kind: ScriptKind, name: string): ScriptFile | undefined { return this.list(kind).find((f) => f.name === name); }

  private set(kind: ScriptKind, files: ScriptFile[]) { if (kind === 'indicators') this.indicators = files; else this.strategies = files; }

  private store(kind: ScriptKind): Record<string, string> {
    try { return JSON.parse(localStorage.getItem('oviate:scripts:' + kind) ?? '{}'); } catch { return {}; }
  }

  async load() {
    if (inTauri) {
      try {
        const bundled = Object.entries(bundledIndicators).map(([p, code]) => ({ name: p.split('/').pop()!.replace(/\.pine$/, ''), code, modified: 0 }));
        await call('pine_seed', { kind: 'indicators', files: bundled });
        for (const kind of ['indicators', 'strategies'] as ScriptKind[]) {
          const files = await call<{ name: string; code: string; modified: number }[]>('pine_list', { kind });
          this.set(kind, files.map((f) => toFile(f.name, f.code, f.modified)));
          this.folder[kind] = await call<string>('pine_folder', { kind });
        }
      } catch (e) { console.warn('pine library load failed', e); }
    } else {
      // browser preview: bundled indicators plus whatever was saved in localStorage
      const user = this.store('indicators');
      const all = { ...Object.fromEntries(Object.entries(bundledIndicators).map(([p, c]) => [p.split('/').pop()!.replace(/\.pine$/, ''), c])), ...user };
      this.indicators = Object.entries(all).map(([n, c]) => toFile(n, c)).sort((a, b) => a.name.localeCompare(b.name));
      this.strategies = Object.entries(this.store('strategies')).map(([n, c]) => toFile(n, c));
    }
    this.loaded = true;
  }

  async save(kind: ScriptKind, name: string, code: string, quiet = false): Promise<string> {
    let saved = name;
    if (inTauri) saved = await call<string>('pine_save', { kind, name, code });
    else {
      const s = this.store(kind); s[name] = code;
      try { localStorage.setItem('oviate:scripts:' + kind, JSON.stringify(s)); } catch { /* ignore */ }
    }
    const list = this.list(kind).filter((f) => f.name !== saved);
    this.set(kind, [...list, toFile(saved, code, Date.now() / 1000)].sort((a, b) => a.name.localeCompare(b.name)));
    if (!quiet) this.onChange?.(kind, saved);
    return saved;
  }

  async remove(kind: ScriptKind, name: string, quiet = false) {
    if (inTauri) await call('pine_delete', { kind, name });
    else { const s = this.store(kind); delete s[name]; try { localStorage.setItem('oviate:scripts:' + kind, JSON.stringify(s)); } catch { /* ignore */ } }
    this.set(kind, this.list(kind).filter((f) => f.name !== name));
    if (!quiet) this.onChange?.(kind, name);
  }
}

export const library = new Library();
// strategies read library indicators through oviate.ind(name, ...)
setIndicatorSource((n) => library.get('indicators', n)?.code);
