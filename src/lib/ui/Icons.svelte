<script lang="ts">
  let { name, size = 18 }: { name: string; size?: number } = $props();
  const P: Record<string, string> = {
    cursor: 'M5 3l14 7-6 2-2 6z',
    trend: 'M4 19L20 5M4 19h0M20 5h0',
    ray: 'M4 19L22 4',
    arrow: 'M4 20L19 5M19 5h-7M19 5v7',
    hline: 'M3 12h18M12 12h0',
    vline: 'M12 3v18',
    rect: 'M5 6h14v12H5z',
    fib: 'M4 5h16M4 10h16M4 14h16M4 19h16',
    text: 'M6 6h12M12 6v13M9 19h6',
    measure: 'M3 17l4-4 4 4 4-8 4 4M3 21h18',
    magnet: 'M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    layout: 'M4 4h16v16H4zM12 4v16M4 12h16',
    gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
    crosshair: 'M12 3v5M12 16v5M3 12h5M16 12h5M12 10a2 2 0 100 4 2 2 0 000-4z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h0M3 12h0M3 18h0',
    ind: 'M3 17l5-6 4 3 5-8 4 4',
    search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
    candle: 'M7 4v16M7 8h0M17 6v14M5 8h4v8H5zM15 9h4v7h-4z',
    plus: 'M12 5v14M5 12h14',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
    eyeoff: 'M3 3l18 18M10.6 6.2A9.6 9.6 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.7M6.5 7.6A17 17 0 002 12s4 6 10 6a9.6 9.6 0 004-.9',
    braces: 'M8 4c-2 0-3 1-3 3v2c0 1.5-1 3-3 3 2 0 3 1.5 3 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 3 3 3-2 0-3 1.5-3 3v2c0 2-1 3-3 3',
    more: 'M5 12h0M12 12h0M19 12h0',
    news: 'M4 5h13v14H6a2 2 0 01-2-2V5zM17 8h3v9a2 2 0 01-2 2M7 9h7M7 13h7M7 16h4',
    sync: 'M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5M18 3v4h-4M6 21v-4h4'
  };
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d={P[name] ?? ''} /></svg>
