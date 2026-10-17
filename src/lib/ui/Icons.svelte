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
    gear: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h0M3 12h0M3 18h0',
    ind: 'M3 17l5-6 4 3 5-8 4 4',
    search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
    candle: 'M7 4v16M7 8h0M17 6v14M5 8h4v8H5zM15 9h4v7h-4z',
    plus: 'M12 5v14M5 12h14',
    sync: 'M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5M18 3v4h-4M6 21v-4h4'
  };
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d={P[name] ?? ''} /></svg>
