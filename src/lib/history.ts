// Back / forward history of user actions (page changes, drawing edits). Pure: entries carry their own undo / redo.

export interface HistoryEntry {
  /** return false when the step cannot be applied any more (its field is gone): the next step is taken instead */
  undo: () => unknown;
  redo: () => unknown;
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
  /** pushes made while a step is applied (the change events it causes) are not new steps */
  private busy = false;

  get canBack() { return this.pos > 0; }
  get canForward() { return this.pos < this.stack.length; }

  push(e: HistoryEntry, now = Date.now()) {
    if (this.busy) return;
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

  private apply(f: () => unknown): boolean {
    this.busy = true;
    try { return f() !== false; } finally { this.busy = false; }
  }

  back(): boolean {
    this.last = 0;
    while (this.canBack) if (this.apply(this.stack[--this.pos].undo)) return true;
    return false;
  }

  forward(): boolean {
    this.last = 0;
    while (this.canForward) if (this.apply(this.stack[this.pos++].redo)) return true;
    return false;
  }
}

export const history = new History();
