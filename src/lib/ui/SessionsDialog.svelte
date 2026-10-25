<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { SESSION_GROUPS, sessionRow } from '$lib/sessions.ts';
  import { systemTz, fmtOffset, offsetMin, zoneOptions, zonedParts } from '$lib/tz.ts';

  let now = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    if (!app.sessionsOpen) return;
    now = Math.floor(Date.now() / 1000);
    const iv = setInterval(() => (now = Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(iv);
  });
  const mine = $derived(app.tz === 'system' ? systemTz() : app.tz);
  const mineLabel = $derived(zoneOptions(now).find((o) => o.value === (app.tz))?.label.replace(/^\(UTC[^)]*\) /, '') ?? mine);
  const groups = $derived.by(() => {
    if (!app.sessionsOpen) return [];
    return SESSION_GROUPS.map((g) => ({ ...g, rows: g.rows.map((s) => {
      // the calendar day at the venue decides the daylight saving state of its hours
      const v = zonedParts(s.tz, now);
      return { s, r: sessionRow(s, v.year, v.month, v.day, mine), off: offsetMin(s.tz, now), weekend: v.weekday === 0 || v.weekday === 6 };
    }) }));
  });
  const utcNow = $derived(((p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`)(zonedParts('UTC', now)));
  const myNow = $derived(((p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`)(zonedParts(mine, now)));
  const close = () => { app.sessionsOpen = false; };
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && app.sessionsOpen) close(); }} />

{#if app.sessionsOpen}
  <div class="scrim" onpointerdown={close} role="presentation">
    <div class="card" onpointerdown={(e) => e.stopPropagation()} role="dialog" aria-label="Session time cheat sheet">
      <header>
        <h2>Session time cheat sheet</h2>
        <span class="now">Now <b>{utcNow}</b> UTC · <b>{myNow}</b> {mineLabel} ({fmtOffset(offsetMin(mine, now))})</span>
        <div class="sp"></div>
        <button class="x" onclick={close} aria-label="Close">×</button>
      </header>
      <div class="scroll">
        {#each groups as g}
          <h3>{g.title}</h3>
          <p class="note">{g.note}</p>
          <table>
            <thead><tr><th>Session</th><th>Venue time</th><th>UTC</th><th>Your time ({mineLabel})</th><th></th></tr></thead>
            <tbody>
              {#each g.rows as { s, r, off, weekend }}
                <tr>
                  <td><b>{s.name}</b></td>
                  <td>{r.local} <span class="dim">{s.city} ({fmtOffset(off)})</span></td>
                  <td>{r.utc}</td>
                  <td class="mine">{r.mine}</td>
                  <td>{#if weekend}<span class="st">weekend</span>{:else if r.isOpen(now)}<span class="st on">open</span>{:else}<span class="st">closed</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/each}
        <p class="note foot">Times follow daylight saving as of today, so they move by an hour around the clock changes in spring and autumn (the US and Europe change on different dates). Public holidays are not shown. The time zone is chosen in the settings; candles are always stored in UTC.</p>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55); }
  .card { width: min(980px, calc(100vw - 32px)); max-height: 88vh; display: flex; flex-direction: column; border-radius: 2px; padding: 18px 22px; background: var(--glass); border: 1px solid var(--glass-line); box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.22), 0 30px 90px rgba(0, 0, 0, 0.7); }
  header { display: flex; align-items: center; gap: 16px; flex: none; flex-wrap: wrap; }
  h2 { margin: 0; font-size: 19px; } .sp { flex: 1; }
  .now { color: var(--dim); font-size: 12.5px; } .now b { color: var(--fg); font-family: ui-monospace, monospace; font-weight: 600; }
  .x { background: none; border: 0; color: var(--dim); font-size: 24px; cursor: pointer; } .x:hover { color: var(--fg); }
  .scroll { overflow: auto; min-height: 0; margin-top: 4px; }
  h3 { margin: 18px 0 2px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  .note { margin: 2px 0 8px; color: var(--dim); font-size: 12px; line-height: 1.5; } .foot { margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; font: 12.5px ui-monospace, monospace; }
  th { text-align: left; color: var(--dim); font: 600 10.5px system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; padding: 6px 10px; border-bottom: 1px solid var(--glass-line); white-space: nowrap; }
  td { padding: 7px 10px; border-bottom: 1px solid var(--glass-line); white-space: nowrap; }
  td b { font-family: system-ui, sans-serif; } .dim { color: var(--dim); font-family: system-ui, sans-serif; font-size: 11.5px; margin-left: 4px; } .mine { color: var(--accent); }
  .st { font: 600 10.5px system-ui, sans-serif; letter-spacing: 0.05em; text-transform: uppercase; color: var(--dim); border: 1px solid var(--glass-line); padding: 2px 7px; } .st.on { color: var(--up); border-color: var(--up); }
</style>
