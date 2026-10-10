import type { ExerciseId } from './types';

const SVG_ATTR =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

/** Unique header glyph per exercise — keep paths distinct across labs. */
export function exerciseHeaderIconSvg(id: ExerciseId): string {
  switch (id) {
    case 1:
      // Rule branches / decision tree
      return `<svg ${SVG_ATTR}><path d="M6 4v6"/><path d="M6 10h8"/><path d="M14 7v6"/><path d="M14 13h4"/><circle cx="6" cy="4" r="1.6" fill="currentColor" stroke="none"/><circle cx="14" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1.6" fill="currentColor" stroke="none"/><path d="M6 10v6"/><circle cx="6" cy="18" r="1.6" fill="currentColor" stroke="none"/></svg>`;
    case 2:
      // Logistic sigmoid curve
      return `<svg ${SVG_ATTR}><path d="M3 19h18"/><path d="M3 16c3.2 0 4.2-11 9-11s5.8 11 9 11"/><circle cx="12" cy="10.5" r="1.6" fill="currentColor" stroke="none"/></svg>`;
    case 3:
      // Confusion matrix, four cells
      return `<svg ${SVG_ATTR}><rect x="3" y="3" width="8" height="8" rx="1.4"/><rect x="13" y="3" width="8" height="8" rx="1.4"/><rect x="3" y="13" width="8" height="8" rx="1.4"/><rect x="13" y="13" width="8" height="8" rx="1.4"/></svg>`;
    case 4:
      // Image frame
      return `<svg ${SVG_ATTR}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M3 16l5-4 4 3 3-2 6 4"/></svg>`;
    case 4.5:
      // Live camera / viewfinder
      return `<svg ${SVG_ATTR}><path d="M4 9V7a2 2 0 0 1 2-2h2M16 5h2a2 2 0 0 1 2 2v2M20 15v2a2 2 0 0 1-2 2h-2M8 19H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.2"/><path d="M9 5l1.2-1.5h3.6L15 5"/></svg>`;
    case 5:
      // Tokens / hash chips
      return `<svg ${SVG_ATTR}><path d="M4 8h16M4 16h16M9 4l-2 16M17 4l-2 16"/></svg>`;
    case 6:
      // Two embedding vectors
      return `<svg ${SVG_ATTR}><circle cx="7" cy="8" r="2.4"/><circle cx="17" cy="16" r="2.4"/><path d="M9 9.2 15 14.8"/><path d="M7 14v4M5 16h4"/><path d="M17 6v4M15 8h4"/></svg>`;
    case 7:
      // Dial / knob
      return `<svg ${SVG_ATTR}><circle cx="12" cy="13" r="7"/><path d="M12 13V8"/><path d="M8.2 5.8a9 9 0 0 1 7.6 0"/><circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none"/></svg>`;
    case 8:
      // Persona / face
      return `<svg ${SVG_ATTR}><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.2a6.5 6.5 0 0 1 13 0"/><path d="M9.2 8.2c.4.6 1.1 1 1.8 1s1.4-.4 1.8-1"/></svg>`;
    case 9:
      // Side-by-side model compare
      return `<svg ${SVG_ATTR}><rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="5" width="7" height="14" rx="1.5"/><path d="M6.5 9h0.01M6.5 12h0.01M6.5 15h0.01M17.5 9h0.01M17.5 12h0.01M17.5 15h0.01"/></svg>`;
    case 10:
      // Context window / capacity
      return `<svg ${SVG_ATTR}><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M3 12h11"/><path d="M17.5 10.5v3M19.5 10.5v3"/><path d="M14 7V5M14 19v-2"/></svg>`;
    case 11:
      // RAG: document + search
      return `<svg ${SVG_ATTR}><path d="M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14 4v4h4"/><circle cx="11" cy="13" r="2.4"/><path d="M12.8 14.8 15.2 17.2"/></svg>`;
    case 12:
      // Pipeline / stacked layers (distinct from Ex11 doc+search)
      return `<svg ${SVG_ATTR}><rect x="4" y="4" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="16" width="16" height="4" rx="1"/><path d="M8 6h0.01M8 12h0.01M8 18h0.01"/></svg>`;
    case 13:
      // Agent + tool wrench
      return `<svg ${SVG_ATTR}><circle cx="9" cy="10" r="3.2"/><path d="M4.5 19.2a4.8 4.8 0 0 1 9 0"/><path d="M15.2 7.2 18 4.4a2 2 0 0 1 2.8 2.8l-2.8 2.8"/><path d="M14.5 12.5 20 18"/><path d="M13.2 9.2l1.8 1.8"/></svg>`;
    case 14:
      // Balance / ethics scales
      return `<svg ${SVG_ATTR}><path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 7a4 4 0 0 0 6 0z"/><path d="M19 7l-3 7a4 4 0 0 0 6 0z"/></svg>`;
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export function exerciseHeaderIconHtml(id: ExerciseId): string {
  return `<span class="ex-lab-brand-icon" aria-hidden="true">${exerciseHeaderIconSvg(id)}</span>`;
}

/** Brand block for mount labs that previously used a lime dot. */
export function exerciseBrandHtml(id: ExerciseId, titleHtml: string): string {
  return `<div class="ex-lab-brand brand">${exerciseHeaderIconHtml(id)}<h1 class="ex-lab-brand-title">${titleHtml}</h1></div>`;
}
