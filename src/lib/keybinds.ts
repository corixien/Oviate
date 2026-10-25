// Keyboard shortcuts: key combos, the built-in actions with their defaults, and user overrides. Pure (no Svelte).

export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

export interface BuiltinBind { id: string; title: string; group: string; keys: string }

const MODS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead']);

/** 'Ctrl+Shift+Z' style name of a key event (null for a lone modifier). Shift only counts for letters and named keys: '+' stays '+' whether or not Shift made it. */
export function comboOf(e: KeyLike): string | null {
  if (MODS.has(e.key)) return null;
  const letter = /^[a-z]$/i.test(e.key);
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const shift = e.shiftKey && (letter || e.key.length > 1 || e.key === ' ');
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', shift ? 'Shift' : '', key].filter(Boolean).join('+');
}

/** A binding is one or more combos separated by ' | '. */
export const combosOf = (bind: string | undefined) => (bind ? bind.split(' | ').map((s) => s.trim()).filter(Boolean) : []);

/** Built-in actions (the shortcuts Oviate had before they became editable). */
export const BUILTIN: BuiltinBind[] = [
  { id: 'app.cmdbar', title: 'Open the command bar', group: 'General', keys: 'Enter | Ctrl+K' },
  { id: 'app.back', title: 'Back (previous view, drawing change)', group: 'General', keys: 'Ctrl+Z' },
  { id: 'app.forward', title: 'Forward (after a step back)', group: 'General', keys: 'Ctrl+Shift+Z | Ctrl+Y' },
  { id: 'app.zoom_in', title: 'App zoom in', group: 'General', keys: 'Ctrl++ | Ctrl+=' },
  { id: 'app.zoom_out', title: 'App zoom out', group: 'General', keys: 'Ctrl+- | Ctrl+_' },
  { id: 'app.zoom_reset', title: 'App zoom reset', group: 'General', keys: 'Ctrl+0' },
  { id: 'chart.reset', title: 'Reset chart view', group: 'Chart', keys: 'Alt+R' },
  { id: 'chart.end', title: 'Scroll to the newest candle', group: 'Chart', keys: 'End' },
  { id: 'chart.pan_left', title: 'Move left (3 bars)', group: 'Chart', keys: 'ArrowLeft' },
  { id: 'chart.pan_right', title: 'Move right (3 bars)', group: 'Chart', keys: 'ArrowRight' },
  { id: 'chart.pan_left_big', title: 'Move left (20 bars)', group: 'Chart', keys: 'Shift+ArrowLeft' },
  { id: 'chart.pan_right_big', title: 'Move right (20 bars)', group: 'Chart', keys: 'Shift+ArrowRight' },
  { id: 'chart.zoom_in', title: 'Zoom the chart in', group: 'Chart', keys: '+ | =' },
  { id: 'chart.zoom_out', title: 'Zoom the chart out', group: 'Chart', keys: '-' },
  { id: 'chart.delete', title: 'Delete the selected drawing', group: 'Chart', keys: 'Delete | Backspace' },
  { id: 'chart.cancel', title: 'Cancel drawing / leave replay / select cursor', group: 'Chart', keys: 'Escape' },
  { id: 'replay.toggle', title: 'Replay: play / pause', group: 'Replay', keys: 'Space' },
  { id: 'replay.next', title: 'Replay: one bar forward', group: 'Replay', keys: 'Shift+ArrowRight' },
  { id: 'replay.prev', title: 'Replay: one bar back', group: 'Replay', keys: 'Shift+ArrowLeft' }
];

export const isBuiltin = (id: string) => BUILTIN.some((b) => b.id === id);

/** The binding of an action: the user's override ('' = unbound) or the default. */
export function bindingOf(id: string, overrides: Record<string, string>): string {
  if (id in overrides) return overrides[id];
  return BUILTIN.find((b) => b.id === id)?.keys ?? '';
}

export const hasCombo = (id: string, combo: string | null, overrides: Record<string, string>) => !!combo && combosOf(bindingOf(id, overrides)).includes(combo);

/** Give `combo` to `id` only: it is taken away from every other built-in or overridden action. Returns the new override map and the ids that lost it. */
export function assign(overrides: Record<string, string>, id: string, combo: string, commandIds: string[] = []): { next: Record<string, string>; lost: string[] } {
  const next = { ...overrides, [id]: combo };
  const lost: string[] = [];
  for (const other of [...BUILTIN.map((b) => b.id), ...commandIds, ...Object.keys(overrides)]) {
    if (other === id || lost.includes(other)) continue;
    const cs = combosOf(bindingOf(other, next));
    if (cs.includes(combo)) { next[other] = cs.filter((c) => c !== combo).join(' | '); lost.push(other); }
  }
  return { next, lost };
}
