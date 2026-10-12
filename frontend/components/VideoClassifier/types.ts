export interface Sample {
  id: string;
  thumb: string; // 224 px JPEG data URL
  embedding: Float32Array;
}

export interface ClassData {
  id: string;
  name: string;
  color: string;
  samples: Sample[];
  disabled: boolean;
}

export const PALETTE = ['#9333ea', '#ec4899', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#6366f1', '#14b8a6', '#a855f7', '#f97316'];

export const newId = () => Math.random().toString(36).slice(2, 10);

export const SAMPLE_NOTE = 'Upload only public or sample documents.';

/** samples.json, saved with "Also save my training images". */
export interface SamplesManifest {
  version: 1;
  classes: { name: string; color: string; disabled: boolean; samples: string[] }[];
}
