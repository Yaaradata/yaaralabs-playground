import type { DatasetMeta, ModelId, ParamMap, ParamValue } from "./types";
import { num, sameVal } from "./format";

export interface ParamSpec {
  k: string;
  label: string;
  opts: ParamValue[];
  lbl?: Record<string, string>;
  def: ParamValue;
  help: string;
  effect: (value: ParamValue) => string;
}

export interface ModelSpec {
  name: string;
  short: string;
  fam: string;
  tf: boolean;
  how: string;
  stepName: string;
  params: ParamSpec[];
}

const knnMetric: Record<string, string> = {
  euclidean: "Straight-line distance between all pixel values: the classic choice.",
  manhattan: "Adds up pixel differences: less thrown by a few very different pixels.",
  cosine: "Compares the pattern and ignores overall brightness.",
};

const actText: Record<string, string> = {
  relu: "Fast to train; the modern default.",
  tanh: "Smooth, centred on zero; trains a bit slower.",
  sigmoid: "Squashes to 0–1; the slowest to learn in deep stacks.",
};

export const MODELS: Record<ModelId, ModelSpec> = {
  knn: {
    name: "k-Nearest Neighbours",
    short: "k-NN",
    fam: "Classic ML",
    tf: false,
    how: "Keeps every training image in memory. To label a new image it finds the k most similar training images and lets them vote.",
    stepName: "test images checked",
    params: [
      {
        k: "k",
        label: "Neighbours (k)",
        opts: [1, 3, 5, 7, 11, 15],
        def: 11,
        help: "How many of the most similar training images get a vote.",
        effect: (value) =>
          value === 1
            ? "Copies the single closest image: sharp, but one odd training image can fool it."
            : Number(value) >= 11
              ? "Many voters smooth things out, but a small class can get outvoted."
              : "A balanced vote between noise and smoothing.",
      },
      {
        k: "metric",
        label: "Distance measure",
        opts: ["euclidean", "manhattan", "cosine"],
        lbl: { euclidean: "Euclidean", manhattan: "Manhattan", cosine: "Cosine" },
        def: "euclidean",
        help: "How “similar” is measured between two images.",
        effect: (value) => knnMetric[String(value)] ?? "",
      },
      {
        k: "weights",
        label: "Vote weighting",
        opts: ["uniform", "distance"],
        lbl: { uniform: "Equal votes", distance: "Closer counts more" },
        def: "uniform",
        help: "Whether nearer neighbours get a bigger say.",
        effect: (value) =>
          value === "uniform" ? "Every neighbour’s vote counts the same." : "The closest look-alikes carry the most weight.",
      },
    ],
  },
  svm: {
    name: "Linear SVM",
    short: "SVM",
    fam: "Classic ML",
    tf: false,
    how: "Learns one straight boundary per class (a weight for every pixel), pushed to leave the widest possible margin between that class and the rest.",
    stepName: "epoch",
    params: [
      {
        k: "C",
        label: "C (margin strictness)",
        opts: [0.01, 0.1, 1, 10],
        def: 0.01,
        help: "How hard it tries to get every training image right.",
        effect: (value) =>
          Number(value) <= 0.01
            ? "Very soft margin: simple boundaries that may underfit."
            : Number(value) >= 10
              ? "Strict margin: chases every training image and may overfit."
              : "A middle ground between a wide margin and few training mistakes.",
      },
      {
        k: "epochs",
        label: "Epochs",
        opts: [5, 8, 10, 20, 30],
        def: 8,
        help: "Passes over the training images.",
        effect: (value) => `${value} passes. More passes let the boundaries settle, up to a point.`,
      },
      {
        k: "lr",
        label: "Learning rate",
        opts: [0.001, 0.005, 0.01, 0.05],
        def: 0.005,
        help: "Size of each correction step.",
        effect: (value) =>
          Number(value) >= 0.05
            ? "Big steps: fast, but accuracy may zig-zag."
            : Number(value) <= 0.001
              ? "Tiny steps: steady but slow to settle."
              : "Moderate, steady steps.",
      },
      {
        k: "scale",
        label: "Standardise pixels",
        opts: ["on", "off"],
        lbl: { on: "On", off: "Off" },
        def: "on",
        help: "Rescale each pixel to mean 0 and spread 1 first.",
        effect: (value) =>
          value === "on" ? "Every pixel is on the same scale: usually trains better." : "Uses the raw 0–1 pixel values.",
      },
    ],
  },
  rf: {
    name: "Random Forest",
    short: "Forest",
    fam: "Classic ML",
    tf: false,
    how: "Grows many decision trees, each from a random sample of images and pixels, then lets the trees vote.",
    stepName: "trees grown",
    params: [
      {
        k: "trees",
        label: "Number of trees",
        opts: [10, 25, 50, 100],
        def: 25,
        help: "How many trees vote.",
        effect: (value) =>
          Number(value) <= 10
            ? "Few voters: quick, but the vote is noisy."
            : Number(value) >= 100
              ? "A big, stable vote; takes longer."
              : "A solid vote at a reasonable speed.",
      },
      {
        k: "depth",
        label: "Max depth",
        opts: [4, 8, 12, 16],
        def: 8,
        help: "How many yes/no questions a tree may ask in a row.",
        effect: (value) =>
          Number(value) <= 4
            ? "Shallow trees: very general rules, may underfit."
            : Number(value) >= 16
              ? "Deep trees memorise details; the vote keeps overfitting in check."
              : "Enough questions to separate most classes.",
      },
      {
        k: "mtry",
        label: "Pixels tried per split",
        opts: ["sqrt", "log2", "10%"],
        lbl: { sqrt: "√n (64)", log2: "log₂ n (12)", "10%": "10% (410)" },
        def: "sqrt",
        help: "At each question, how many random pixels are considered.",
        effect: (value) =>
          value === "log2"
            ? "Very random trees: more varied, each one weaker."
            : value === "10%"
              ? "Better individual trees, but more alike and slower."
              : "The standard choice for classification.",
      },
      {
        k: "leaf",
        label: "Min images per leaf",
        opts: [1, 2, 5, 10],
        def: 5,
        help: "The smallest group a tree may end on.",
        effect: (value) =>
          value === 1
            ? "Leaves can hold a single image: most detailed."
            : Number(value) >= 10
              ? "Leaves must hold 10 images: smoother, simpler trees."
              : "Small leaves, a little smoothing.",
      },
      {
        k: "boot",
        label: "Bootstrap sampling",
        opts: ["on", "off"],
        lbl: { on: "On", off: "Off" },
        def: "on",
        help: "Each tree trains on a random resample of the images.",
        effect: (value) =>
          value === "on"
            ? "Every tree sees a slightly different dataset: the key to a diverse forest."
            : "Every tree sees all images; only the pixel choice varies.",
      },
    ],
  },
  mlp: {
    name: "MLP (dense network)",
    short: "MLP",
    fam: "Neural network",
    tf: true,
    how: "Every pixel connects to a layer of neurons, which connect to one output per class. Learns by gradient descent (Adam).",
    stepName: "epoch",
    params: [
      {
        k: "layers",
        label: "Hidden layers",
        opts: [1, 2],
        def: 1,
        help: "How many layers of neurons sit between pixels and answer.",
        effect: (value) =>
          value === 1
            ? "One hidden layer: learns simple stroke and blob detectors."
            : "Two layers: combines simple detectors into bigger shapes.",
      },
      {
        k: "units",
        label: "Neurons per layer",
        opts: [32, 64, 128, 256],
        def: 64,
        help: "Width of each hidden layer.",
        effect: (value) =>
          Number(value) <= 32
            ? "A narrow network: fast, limited capacity."
            : Number(value) >= 256
              ? "Very wide: can learn a lot, and can overfit a small dataset."
              : "Plenty of capacity for these images.",
      },
      {
        k: "act",
        label: "Activation",
        opts: ["relu", "tanh", "sigmoid"],
        lbl: { relu: "ReLU", tanh: "tanh", sigmoid: "Sigmoid" },
        def: "relu",
        help: "The bend each neuron applies to its input.",
        effect: (value) => actText[String(value)] ?? "",
      },
      {
        k: "dropout",
        label: "Dropout",
        opts: [0, 0.2, 0.4],
        lbl: { 0: "Off", "0.2": "20%", "0.4": "40%" },
        def: 0.4,
        help: "Randomly switches off neurons while training.",
        effect: (value) =>
          value === 0
            ? "No dropout: fastest, most likely to overfit."
            : Number(value) >= 0.4
              ? "Heavy dropout: strong protection, slower to learn."
              : "Light protection against memorising.",
      },
      {
        k: "epochs",
        label: "Epochs",
        opts: [5, 8, 12, 20],
        def: 8,
        help: "Passes over the training images.",
        effect: (value) => `${value} passes over the data.`,
      },
      {
        k: "lr",
        label: "Learning rate (Adam)",
        opts: [0.0005, 0.001, 0.005],
        def: 0.001,
        help: "Size of each update.",
        effect: (value) =>
          Number(value) >= 0.005
            ? "Big steps: fast start, can overshoot."
            : Number(value) <= 0.0005
              ? "Small steps: stable but slow."
              : "The usual Adam default.",
      },
      {
        k: "batch",
        label: "Batch size",
        opts: [16, 32, 64],
        def: 32,
        help: "Images averaged per update.",
        effect: (value) =>
          Number(value) <= 16
            ? "Small batches: noisier, more frequent updates."
            : Number(value) >= 64
              ? "Large batches: smoother, fewer updates."
              : "A common middle ground.",
      },
    ],
  },
  cnn: {
    name: "Simple CNN (LeNet-style)",
    short: "CNN",
    fam: "Neural network",
    tf: true,
    how: "Small filters slide across the image to find edges and textures, pooling shrinks the map, then a dense layer makes the call.",
    stepName: "epoch",
    params: [
      {
        k: "filters",
        label: "Filters (first layer)",
        opts: [4, 8, 16],
        def: 4,
        help: "Pattern detectors in layer 1; layer 2 gets twice as many.",
        effect: (value) =>
          Number(value) <= 4
            ? "Few detectors: fast, may miss textures."
            : Number(value) >= 16
              ? "Many detectors: richer features, slower."
              : "A good starting set of detectors.",
      },
      {
        k: "kernel",
        label: "Filter size",
        opts: [3, 5],
        lbl: { 3: "3×3", 5: "5×5" },
        def: 3,
        help: "The patch each filter looks at.",
        effect: (value) => (value === 3 ? "Small patches: fine edges and dots." : "Bigger patches: broader strokes and blobs."),
      },
      {
        k: "pool",
        label: "Pooling",
        opts: ["max", "avg"],
        lbl: { max: "Max", avg: "Average" },
        def: "max",
        help: "How each 2×2 area is shrunk to one value.",
        effect: (value) =>
          value === "max"
            ? "Keeps the strongest response: sharp features survive."
            : "Averages the area: smoother, keeps faint texture.",
      },
      {
        k: "dense",
        label: "Dense neurons",
        opts: [32, 64, 128],
        def: 32,
        help: "Width of the final decision layer.",
        effect: (value) => `${value} neurons combine the filter maps into a decision.`,
      },
      {
        k: "epochs",
        label: "Epochs",
        opts: [5, 8, 12],
        def: 5,
        help: "Passes over the training images.",
        effect: (value) => `${value} passes. CNNs usually need a few to find good filters.`,
      },
      {
        k: "lr",
        label: "Learning rate (Adam)",
        opts: [0.0005, 0.001, 0.003],
        def: 0.001,
        help: "Size of each update.",
        effect: (value) =>
          Number(value) >= 0.003
            ? "Big steps: fast, can overshoot."
            : Number(value) <= 0.0005
              ? "Small steps: stable, slow."
              : "The usual Adam default.",
      },
      {
        k: "batch",
        label: "Batch size",
        opts: [16, 32, 64],
        def: 32,
        help: "Images averaged per update.",
        effect: (value) =>
          Number(value) <= 16 ? "Noisier, more frequent updates." : Number(value) >= 64 ? "Smoother, fewer updates." : "A common middle ground.",
      },
    ],
  },
};

