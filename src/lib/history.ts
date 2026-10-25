// Back / forward history of user actions (page changes, drawing edits). Pure: entries carry their own undo / redo.

export interface HistoryEntry {
  undo: () => void;
  redo: () => void;
  /** pushes with the same key within `COALESCE_MS` of the previous one merge into one step (a drag fires many edits) */
  key?: string;
}

export const COALESCE_MS = 600;
const LIMIT = 200;

export class History {
  private stack: HistoryEntry[] = [];
  /** number of entries currently applied; entries from here on are redo-able */
  private pos = 0;
  private last = 0;

  get canBack() { return this.pos > 0; }
  get canForward() { return this.pos < this.stack.length; }

  push(e: HistoryEntry, now = Date.now()) {
    const top = this.stack[this.pos - 1];
    if (e.key && top?.key === e.key && this.pos === this.stack.length && now - this.last < COALESCE_MS) {
      this.stack[this.pos - 1] = { key: e.key, undo: top.undo, redo: e.redo };
    } else {
      this.stack.length = this.pos; // a new action drops the redo branch
      this.stack.push(e);
      if (this.stack.length > LIMIT) this.stack.shift();
      this.pos = this.stack.length;
    }
    this.last = now;
  }

  back(): boolean {
    if (!this.canBack) return false;
    this.stack[--this.pos].undo();
    this.last = 0;
    return true;
  }

  forward(): boolean {
    if (!this.canForward) return false;
    this.stack[this.pos++].redo();
    this.last = 0;
    return true;
  }
}

export const history = new History();
