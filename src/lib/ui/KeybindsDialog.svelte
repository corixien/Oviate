<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { BUILTIN, bindingOf, combosOf, comboOf, assign } from '$lib/keybinds.ts';
  import { buildCommands, commandText, type Command } from '$lib/commands.svelte';

  let q = $state('');
  let capturing = $state('');
  const commands = $derived(app.keybindsOpen ? buildCommands() : []);
  const titleOf = (id: string) => BUILTIN.find((b) => b.id === id)?.title ?? commands.find((c) => c.id === id)?.title ?? id;
  const match = (...parts: (string | undefined)[]) => { const w = q.toLowerCase().split(/\s+/).filter(Boolean); const h = parts.join(' ').toLowerCase(); return w.every((x) => h.includes(x)); };
  const groups = $derived(['General', 'Chart', 'Replay'].map((g) => ({ g, rows: BUILTIN.filter((b) => b.group === g && match(b.title, bindingOf(b.id, app.keybinds))) })).filter((x) => x.rows.length));
  const cmdRows = $derived(commands.filter((c) => match(c.title, c.tag, commandText(c), bindingOf(c.id, app.keybinds))).slice(0, 150));
  const changed = $derived(Object.keys(app.keybinds).length + Object.keys(app.cmdAlias).length);

  function save() { app.persist(); }
  function setCombo(id: string, combo: string) {
    const { next, lost } = assign($state.snapshot(app.keybinds), id, combo, commands.map((c) => c.id));
    app.keybinds = next; save();
    if (lost.length) app.notify(`${combo} was taken from: ${lost.map(titleOf).join(', ')}`);
  }
  const clearCombo = (id: string) => { app.keybinds[id] = ''; save(); };
  const resetRow = (id: string) => { delete app.keybinds[id]; delete app.cmdAlias[id]; save(); };
  const resetAll = () => { if (confirm('Reset all shortcuts and command names to their defaults?')) { app.keybinds = {}; app.cmdAlias = {}; save(); } };
  function rename(c: Command, v: string) {
    const t = v.trim().toLowerCase();
    if (!t || t === c.key.toLowerCase()) delete app.cmdAlias[c.id]; else app.cmdAlias[c.id] = t;
    save();
  }
  const close = () => { capturing = ''; app.keybindsOpen = false; };

  // while a row records, the next key combination is taken (Esc cancels); nothing else reacts to it
  $effect(() => {
    if (!capturing) return;
    const id = capturing;
    const on = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Escape') { capturing = ''; return; }
      const combo = comboOf(e);
      if (!combo) return;
      setCombo(id, combo); capturing = '';
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && app.keybindsOpen && !capturing) close(); }} />