export const MODEL_ORDER: ModelId[] = ["knn", "svm", "rf", "mlp", "cnn"];

export function modelsForTrack(track: "ml" | "dl"): ModelId[] {
  return MODEL_ORDER.filter((id) => (track === "dl" ? MODELS[id].tf : !MODELS[id].tf));
}

export function defaultModelForTrack(track: "ml" | "dl"): ModelId {
  return track === "dl" ? "mlp" : "knn";
}

export const VIZ_TITLE: Record<ModelId, string> = {
  knn: "Nearest-neighbour vote",
  svm: "What each class boundary looks for",
  rf: "The forest, tree by tree",
  mlp: "What hidden neurons respond to",
  cnn: "Learned filters and feature maps",
};

export function defaults(model: ModelId): ParamMap {
  return Object.fromEntries(MODELS[model].params.map((param) => [param.k, param.def]));
}

export function defaultParams(): Record<ModelId, ParamMap> {
  return {
    knn: defaults("knn"),
    svm: defaults("svm"),
    rf: defaults("rf"),
    mlp: defaults("mlp"),
    cnn: defaults("cnn"),
  };
}

export function optLabel(param: ParamSpec, value: ParamValue): string {
  if (param.lbl) {
    const named = param.lbl[String(value)];
    if (named != null) return named;
  }
  return String(value);
}

