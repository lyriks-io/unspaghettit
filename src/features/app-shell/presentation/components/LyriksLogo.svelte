<script lang="ts">
  // Official Lyriks v3 logomark: three stacked gradient bars.
  let { size = 28, class: klass = '' }: { size?: number; class?: string } = $props();
  const blue = 'lyriks-logo-blue';
  const fuchsia = 'lyriks-logo-fuchsia';
  const amber = 'lyriks-logo-amber';
</script>

<svg
  class={klass}
  width={size}
  height={size}
  viewBox="0 0 12.7 12.7"
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  aria-label="Lyriks"
>
  <defs>
    <linearGradient
      id={blue}
      x1="433.33047"
      y1="223.41049"
      x2="432.65369"
      y2="484.82812"
      gradientUnits="userSpaceOnUse"
      gradientTransform="matrix(0.26458333,0,0,0.26458333,-82.110177,-99.957753)"
    >
      <stop offset="0" stop-color="#0066ff" stop-opacity="1" />
      <stop offset="1" stop-color="#0066ff" stop-opacity="0" />
    </linearGradient>
    <linearGradient
      id={fuchsia}
      x1="432.83047"
      y1="323.48856"
      x2="433.53754"
      y2="146.35829"
      gradientUnits="userSpaceOnUse"
      gradientTransform="matrix(0.26458333,0,0,0.26458333,-82.110177,-99.957753)"
    >
      <stop offset="0" stop-color="#bb46f5" stop-opacity="1" />
      <stop offset="1" stop-color="#bb46f5" stop-opacity="0" />
    </linearGradient>
    <linearGradient
      id={amber}
      x1="22.477682"
      y1="34.598564"
      x2="21.553013"
      y2="86.671013"
      gradientUnits="userSpaceOnUse"
      gradientTransform="translate(12.832291,-41.407291)"
    >
      <stop offset="0" stop-color="#ffa101" stop-opacity="1" />
      <stop offset="1" stop-color="#ffa101" stop-opacity="0" />
    </linearGradient>
  </defs>
  <g transform="translate(0,-284.3)">
    <g transform="matrix(0.43489873,0,0,0.40888801,-9.9205419,298.38648)">
      <rect
        width="29.185829"
        height="7.0625973"
        x="22.823183"
        y="-10.439077"
        style="fill:url(#{amber});stroke-width:0.29681981"
      />
      <path
        style="fill:url(#{blue});stroke-width:0.09354433"
        d="m 22.821255,-30.364151 v -4.069178 h 9.494747 9.494751 v 4.069178 4.069178 h -9.494751 -9.494747 z"
      />
      <path
        style="fill:url(#{fuchsia});stroke-width:0.09354433"
        d="m 22.821255,-18.343704 v -4.022408 h 9.494747 9.494751 v 4.022408 4.022404 h -9.494751 -9.494747 z"
      />
    </g>
  </g>
</svg>
