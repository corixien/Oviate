<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { optimizer as opt } from '$lib/optimizer.svelte';
  import { fmtPrice } from '$lib/chart/renderer';
  import Select from './Select.svelte';

  const tg = $derived.by(() => { void app.strategyResults[app.chart.id]; return opt.target(); });
  $effect(() => { void tg; opt.sync(); });

  const pct = (v: number, d = 1) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) + '%' : '—');
  const cls = (v: number) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));
  const BUDGETS = [{ value: '250', label: 'Quick (250 tests)' }, { value: '600', label: 'Normal (600 tests)' }, { value: '1500', label: 'Deep (1500 tests)' }];

  function setNum(r: (typeof opt.rows)[number], k: 'min' | 'max' | 'step', e: Event) {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v) && (k !== 'step' || v > 0)) r[k] = v;
  }
  const best = $derived(opt.result?.variants[0]);
  const run = $derived(opt.status === 'running');
  const pctDone = $derived(opt.progress ? Math.min(100, (opt.progress.evals / Math.max(1, opt.progress.budget)) * 100) : 0);
</script>

{#if !tg}
  <div class="empty"><p>No strategy on the active chart.</p><p class="dim">Add one with <kbd>/strat add</kbd> or <kbd>/strat add ai</kbd>, then optimize its parameters here.</p></div>
{:else}
  <div class="acc">
    <b class="sname">{tg.t.name}</b><span class="dim">{tg.t.symbol} · {tg.t.tf.toUpperCase()} · {tg.data.n} bars</span>
    <Select value={String(opt.budget)} options={BUDGETS} onchange={(v) => (opt.budget = Number(v))} width="190px" />
    {#if run}<button class="mini" onclick={() => opt.cancel()}>Stop</button>
    {:else}<button class="primary" onclick={() => opt.run()} disabled={!opt.rows.some((r) => r.on)}>Run optimizer</button>{/if}
    {#if run && opt.progress}
      <span class="m">{opt.progress.phase} · {opt.progress.evals}/{opt.progress.budget} tests · best score <b>{opt.progress.best.toFixed(3)}</b></span>
      <div class="bar"><i style:width="{pctDone}%"></i></div>
    {:else if opt.status === 'done' && opt.result}
      <span class="m">{opt.result.evals} tests{opt.result.stopped ? ' (stopped)' : ''} · at least {opt.result.minTrades} trades per variant</span>
    {/if}
  </div>
  <div class="body">
    {#if opt.status === 'error'}<p class="err">{opt.error}</p>{/if}
    <div class="cols">
      <div class="params">
        <h5>Parameters to tune</h5>
        {#if !opt.rows.length}<p class="dim">This strategy has no numeric inputs (<code>input.int</code> / <code>input.float</code>) to tune.</p>{/if}
        <table>
          <thead><tr><th></th><th>Input</th><th>Current</th><th>Min</th><th>Max</th><th>Step</th></tr></thead>
          <tbody>
            {#each opt.rows as r (r.id)}
              <tr class:off={!r.on}>
                <td><input type="checkbox" bind:checked={r.on} aria-label="Tune {r.title}" /></td><td class="t" title={r.title}>{r.title}</td><td>{fmt(r.def)}</td>
                <td><input class="in" value={r.min} oninput={(e) => setNum(r, 'min', e)} /></td><td><input class="in" value={r.max} oninput={(e) => setNum(r, 'max', e)} /></td><td><input class="in" value={r.step} oninput={(e) => setNum(r, 'step', e)} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="note">Score: win rate counts most, then profit, then drawdown. The history is cut into 5 parts and newer parts weigh up to 6.5x more, so long history limits overfitting while the recent market counts most. Variants also look at the neighbours of a setting: a plateau beats a lone spike.</p>
      </div>
      <div class="res">
        <h5>10 variants, ranked</h5>
        {#if !opt.result}
          <p class="dim">{run ? 'Searching…' : 'Press "Run optimizer". It climbs each parameter step by step: a better step is repeated with double size, a worse one is dropped.'}</p>
        {:else}
          <table>
            <thead><tr><th>#</th><th>Variant</th><th>Parameters</th><th>Win rate</th><th>Return</th><th>Max DD</th><th>Trades</th><th>Last part</th><th>Score</th><th></th></tr></thead>
            <tbody>
              {#if opt.result.baseline}
                {@const b = opt.result.baseline}
                <tr class="base"><td></td><td>Current</td><td class="p">{opt.rows.filter((r) => r.on).map((r) => `${r.title} ${fmt(r.def)}`).join(' · ')}</td><td>{(b.rawWinRate * 100).toFixed(0)}%</td><td class={cls(b.ret)}>{pct(b.ret, 0)}</td><td class="dn">{b.maxDD.toFixed(1)}%</td><td>{b.trades}</td><td class={cls(b.recentRet)}>{pct(b.recentRet)}</td><td></td><td></td></tr>
              {/if}
              {#each opt.result.variants as v (v.rank)}
                <tr class:top={v.rank === 1}>
                  <td>{v.rank}</td><td class="tag">{v.tag}</td>
                  <td class="p" title={Object.entries(v.params).map(([k, x]) => `${k} = ${fmt(x)}`).join('\n')}>{Object.entries(v.params).map(([k, x]) => `${k} ${fmt(x)}`).join(' · ')}</td>
                  <td>{(v.metrics.rawWinRate * 100).toFixed(0)}%</td><td class={cls(v.metrics.ret)}>{pct(v.metrics.ret, 0)}</td><td class="dn">{v.metrics.maxDD.toFixed(1)}%</td><td>{v.metrics.trades}</td>
                  <td class={cls(v.metrics.recentRet)}>{pct(v.metrics.recentRet)}</td><td>{v.score.toFixed(3)}</td>
                  <td class="act"><button class="mini" onclick={() => opt.apply(v)}>Apply</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if best}<p class="note">Rank 1 is the best overall mix. "Best win rate", "Best profit" and "Lowest drawdown" are the best single values per category (with enough trades); the other variants trade them off. Return and drawdown are over the whole history, "Last part" is the newest fifth. Optimized on past data: a good variant is a candidate, not a promise.</p>{/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .acc { display: flex; align-items: center; gap: 14px; padding: 8px 14px; flex-wrap: wrap; border-bottom: 1px solid var(--line); flex: none; font-size: 12px; position: relative; }
  .sname { font-size: 13px; } .dim { color: var(--dim); } .m { color: var(--dim); } .m b { color: var(--fg); font-family: ui-monospace, monospace; }
  .bar { flex: 1 1 120px; min-width: 100px; height: 3px; background: var(--line); } .bar i { display: block; height: 100%; background: var(--accent); }
  .primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; padding: 0 16px; height: 30px; font: 700 12px system-ui, sans-serif; cursor: pointer; }
  .primary:disabled { opacity: 0.5; cursor: default; }
  .mini { background: none; border: 1px solid var(--line); color: var(--fg); padding: 4px 10px; font: 600 11px system-ui, sans-serif; cursor: pointer; }
  .mini:hover { border-color: var(--accent); color: var(--accent); }
  .acc .mini { height: 30px; padding: 0 12px; font-size: 12px; }
  .body { flex: 1; min-height: 0; overflow: auto; padding: 0 0 10px; }
  .cols { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 0 4px; align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
  h5 { margin: 12px 14px 4px; font: 700 10.5px system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
  table { width: 100%; border-collapse: collapse; font: 12px ui-monospace, monospace; }
  th { text-align: left; color: var(--dim); font: 600 10.5px system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; padding: 6px 10px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bar); }
  td { padding: 5px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  td.t { max-width: 150px; overflow: hidden; text-overflow: ellipsis; font-family: system-ui, sans-serif; }
  td.p { max-width: 330px; overflow: hidden; text-overflow: ellipsis; color: var(--dim); }
  td.tag { font-family: system-ui, sans-serif; font-weight: 600; }
  tr.off td { opacity: 0.45; } tr.base td { color: var(--dim); font-style: italic; } tr.top td.tag { color: var(--accent); }
  tr:hover td { background: var(--hover); } .act { text-align: right; }
  .in { width: 58px; padding: 3px 5px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12px ui-monospace, monospace; outline: none; box-sizing: border-box; } .in:focus { border-color: var(--accent); }
  input[type='checkbox'] { accent-color: var(--accent); }
  .up { color: var(--up); } .dn { color: var(--down); }
  .note { margin: 8px 14px 0; color: var(--dim); font-size: 11.5px; line-height: 1.5; max-width: 760px; } .err { margin: 8px 14px; color: var(--down); font-size: 12.5px; }
  .empty { padding: 26px; text-align: center; color: var(--fg); } .empty p { margin: 6px 0; } .empty .dim { font-size: 13px; }
  kbd, code { font: 11px ui-monospace, monospace; border: 1px solid var(--line); padding: 1px 6px; }
</style>
