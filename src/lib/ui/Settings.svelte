<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { alpacaKeysSet, saveAlpacaKeys, clearAlpacaKeys, inTauri, newsStatus, saveNewsKey, liquidLogin, liquidLogout, type NewsStatus } from '$lib/api';
  import { t } from '$lib/i18n';

  let keyId = $state(''), secret = $state(''), has = $state(false), msg = $state('');

  let ns = $state<NewsStatus>({ finnhub: false, newsapi: false, alpaca: false, liquid: false, groq: false });
  let fhKey = $state(''), naKey = $state(''), gqKey = $state(''), liquidBusy = $state(false), newsMsg = $state('');
  const refreshNews = () => newsStatus().then((v) => (ns = v));

  $effect(() => { if (app.settingsOpen) { alpacaKeysSet().then((v) => (has = v)); refreshNews(); } });

  async function saveKey(p: 'finnhub' | 'newsapi' | 'groq', v: string) {
    try { await saveNewsKey(p, v); if (p === 'finnhub') fhKey = ''; else if (p === 'newsapi') naKey = ''; else gqKey = ''; newsMsg = ''; await refreshNews(); app.notify(v.trim() ? 'Key saved' : 'Key removed'); }
    catch (e) { newsMsg = String(e); }
  }
  async function connectLiquid() {
    liquidBusy = true; newsMsg = '';
    try { await liquidLogin(); await refreshNews(); app.notify('Liquid connected'); }
    catch (e) { newsMsg = String(e); }
    finally { liquidBusy = false; }
  }
  async function disconnectLiquid() { await liquidLogout(); await refreshNews(); app.notify('Liquid disconnected'); }

  async function save() {
    if (!keyId.trim() || !secret.trim()) return;
    try { await saveAlpacaKeys(keyId, secret); keyId = ''; secret = ''; has = true; msg = ''; app.notify('Alpaca keys saved'); }
    catch (e) { msg = String(e); }
  }
  async function clear() { await clearAlpacaKeys(); has = false; app.notify('Alpaca keys removed'); }
  const close = () => (app.settingsOpen = false);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && app.settingsOpen) close(); }} />

