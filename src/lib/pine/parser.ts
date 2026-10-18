// Pine Script (v5/v6 subset) lexer and parser. Produces an AST consumed by interp.ts.

export type Arg = { name?: string; value: Expr };
export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'na' }
  | { k: 'color'; v: string }
  | { k: 'id'; name: string; line: number }
  | { k: 'member'; obj: Expr; name: string }
  | { k: 'call'; callee: Expr; args: Arg[]; id: number; line: number }
  | { k: 'index'; base: Expr; idx: Expr; id: number }
  | { k: 'unary'; op: string; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'tern'; c: Expr; a: Expr; b: Expr }
  | { k: 'arr'; items: Expr[] }
  | { k: 'if'; cond: Expr; then: Stmt[]; else?: Stmt[] }
  | { k: 'for'; v: string; from: Expr; to: Expr; by?: Expr; body: Stmt[] }
  | { k: 'forin'; vars: string[]; iter: Expr; body: Stmt[] }
  | { k: 'while'; cond: Expr; body: Stmt[] }
  | { k: 'switch'; subject?: Expr; cases: { test?: Expr; body: Stmt[] }[] };

export type Stmt =
  | { k: 'decl'; names: string[]; tuple: boolean; mode: '' | 'var' | 'varip'; init: Expr; id: number }
  | { k: 'assign'; target: string; op: string; value: Expr }
  | { k: 'func'; name: string; params: { name: string; def?: Expr }[]; body: Stmt[] }
  | { k: 'expr'; e: Expr }
  | { k: 'break' }
  | { k: 'continue' };

export class PineSyntaxError extends Error {
  line: number;
  constructor(msg: string, line: number) { super(`line ${line}: ${msg}`); this.line = line; }
}

// ---------------- lexer ----------------
type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'color' | 'nl' | 'indent' | 'dedent' | 'eof'; v: string | number; line: number };

const OPS = ['!=', '==', '<=', '>=', ':=', '+=', '-=', '*=', '/=', '%=', '=>', '+', '-', '*', '/', '%', '<', '>', '=', '?', ':', ',', '(', ')', '[', ']', '.'];
const CONT_END = new Set(['+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '!=', ',', '?', ':', '(', '[', '.', 'and', 'or']);

function stripComment(line: string): string {
  let q = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

function lexLine(src: string, line: number, out: Tok[]) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { const e = src[j + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; }
        else s += src[j++];
      }
      out.push({ t: 'str', v: s, line }); i = j + 1; continue;
    }
    if (c === '#') {
      const m = /^#[0-9a-fA-F]{6,8}/.exec(src.slice(i));
      if (m) { out.push({ t: 'color', v: m[0], line }); i += m[0].length; continue; }
    }
    const num = /^(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/.exec(src.slice(i));
    if (num && (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? '')))) { out.push({ t: 'num', v: parseFloat(num[0]), line }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0], line }); i += id[0].length; continue; }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op, line }); i += op.length; continue; }
    throw new PineSyntaxError(`unexpected character '${c}'`, line);
  }
}

export function lex(code: string): Tok[] {
  const toks: Tok[] = [];
  const stack = [0];
  let depth = 0;
  const lines = code.replace(/\r/g, '').split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = stripComment(lines[ln]);
    if (!raw.trim()) continue;
    const indent = raw.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length;
    const last = toks[toks.length - 1];
    let cont = depth > 0;
    if (!cont && last && last.t !== 'nl' && last.t !== 'indent' && last.t !== 'dedent') {
      const lastStr = String(last.v);
      if (indent > stack[stack.length - 1] && (indent % 4 !== 0 || (last.t === 'op' || last.t === 'id') && CONT_END.has(lastStr))) cont = true;
    }
    if (!cont) {
      if (last && last.t !== 'nl') toks.push({ t: 'nl', v: '', line: ln + 1 });
      if (indent > stack[stack.length - 1]) { stack.push(indent); toks.push({ t: 'indent', v: '', line: ln + 1 }); }
      else {
        while (indent < stack[stack.length - 1]) { stack.pop(); toks.push({ t: 'dedent', v: '', line: ln + 1 }); }
      }
    }
    const before = toks.length;
    lexLine(raw.trim(), ln + 1, toks);
    for (let k = before; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === 'op') { if (t.v === '(' || t.v === '[') depth++; else if (t.v === ')' || t.v === ']') depth = Math.max(0, depth - 1); }
    }
  }
  if (toks.length && toks[toks.length - 1].t !== 'nl') toks.push({ t: 'nl', v: '', line: lines.length });
  while (stack.length > 1) { stack.pop(); toks.push({ t: 'dedent', v: '', line: lines.length }); }
  toks.push({ t: 'eof', v: '', line: lines.length });
  return toks;
}