{#snippet bind(id: string)}
  <button class="cap" class:rec={capturing === id} onclick={() => (capturing = capturing === id ? '' : id)} title="Click, then press the new shortcut (Esc cancels)">
    {#if capturing === id}press keys…{:else if combosOf(bindingOf(id, app.keybinds)).length}{#each combosOf(bindingOf(id, app.keybinds)) as c}<kbd>{c}</kbd>{/each}{:else}<span class="none">none</span>{/if}
  </button>
  {#if combosOf(bindingOf(id, app.keybinds)).length}<button class="ic" title="Remove the shortcut" onclick={() => clearCombo(id)}>×</button>{/if}
  {#if id in app.keybinds || id in app.cmdAlias}<button class="ic" title="Back to the default" onclick={() => resetRow(id)}>↺</button>{/if}
{/snippet}

{#if app.keybindsOpen}
  <div class="scrim" onpointerdown={close} role="presentation">
    <div class="card" onpointerdown={(e) => e.stopPropagation()} role="dialog" aria-label="Keybinds">
      <header>
        <h2>Keybinds</h2>
        <input data-nohist class="find" bind:value={q} placeholder="Search actions, commands, shortcuts" spellcheck="false" autocomplete="off" />
        {#if changed}<button class="mini" onclick={resetAll}>Reset all</button>{/if}
        <button class="x" onclick={close} aria-label="Close">×</button>
      </header>
      <p class="lead">Click a shortcut, then press the new keys. A shortcut belongs to one action: giving it away takes it from the old one. The mouse back / forward buttons always step back / forward.</p>
      <div class="scroll">
        {#each groups as grp (grp.g)}
          <h3>{grp.g}</h3>
          {#each grp.rows as b (b.id)}
            <div class="row"><span class="ti">{b.title}</span><span class="ctl">{@render bind(b.id)}</span></div>
          {/each}
        {/each}
        <h3>Command bar commands <span class="hint">type <kbd>/</kbd> in the command bar; the command text is what the search matches, edit it to rename the command</span></h3>
        {#each cmdRows as c (c.id)}
          <div class="row cmd">
            <span class="ti"><i>{c.tag}</i>{c.title}</span>
            <input class="cmdtxt" value={commandText(c)} onchange={(e) => rename(c, e.currentTarget.value)} spellcheck="false" autocomplete="off" />
            <span class="ctl">{@render bind(c.id)}</span>
          </div>
        {:else}<p class="lead">Nothing matches.</p>{/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55); }
  .card { width: min(860px, calc(100vw - 32px)); height: min(720px, 88vh); display: flex; flex-direction: column; border-radius: 2px; padding: 18px 22px; background: var(--glass); border: 1px solid var(--glass-line); box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.22), 0 30px 90px rgba(0, 0, 0, 0.7); }
  header { display: flex; align-items: center; gap: 12px; flex: none; }
  h2 { margin: 0; font-size: 19px; } .find { flex: 1; }
  h3 { margin: 18px 0 6px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); } h3 .hint { text-transform: none; letter-spacing: 0; margin-left: 8px; font-weight: 400; }
  .lead { margin: 10px 0 0; color: var(--dim); font-size: 12.5px; flex: none; }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; padding-right: 6px; }
  .x { background: none; border: 0; color: var(--dim); font-size: 24px; cursor: pointer; } .x:hover { color: var(--fg); }
  input { box-sizing: border-box; height: 30px; padding: 0 10px; border: 1px solid var(--glass-line); background: rgba(0, 0, 0, 0.35); color: var(--fg); font: 13px system-ui, sans-serif; outline: none; border-radius: 2px; }
  input:focus { border-color: var(--accent); }
  .row { display: flex; align-items: center; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--line); min-height: 40px; box-sizing: border-box; }
  .ti { flex: 1; min-width: 0; font-size: 13px; } .ti i { font: normal 10px ui-monospace, monospace; text-transform: uppercase; color: var(--accent); border: 1px solid var(--glass-line); padding: 1px 5px; margin-right: 8px; }
  .cmdtxt { width: 250px; font: 12px ui-monospace, monospace; }
  .ctl { display: inline-flex; align-items: center; gap: 4px; flex: none; min-width: 210px; justify-content: flex-end; }
  .cap { display: inline-flex; gap: 5px; align-items: center; min-height: 28px; padding: 0 8px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--glass-line); border-radius: 2px; color: var(--fg); cursor: pointer; }
  .cap:hover { border-color: var(--accent); } .cap.rec { border-color: var(--accent); background: var(--accent-soft); }
  kbd { font: 11px ui-monospace, monospace; padding: 1px 6px; border: 1px solid var(--glass-line); border-radius: 2px; color: var(--fg); background: rgba(255, 255, 255, 0.04); }
  .none { color: var(--dim); font-size: 12px; }
  .ic, .mini { height: 28px; min-width: 26px; padding: 0 8px; background: none; border: 1px solid transparent; color: var(--dim); cursor: pointer; font: 600 13px system-ui, sans-serif; } .ic:hover { color: var(--fg); border-color: var(--glass-line); }
  .mini { border-color: var(--glass-line); color: var(--fg); font-size: 12px; } .mini:hover { border-color: var(--accent); }
</style>