export function paramSummary(model: ModelId, vals: ParamMap): string {
  return paramChips(model, vals)
    .map((chip) => chip.label)
    .join(" · ");
}

export function paramChips(model: ModelId, vals: ParamMap): { key: string; label: string }[] {
  const label = (key: string, value: ParamValue) => {
    const spec = MODELS[model].params.find((param) => param.k === key);
    return spec ? optLabel(spec, value) : String(value);
  };
  switch (model) {
    case "knn":
      return [
        { key: "k", label: `${vals.k} neighbours` },
        { key: "metric", label: label("metric", vals.metric) },
        { key: "weights", label: vals.weights === "distance" ? "Closer counts more" : "Equal votes" },
      ];
    case "svm":
      return [
        { key: "C", label: `Margin C ${vals.C}` },
        { key: "epochs", label: `${vals.epochs} epochs` },
        { key: "lr", label: `Learn rate ${vals.lr}` },
        ...(vals.scale === "off" ? [{ key: "scale", label: "Raw pixels" }] : []),
      ];
    case "rf":
      return [
        { key: "trees", label: `${vals.trees} trees` },
        { key: "depth", label: `Depth ≤ ${vals.depth}` },
        { key: "mtry", label: `${label("mtry", vals.mtry).split(" ")[0]} pixels/split` },
        { key: "leaf", label: `Leaf ≥ ${vals.leaf}` },
      ];
    case "mlp":
      return [
        { key: "shape", label: `${vals.layers} × ${vals.units} ${label("act", vals.act)}` },
        { key: "epochs", label: `${vals.epochs} epochs` },
        { key: "lr", label: `Learn rate ${vals.lr}` },
        ...(Number(vals.dropout) > 0 ? [{ key: "dropout", label: `Dropout ${Math.round(Number(vals.dropout) * 100)}%` }] : []),
      ];
    case "cnn":
      return [
        { key: "filters", label: `${vals.filters}→${Number(vals.filters) * 2} filters` },
        { key: "kernel", label: label("kernel", vals.kernel) },
        { key: "dense", label: `${vals.dense} dense` },
        { key: "epochs", label: `${vals.epochs} epochs` },
      ];
    default: {
      const _never: never = model;
      return _never;
    }
  }
}