// ---------------- parser ----------------
const TYPES = new Set(['int', 'float', 'bool', 'string', 'color', 'series', 'simple', 'const', 'label', 'line', 'box', 'table', 'linefill', 'polyline', 'chart.point', 'array', 'matrix', 'map']);
const BIN: Record<string, [number, boolean]> = {
  or: [10, false], and: [20, false],
  '==': [30, false], '!=': [30, false],
  '<': [40, false], '<=': [40, false], '>': [40, false], '>=': [40, false],
  '+': [50, false], '-': [50, false],
  '*': [60, false], '/': [60, false], '%': [60, false],
};

export class Parser {
  private p = 0;
  private uid = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) { this.toks = toks; }

  private get cur() { return this.toks[this.p]; }
  private peek(n = 1) { return this.toks[Math.min(this.p + n, this.toks.length - 1)]; }
  private isOp(v: string, tok = this.cur) { return tok.t === 'op' && tok.v === v; }
  private isId(v: string, tok = this.cur) { return tok.t === 'id' && tok.v === v; }
  private err(msg: string): never { throw new PineSyntaxError(msg, this.cur.line); }
  private eatOp(v: string) { if (!this.isOp(v)) this.err(`expected '${v}' but found '${this.cur.v}'`); this.p++; }
  private skipNl() { while (this.cur.t === 'nl') this.p++; }

  parseProgram(): Stmt[] {
    const out: Stmt[] = [];
    this.skipNl();
    while (this.cur.t !== 'eof') {
      if (this.cur.t === 'dedent' || this.cur.t === 'indent') { this.p++; continue; }
      out.push(this.statement());
      this.skipNl();
    }
    return out;
  }

  /** Block after a header: either NL INDENT stmts DEDENT, or a single inline statement. */
  private block(): Stmt[] {
    if (this.cur.t === 'nl') {
      this.skipNl();
      if ((this.cur.t as string) !== 'indent') this.err('expected an indented block');
      this.p++;
      const out: Stmt[] = [];
      this.skipNl();
      while ((this.cur.t as string) !== 'dedent' && (this.cur.t as string) !== 'eof') { out.push(this.statement()); this.skipNl(); }
      if ((this.cur.t as string) === 'dedent') this.p++;
      return out;
    }
    return [this.statement()];
  }

  private endStmt(after?: Expr) {
    if (after && ['if', 'for', 'forin', 'while', 'switch'].includes(after.k)) { if (this.cur.t === 'nl') this.p++; return; }
    if (this.cur.t === 'nl') { this.p++; return; }
    if (this.cur.t === 'dedent' || this.cur.t === 'eof') return;
    if (this.isOp(',')) { this.p++; return; }
    this.err(`unexpected '${this.cur.v}'`);
  }

  private isFuncDef(): boolean {
    if (this.cur.t !== 'id' || !this.isOp('(', this.peek())) return false;
    let d = 0, j = this.p + 1;
    for (; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.t === 'op' && (t.v === '(' || t.v === '[')) d++;
      else if (t.t === 'op' && (t.v === ')' || t.v === ']')) { d--; if (d === 0) break; }
      else if ((t.t as string) === 'nl' || (t.t as string) === 'eof') return false;
    }
    return this.isOp('=>', this.toks[j + 1]);
  }

  private statement(): Stmt {
    const t = this.cur;
    if (t.t === 'id') {
      if (t.v === 'break') { this.p++; this.endStmt(); return { k: 'break' }; }
      if (t.v === 'continue') { this.p++; this.endStmt(); return { k: 'continue' }; }
      if (t.v === 'export' || t.v === 'method') { this.p++; return this.statement(); }
      if ((t.v === 'var' || t.v === 'varip') && this.peek().t === 'id') {
        this.p++;
        this.skipType();
        return this.declOrAssign(t.v);
      }
      if (this.isFuncDef()) return this.funcDef();
      if (TYPES.has(t.v as string) && (this.peek().t === 'id' || this.isOp('<', this.peek()) || (t.v === 'chart.point' ))) {
        const save = this.p;
        this.skipType();
        if (this.cur.t === 'id' && this.isOp('=', this.peek())) return this.declOrAssign('');
        this.p = save;
      }
    }
    if (this.isOp('[')) {
      // tuple declaration: [a, b] = expr
      const save = this.p;
      this.p++;
      const names: string[] = [];
      while (this.cur.t === 'id') { names.push(this.cur.v as string); this.p++; if (this.isOp(',')) this.p++; else break; }
      if (this.isOp(']') && this.isOp('=', this.peek()) && names.length) {
        this.p += 2;
        const init = this.expr();
        this.endStmt(init);
        return { k: 'decl', names, tuple: true, mode: '', init, id: this.uid++ };
      }
      this.p = save;
    }
    if (t.t === 'id' && (this.isOp('=', this.peek()) || [':=', '+=', '-=', '*=', '/=', '%='].some((o) => this.isOp(o, this.peek())))) {
      return this.declOrAssign('');
    }
    const e = this.expr();
    this.endStmt(e);
    return { k: 'expr', e };
  }

  private skipType() {
    // [qualifier] [type][<...>] before an identifier
    while (this.cur.t === 'id' && TYPES.has(this.cur.v as string)) {
      this.p++;
      if (this.isOp('<')) { let d = 0; do { if (this.isOp('<')) d++; else if (this.isOp('>')) d--; this.p++; } while (d > 0 && (this.cur.t as string) !== 'eof'); }
      if (this.isOp('.')) { this.p++; this.p++; }
    }
  }

  private declOrAssign(mode: '' | 'var' | 'varip'): Stmt {
    const name = this.cur.v as string;
    this.p++;
    const opTok = this.cur;
    if (opTok.t !== 'op') this.err('expected assignment');
    const op = opTok.v as string;
    this.p++;
    const value = this.expr();
    this.endStmt(value);
    if (op === '=') return { k: 'decl', names: [name], tuple: false, mode, init: value, id: this.uid++ };
    return { k: 'assign', target: name, op, value };
  }

  private funcDef(): Stmt {
    const name = this.cur.v as string;
    this.p += 2;
    const params: { name: string; def?: Expr }[] = [];
    while (!this.isOp(')')) {
      this.skipType();
      if (this.cur.t !== 'id') this.err('expected parameter name');
      const pn = this.cur.v as string; this.p++;
      let def: Expr | undefined;
      if (this.isOp('=')) { this.p++; def = this.expr(); }
      params.push({ name: pn, def });
      if (this.isOp(',')) this.p++;
    }
    this.p++; this.eatOp('=>');
    const body = this.block();
    return { k: 'func', name, params, body };
  }

  // ----- expressions -----
  expr(): Expr { return this.ternary(); }

  private ternary(): Expr {
    const c = this.binary(0);
    if (this.isOp('?')) {
      this.p++;
      const a = this.ternary();
      this.eatOp(':');
      const b = this.ternary();
      return { k: 'tern', c, a, b };
    }
    return c;
  }

  private binary(minBp: number): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.cur;
      const key = t.t === 'op' || (t.t === 'id' && (t.v === 'and' || t.v === 'or')) ? (t.v as string) : '';
      const info = BIN[key];
      if (!info || info[0] < minBp) break;
      this.p++;
      const right = this.binary(info[0] + 1);
      left = { k: 'bin', op: key, l: left, r: right };
    }
    return left;
  }

  private unary(): Expr {
    if (this.isOp('-') || this.isOp('+')) { const op = this.cur.v as string; this.p++; return { k: 'unary', op, e: this.unary() }; }
    if (this.isId('not')) { this.p++; return { k: 'unary', op: 'not', e: this.binary(30) }; }
    return this.postfix(this.primary());
  }

  private postfix(e: Expr): Expr {
    for (;;) {
      if (this.isOp('(')) { e = this.call(e); }
      else if (this.isOp('[')) {
        this.p++;
        const idx = this.expr();
        this.eatOp(']');
        e = { k: 'index', base: e, idx, id: this.uid++ };
      } else if (this.isOp('.') && this.peek().t === 'id') {
        this.p++;
        e = { k: 'member', obj: e, name: this.cur.v as string };
        this.p++;
      } else break;
    }
    return e;
  }

  private call(callee: Expr): Expr {
    const line = this.cur.line;
    this.eatOp('(');
    const args: Arg[] = [];
    while (!this.isOp(')')) {
      if (this.cur.t === 'nl') { this.p++; continue; }
      if (this.cur.t === 'id' && this.isOp('=', this.peek()) ) {
        const name = this.cur.v as string; this.p += 2;
        args.push({ name, value: this.expr() });
      } else args.push({ value: this.expr() });
      if (this.isOp(',')) this.p++;
    }
    this.p++;
    return { k: 'call', callee, args, id: this.uid++, line };
  }

  private primary(): Expr {
    const t = this.cur;
    switch (t.t) {
      case 'num': this.p++; return { k: 'num', v: t.v as number };
      case 'str': this.p++; return { k: 'str', v: t.v as string };
      case 'color': this.p++; return { k: 'color', v: t.v as string };
      case 'op':
        if (t.v === '(') { this.p++; const e = this.expr(); this.eatOp(')'); return e; }
        if (t.v === '[') {
          this.p++;
          const items: Expr[] = [];
          while (!this.isOp(']')) { if (this.cur.t === 'nl') { this.p++; continue; } items.push(this.expr()); if (this.isOp(',')) this.p++; }
          this.p++;
          return { k: 'arr', items };
        }
        break;
      case 'id': {
        const v = t.v as string;
        if (v === 'true' || v === 'false') { this.p++; return { k: 'bool', v: v === 'true' }; }
        if (v === 'na' && !this.isOp('(', this.peek())) { this.p++; return { k: 'na' }; }
        if (v === 'if') return this.ifExpr();
        if (v === 'for') return this.forExpr();
        if (v === 'while') { this.p++; const cond = this.expr(); return { k: 'while', cond, body: this.block() }; }
        if (v === 'switch') return this.switchExpr();
        this.p++;
        return { k: 'id', name: v, line: t.line };
      }
    }
    return this.err(`unexpected '${t.v === '' ? t.t : t.v}'`);
  }

  private ifExpr(): Expr {
    this.p++;
    const cond = this.expr();
    const then = this.block();
    let els: Stmt[] | undefined;
    const save = this.p;
    this.skipNl();
    if (this.isId('else')) {
      this.p++;
      if (this.isId('if')) els = [{ k: 'expr', e: this.ifExpr() }];
      else els = this.block();
    } else this.p = save;
    return { k: 'if', cond, then, else: els };
  }

  private forExpr(): Expr {
    this.p++;
    if (this.isOp('[')) {
      this.p++;
      const vars: string[] = [];
      while (this.cur.t === 'id') { vars.push(this.cur.v as string); this.p++; if (this.isOp(',')) this.p++; }
      this.eatOp(']');
      if (!this.isId('in')) this.err("expected 'in'");
      this.p++;
      const iter = this.expr();
      return { k: 'forin', vars, iter, body: this.block() };
    }
    const v = this.cur.v as string; this.p++;
    if (this.isId('in')) { this.p++; const iter = this.expr(); return { k: 'forin', vars: [v], iter, body: this.block() }; }
    this.eatOp('=');
    const from = this.expr();
    if (!this.isId('to')) this.err("expected 'to'");
    this.p++;
    const to = this.expr();
    let by: Expr | undefined;
    if (this.isId('by')) { this.p++; by = this.expr(); }
    return { k: 'for', v, from, to, by, body: this.block() };
  }

  private switchExpr(): Expr {
    this.p++;
    let subject: Expr | undefined;
    if (this.cur.t !== 'nl') subject = this.expr();
    this.skipNl();
    if ((this.cur.t as string) !== 'indent') this.err('expected switch cases');
    this.p++;
    const cases: { test?: Expr; body: Stmt[] }[] = [];
    this.skipNl();
    while ((this.cur.t as string) !== 'dedent' && (this.cur.t as string) !== 'eof') {
      let test: Expr | undefined;
      if (!this.isOp('=>')) test = this.expr();
      this.eatOp('=>');
      cases.push({ test, body: this.block() });
      this.skipNl();
    }
    if ((this.cur.t as string) === 'dedent') this.p++;
    return { k: 'switch', subject, cases };
  }
}

export function parse(code: string): Stmt[] {
  return new Parser(lex(code)).parseProgram();
}
