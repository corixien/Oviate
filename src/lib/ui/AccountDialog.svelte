<script lang="ts">
  import { paper } from '$lib/paper/paper.svelte';
  import { app } from '$lib/app.svelte';

  let name = $state('');
  let capital = $state('100000');
  let leverage = $state('1');
  let commission = $state('0');
  let error = $state('');

  $effect(() => { if (paper.accountDialog) { name = `Paper ${paper.accounts.length + 1}`; capital = '100000'; leverage = '1'; commission = '0'; error = ''; } });

  const close = () => (paper.accountDialog = false);
  function create() {
    const c = parseFloat(capital), l = parseFloat(leverage), f = parseFloat(commission);
    if (!(c > 0)) { error = 'Initial capital must be greater than zero'; return; }
    if (!(l >= 1 && l <= 100)) { error = 'Leverage must be between 1 and 100'; return; }
    if (!(f >= 0 && f < 10)) { error = 'Commission must be between 0 and 10 percent'; return; }
    paper.create(name, c, l, f);
    paper.panelOpen = true;
    app.notify('Paper account created');
    close();
  }
</script>

<svelte:window onkeydown={(e) => { if (paper.accountDialog) { if (e.key === 'Escape') close(); else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') create(); } }} />

{#if paper.accountDialog}
  <div class="scrim" onpointerdown={close} role="presentation">
    <div class="card" onpointerdown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-label="New paper account">
      <header><h2>New paper account</h2><button class="x" onclick={close} aria-label="Close">×</button></header>
      <section>
        <label>Name<input bind:value={name} spellcheck="false" /></label>
        <label>Initial capital (USD)<input type="number" min="1" step="any" bind:value={capital} /></label>
        <label>Leverage <small>1x = no leverage. Buying power = equity × leverage</small>
          <input type="number" min="1" max="100" step="1" bind:value={leverage} /></label>
        <label>Commission per fill (% of trade value)<input type="number" min="0" max="10" step="0.01" bind:value={commission} /></label>
        {#if error}<p class="err">{error}</p>{/if}
      </section>
      <footer><button onclick={close}>Cancel</button><button class="primary" onclick={create}>Create account</button></footer>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 96; display: grid; place-items: center; background: rgba(0, 0, 0, 0.7); animation: fade 0.15s ease both; }
  .card { width: min(440px, calc(100vw - 32px)); background: var(--glass); border: 1px solid var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 0 40px rgba(157, 77, 255, 0.25); animation: pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  @keyframes fade { from { opacity: 0 } } @keyframes pop { from { opacity: 0; transform: scale(0.95); } }
  header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  h2 { margin: 0; font-size: 16px; } .x { background: none; border: 0; color: var(--dim); font-size: 22px; cursor: pointer; } .x:hover { color: var(--fg); }
  section { padding: 8px 18px 14px; }
  label { display: flex; flex-direction: column; gap: 5px; margin-top: 12px; font-size: 12px; color: var(--dim); }
  label small { color: var(--dim); font-size: 11px; opacity: 0.8; }
  input { background: #000; border: 1px solid var(--line); color: var(--fg); padding: 9px 10px; font: 14px ui-monospace, monospace; outline: none; }
  input:focus { border-color: var(--accent); }
  .err { color: var(--down); font-size: 12.5px; margin: 10px 0 0; }
  footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--line); }
  footer button { font: 600 13px system-ui, sans-serif; padding: 8px 16px; border: 1px solid var(--glass-line); background: none; color: var(--fg); cursor: pointer; }
  footer button:hover { border-color: var(--accent); } footer .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
