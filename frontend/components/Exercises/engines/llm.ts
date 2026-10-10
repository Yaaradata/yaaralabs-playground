import { mulberry32 } from './text';

export interface SimGenerateArgs {
  prompt: string;
  system?: string;
  examples?: { user: string; assistant: string }[];
  model?: string;
  temperature?: number;
  n?: number;
}

function styleForModel(model: string): string {
  if (model === 'gemini-2.5-pro') {
    return 'Structured reasoning, complete sentences, and explicit caveats.';
  }
  return 'Short, slightly incomplete lab notes.';
}

export function simulateGenerate(args: SimGenerateArgs): string[] {
  const n = args.n ?? 1;
  const temperature = args.temperature ?? 0.7;
  const model = args.model ?? 'gemini-2.5-flash-lite';
  const seed = Math.abs(
    Array.from(`${args.prompt}|${args.system}|${model}|${temperature}`).reduce(
      (h, ch) => ((h << 5) - h + ch.charCodeAt(0)) | 0,
      0,
    ),
  );
  const rng = mulberry32(seed || 1);
  const exampleHint = args.examples?.[args.examples.length - 1]?.assistant?.split('.')[0] || '';
  const persona = (args.system || '').trim();
  const outputs: string[] = [];
  for (let i = 0; i < n; i += 1) {
    let text =
      `Answer to: ${args.prompt.trim().slice(0, 240)}\n\n` +
      `${styleForModel(model)}\n` +
      `- Restate the ask.\n- Follow the instructions.\n- Stay classroom-safe.`;
    if (persona) text = `[Persona] ${persona.slice(0, 180)}\n\n${text}`;
    if (exampleHint) text += `\n\nMatching example style: ${exampleHint.slice(0, 140)}.`;
    if (model === 'gemini-2.5-pro') {
      text += '\n\nReasoning: identify the goal, apply constraints, then answer fully.';
    }
    if (temperature <= 0.2) {
      outputs.push(text);
      continue;
    }
    if (model !== 'gemini-2.5-pro' && rng() > 0.65) {
      text += '\n\n(Shorter model may skip a supporting detail.)';
    }
    const extras = [
      'High temperature added a metaphor: ideas are like sparks in a dark lab.',
      'Creative variant: tell it as a 2-line poem.',
      'Random flourish: mention a rubber duck debugger.',
      'Less consistent draft: wording wandered a little.',
      'Optional tangent: imagine presenting this to a school science fair.',
    ];
    const extra = extras[(Math.floor(rng() * extras.length) + i) % extras.length];
    outputs.push(`${text}\n\n#${i + 1} ${extra}`);
  }
  return outputs;
}

export function uniqueness(outputs: string[]): number {
  const set = new Set(outputs.map((o) => o.replace(/\s+/g, ' ').trim().toLowerCase()));
  return outputs.length === 0 ? 0 : set.size / outputs.length;
}