export function estimate(model: ModelId, params: ParamMap, dataset: DatasetMeta, frac: number): string {
  const count = poolCount(dataset, frac);
  const test = dataset.nte;
  const classes = dataset.K;
  const side = dataset.side || 64;
  const pixels = side * side;
  let seconds: number;
  if (model === "knn") {
    const queries = dataset.valIdx.length + test;
    seconds = (queries * count * pixels) / 2.5e8 + queries * 0.002;
  } else if (model === "svm") {
    seconds = Number(params.epochs) * ((count * classes * pixels * 3) / 3e8 + 0.45);
  } else if (model === "rf") {
    const tried = params.mtry === "sqrt" ? side : params.mtry === "log2" ? 12 : Math.round(pixels * 0.1);
    seconds = Number(params.trees) * ((count * tried * 9 * Math.min(Number(params.depth), Math.log2(count) + 2)) / 1.2e8 + 0.03);
  } else if (model === "mlp") {
    seconds = Number(params.epochs) * ((count * pixels * Number(params.units) * Number(params.layers) * 6) / 1.5e9 + 0.5) + 1;
  } else {
    const half = Math.max(1, Math.floor(side / 2));
    seconds =
      Number(params.epochs) *
        ((count *
          (side * side * Number(params.filters) * Number(params.kernel) ** 2 +
            half * half * 2 * Number(params.filters) * Number(params.filters) * Number(params.kernel) ** 2) *
          6) /
          2e9 +
          0.5) +
      1;
  }
  const neural = MODELS[model].tf;
  const label = neural
    ? seconds < 20
      ? "about 10–20 seconds"
      : seconds < 60
        ? "under a minute"
        : "a few minutes"
    : seconds < 5
      ? "under 5 seconds"
      : seconds < 60
        ? `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`
        : `about ${Math.round((seconds / 60) * 2) / 2} minutes`;
  return `Training on ${num(count)} images: ${label}`;
}

export function loadSavedParams(): Record<ModelId, ParamMap> {
  const base = defaultParams();
  try {
    const raw = JSON.parse(localStorage.getItem("ex4-params") || "null") as Record<string, ParamMap> | null;
    if (!raw) return base;
    MODEL_ORDER.forEach((model) => {
      const saved = raw[model];
      if (!saved) return;
      MODELS[model].params.forEach((param) => {
        const value = saved[param.k];
        if (value == null) return;
        const match = param.opts.find((opt) => sameVal(opt, value));
        if (match != null) base[model][param.k] = match;
      });
    });
  } catch {
    return base;
  }
  return base;
}

export function poolCount(dataset: DatasetMeta, frac: number): number {
  const held = new Set(dataset.valIdx);
  return dataset.byClass.reduce((sum, group) => {
    const eligible = group.filter((index) => !held.has(index)).length;
    return sum + Math.max(1, Math.round(Math.max(0, eligible) * frac));
  }, 0);
}
