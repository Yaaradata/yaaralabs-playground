/** Shared SVG figure — solid fills avoid gradient-id collisions when many buddies mount. */
export const LAB_BUDDY_SVG = `<svg class="lab-buddy-svg" viewBox="0 0 120 140" aria-hidden="true" focusable="false">
  <ellipse class="lab-buddy-floor" cx="60" cy="132" rx="26" ry="4"/>
  <g class="lab-buddy-fig">
    <path class="lab-buddy-arm lab-buddy-arm-l" d="M34 92c-8 2-14 12-14 22 0 8 3 13 7 13s5-4 6-11l3-20c1-3-1-5-2-4z" fill="#a8b0bc"/>
    <path class="lab-buddy-arm lab-buddy-arm-r" d="M86 92c8 2 14 12 14 22 0 8-3 13-7 13s-5-4-6-11l-3-20c-1-3 1-5 2-4z" fill="#a8b0bc"/>
    <ellipse cx="60" cy="100" rx="28" ry="26" fill="#eef1f5"/>
    <ellipse cx="60" cy="104" rx="28" ry="22" fill="#d5dae2" opacity=".55"/>
    <path d="M36 100h16v5h16v-5h16" fill="none" stroke="#9aa3b0" stroke-width="1.4" stroke-linejoin="round"/>
    <ellipse cx="46" cy="88" rx="5" ry="8" fill="#fff" opacity=".75" transform="rotate(26 46 88)"/>
    <rect x="52" y="72" width="16" height="12" rx="5" fill="#c5cad3"/>
    <g class="lab-buddy-head">
      <rect x="48" y="10" width="24" height="10" rx="5" fill="#f4f6f8"/>
      <rect x="10" y="30" width="12" height="24" rx="6" fill="#b4bcc8"/>
      <rect x="98" y="30" width="12" height="24" rx="6" fill="#b4bcc8"/>
      <rect x="18" y="16" width="84" height="52" rx="22" fill="#f7f8fa"/>
      <rect x="20" y="18" width="80" height="24" rx="18" fill="#fff" opacity=".35"/>
      <rect class="lab-buddy-visor" x="26" y="24" width="68" height="36" rx="14" fill="#15202c"/>
      <path d="M32 30c10-3 28-4 40-2" stroke="#fff" stroke-opacity=".14" stroke-width="2.5" stroke-linecap="round" fill="none"/>
      <g class="lab-buddy-faces" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <g class="lab-buddy-face" data-face="sleep">
          <path class="lb-eye" d="M40 42h12M68 42h12" stroke-width="3.2"/>
          <path class="lb-mouth" d="M54 50h12" stroke-width="2.4"/>
          <text class="lb-zzz" x="86" y="22" font-size="11" font-family="ui-rounded,system-ui,sans-serif" font-weight="700">z</text>
        </g>
        <g class="lab-buddy-face" data-face="idle">
          <circle class="lb-eye" cx="46" cy="40" r="4.2" fill="currentColor" stroke="none"/>
          <circle class="lb-eye" cx="74" cy="40" r="4.2" fill="currentColor" stroke="none"/>
          <path class="lb-mouth" d="M52 50h16" stroke-width="2.6"/>
        </g>
        <g class="lab-buddy-face" data-face="listen">
          <circle class="lb-eye" cx="46" cy="41" r="5" fill="currentColor" stroke="none"/>
          <circle class="lb-eye" cx="74" cy="41" r="5" fill="currentColor" stroke="none"/>
          <ellipse class="lb-mouth" cx="60" cy="51" rx="5" ry="3.2" fill="currentColor" stroke="none" opacity=".9"/>
        </g>
        <g class="lab-buddy-face" data-face="type">
          <rect class="lb-eye" x="40" y="38" width="12" height="5" rx="2.5" fill="currentColor" stroke="none"/>
          <rect class="lb-eye" x="68" y="38" width="12" height="5" rx="2.5" fill="currentColor" stroke="none"/>
          <path class="lb-mouth" d="M50 50h20" stroke-width="2.4"/>
        </g>
        <g class="lab-buddy-face" data-face="think">
          <circle class="lb-eye" cx="48" cy="38" r="3.6" fill="currentColor" stroke="none"/>
          <circle class="lb-eye" cx="72" cy="36" r="3.6" fill="currentColor" stroke="none"/>
          <circle class="lb-mouth" cx="62" cy="50" r="2.4" fill="currentColor" stroke="none"/>
          <circle class="lb-dot" cx="88" cy="22" r="2.2" fill="currentColor" stroke="none" opacity=".85"/>
          <circle class="lb-dot" cx="94" cy="16" r="1.6" fill="currentColor" stroke="none" opacity=".6"/>
        </g>
        <g class="lab-buddy-face" data-face="speak">
          <circle class="lb-eye" cx="46" cy="39" r="4.4" fill="currentColor" stroke="none"/>
          <circle class="lb-eye" cx="74" cy="39" r="4.4" fill="currentColor" stroke="none"/>
          <ellipse class="lb-mouth lb-talk" cx="60" cy="51" rx="6" ry="4.5" fill="currentColor" stroke="none"/>
        </g>
        <g class="lab-buddy-face" data-face="cheer">
          <path class="lb-eye" d="M40 43q6-9 12 0" stroke-width="3.4"/>
          <path class="lb-eye" d="M68 43q6-9 12 0" stroke-width="3.4"/>
          <path class="lb-mouth" d="M50 48q10 12 20 0" stroke-width="3"/>
        </g>
        <g class="lab-buddy-face" data-face="wait">
          <path class="lb-eye" d="M40 36l12 5M68 41l12-5" stroke-width="3.2"/>
          <path class="lb-mouth" d="M50 52q10-8 20 0" stroke-width="2.8"/>
        </g>
      </g>
    </g>
  </g>
</svg>`;