{#if app.settingsOpen}
  <div class="scrim" class:noanim={!app.anim} onpointerdown={close} role="presentation">
    <div class="card" onpointerdown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
      <header><h2>{t('settings', app.lang)}</h2><button class="x" onclick={close} aria-label="Close">×</button></header>

      <section>
        <h3>{t('alpacaKeys', app.lang)}</h3>
        <p class="status" class:ok={has}>{has ? t('keysSet', app.lang) : t('keysNone', app.lang)}</p>
        {#if !inTauri}<p class="warn">Browser preview: keys can only be stored in the desktop app.</p>{/if}
        <label>{t('keyId', app.lang)}<input bind:value={keyId} autocomplete="off" spellcheck="false" placeholder={has ? '••••••••' : 'PK…'} /></label>
        <label>{t('secret', app.lang)}<input bind:value={secret} type="password" autocomplete="off" placeholder={has ? '••••••••' : ''} /></label>
        {#if msg}<p class="warn">{msg}</p>{/if}
        <div class="btns">
          <button class="primary" onclick={save} disabled={!keyId.trim() || !secret.trim()}>{t('save', app.lang)}</button>
          {#if has}<button onclick={clear}>{t('clear', app.lang)}</button>{/if}
        </div>
      </section>

      <section>
        <h3>News providers</h3>
        <p class="status">Always on, no key: Google News, Yahoo Finance, Fed, ECB, MarketWatch, CNBC, Tagesschau, Handelsblatt, Seeking Alpha.{ns.alpaca ? ' Alpaca News uses your Alpaca keys.' : ''}</p>
        <label>Finnhub API key <span class="st" class:ok={ns.finnhub}>{ns.finnhub ? 'saved' : 'not set'}</span>
          <input type="password" bind:value={fhKey} autocomplete="off" placeholder={ns.finnhub ? '••••••••' : 'Key from finnhub.io'} /></label>
        <div class="btns">
          <button class="primary" disabled={!fhKey.trim()} onclick={() => saveKey('finnhub', fhKey)}>{t('save', app.lang)}</button>
          {#if ns.finnhub}<button onclick={() => saveKey('finnhub', '')}>{t('clear', app.lang)}</button>{/if}
        </div>
        <label>NewsAPI key <span class="st" class:ok={ns.newsapi}>{ns.newsapi ? 'saved' : 'not set'}</span>
          <input type="password" bind:value={naKey} autocomplete="off" placeholder={ns.newsapi ? '••••••••' : 'Key from newsapi.org'} /></label>
        <div class="btns">
          <button class="primary" disabled={!naKey.trim()} onclick={() => saveKey('newsapi', naKey)}>{t('save', app.lang)}</button>
          {#if ns.newsapi}<button onclick={() => saveKey('newsapi', '')}>{t('clear', app.lang)}</button>{/if}
        </div>
        <label>Groq API key (AI summaries) <span class="st" class:ok={ns.groq}>{ns.groq ? 'saved' : 'not set'}</span>
          <input type="password" bind:value={gqKey} autocomplete="off" placeholder={ns.groq ? '••••••••' : 'Key from console.groq.com'} /></label>
        <div class="btns">
          <button class="primary" disabled={!gqKey.trim()} onclick={() => saveKey('groq', gqKey)}>{t('save', app.lang)}</button>
          {#if ns.groq}<button onclick={() => saveKey('groq', '')}>{t('clear', app.lang)}</button>{/if}
        </div>
        <label>Liquid MCP <span class="st" class:ok={ns.liquid}>{ns.liquid ? 'connected' : 'not connected'}</span></label>
        <div class="btns">
          {#if ns.liquid}
            <button onclick={disconnectLiquid}>Disconnect</button>
          {:else}
            <button class="primary" disabled={liquidBusy || !inTauri} onclick={connectLiquid}>{liquidBusy ? 'Waiting for browser login…' : 'Connect (opens browser)'}</button>
          {/if}
        </div>
        {#if newsMsg}<p class="warn">{newsMsg}</p>{/if}
      </section>

      {#if app.palette === 'custom'}
        <section>
          <h3>Custom candles</h3>
          <div class="cc">
            <span></span><b>Body</b><b>Border</b><b>Wick</b>
            <span>Bullish</span>
            <input type="color" bind:value={app.custom.upBody} oninput={() => app.persist()} />
            <input type="color" bind:value={app.custom.upBorder} oninput={() => app.persist()} />
            <input type="color" bind:value={app.custom.upWick} oninput={() => app.persist()} />
            <span>Bearish</span>
            <input type="color" bind:value={app.custom.downBody} oninput={() => app.persist()} />
            <input type="color" bind:value={app.custom.downBorder} oninput={() => app.persist()} />
            <input type="color" bind:value={app.custom.downWick} oninput={() => app.persist()} />
          </div>
        </section>
      {/if}

      <section class="grid2">
        <div>
          <h3>{t('theme', app.lang)}</h3>
          <div class="seg">
            <button class:on={app.theme === 'dark'} onclick={() => { app.theme = 'dark'; app.persist(); }}>{t('dark', app.lang)}</button>
            <button class:on={app.theme === 'light'} onclick={() => { app.theme = 'light'; app.persist(); }}>{t('light', app.lang)}</button>
          </div>
        </div>
        <div>
          <h3>{t('language', app.lang)}</h3>
          <div class="seg">
            <button class:on={app.lang === 'en'} onclick={() => { app.lang = 'en'; app.persist(); }}>English</button>
            <button class:on={app.lang === 'de'} onclick={() => { app.lang = 'de'; app.persist(); }}>Deutsch</button>
          </div>
        </div>
        <div>
          <h3>Candles</h3>
          <div class="seg">
            {#each ['neon', 'mono', 'classic', 'custom'] as pl}
              <button class:on={app.palette === pl} onclick={() => { app.palette = pl as typeof app.palette; app.persist(); }}>{pl}</button>
            {/each}
          </div>
        </div>
        <div>
          <h3>Indicator parameters</h3>
          <div class="seg">
            <button class:on={app.showParams} onclick={() => { app.showParams = true; app.persist(); }}>Show</button>
            <button class:on={!app.showParams} onclick={() => { app.showParams = false; app.persist(); }}>Hide</button>
          </div>
        </div>
        <div>
          <h3>{t('animations', app.lang)}</h3>
          <div class="seg">
            <button class:on={app.anim} onclick={() => { app.anim = true; app.persist(); }}>On</button>
            <button class:on={!app.anim} onclick={() => { app.anim = false; app.persist(); }}>Off</button>
          </div>
        </div>
      </section>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55); -webkit- animation: fade 0.2s ease both; }
  .card { width: min(520px, calc(100vw - 32px)); max-height: 86vh; overflow: auto; border-radius: 2px; padding: 22px 24px; background: var(--glass); border: 1px solid var(--glass-line); -webkit- box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.22), 0 30px 90px rgba(0, 0, 0, 0.7); animation: pop 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .noanim, .noanim .card { animation: none !important; }
  @keyframes fade { from { opacity: 0 } }
  @keyframes pop { from { opacity: 0; transform: scale(0.94); } }
  header { display: flex; justify-content: space-between; align-items: center; }
  h2 { margin: 0; font-size: 19px; } h3 { margin: 18px 0 8px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
  .x { background: none; border: 0; color: var(--dim); font-size: 24px; cursor: pointer; }
  .x:hover { color: var(--fg); }
  label { display: block; font-size: 12px; color: var(--dim); margin-top: 10px; }
  input { display: block; width: 100%; box-sizing: border-box; margin-top: 5px; padding: 10px 12px; border-radius: 2px; border: 1px solid var(--glass-line); background: rgba(0, 0, 0, 0.35); color: var(--fg); font: 14px ui-monospace, monospace; outline: none; }
  input:focus { border-color: var(--accent); }
  .st { color: var(--dim); font-size: 11px; margin-left: 8px; } .st.ok { color: var(--up); }
  .status { margin: 0; font-size: 13px; color: var(--dim); } .status.ok { color: var(--up); }
  .warn { color: var(--down); font-size: 12.5px; margin: 8px 0 0; }
  .btns { display: flex; gap: 10px; margin-top: 14px; }
  button { font: 600 13px system-ui, sans-serif; padding: 9px 16px; border-radius: 2px; border: 1px solid var(--glass-line); background: rgba(255, 255, 255, 0.05); color: var(--fg); cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; } button:disabled { opacity: 0.4; cursor: default; }
  .cc { display: grid; grid-template-columns: 80px repeat(3, 1fr); gap: 8px 10px; align-items: center; font-size: 12px; color: var(--dim); }
  .cc b { font-weight: 600; text-align: center; }
  .cc input[type='color'] { width: 100%; height: 30px; padding: 0; margin: 0; border: 1px solid var(--glass-line); background: none; cursor: pointer; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0 18px; }
  .seg { display: flex; border: 1px solid var(--glass-line); border-radius: 2px; overflow: hidden; }
  .seg button { flex: 1; border: 0; border-radius: 0; background: none; padding: 8px 10px; }
  .seg button.on { background: var(--accent); color: #fff; }
</style>
