"""
Benchmark image-model training setups for Image Recognition projects on the Nuvama documents sample.

Both models keep their base frozen (as in the app), so each image's features are computed once and
only the small classifier on top is retrained. That makes leave-one-out on the 20 training images
cheap, and leave-one-out is what picks the setup: the 12 standard and 20 handwritten test images are
only reported, never used to choose.

Rows per base model (MobileNetV2 0.35 @128, EfficientNetB0 @224):
  head      dense (softmax layer, Adam) or logreg (sklearn Logistic Regression on L2-normalised features)
  aug       copies per training image, and whether copies are mirrored left-right
  LOO       right of 20 when each training image is held out, and its mean confidence
  standard  right of 12;  handwritten  right of 20 (the deep test)

Run from backend/:  .venv/Scripts/python.exe scripts/benchmark_image_models.py
"""

from __future__ import annotations

import json
import random
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import keras  # noqa: E402
from keras import layers  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402

from app.image_training_service import ARCHITECTURES, ImageRecognitionTrainer  # noqa: E402

SAMPLE = ROOT.parent / "frontend" / "public" / "datasets" / "nuvama_documents"
SEED = 7


def load(file, size):
    return np.asarray(Image.open(SAMPLE / file).convert("RGB").resize(size), dtype=np.float32)


def augment(img, size, n, mirror, rng):
    """The app's augmentation (rotation +-15, 85-95% crop, brightness 0.9-1.1), n copies, mirror optional."""
    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    w, h = pil.size
    out = []
    for _ in range(n):
        a = pil.rotate(rng.uniform(-15, 15), resample=Image.BILINEAR)
        s = rng.uniform(0.85, 0.95)
        cw, ch = int(w * s), int(h * s)
        left, top = rng.randint(0, w - cw), rng.randint(0, h - ch)
        a = a.crop((left, top, left + cw, top + ch)).resize(size)
        if mirror and rng.random() < 0.5:
            a = a.transpose(Image.FLIP_LEFT_RIGHT)
        a = ImageEnhance.Brightness(a).enhance(rng.uniform(0.9, 1.1))
        out.append(np.asarray(a, dtype=np.float32))
    return out


class Features:
    """Frozen base + global average pooling: the input to the app's classifier layer."""

    def __init__(self, arch):
        self.t = ImageRecognitionTrainer(arch)
        self.size = ARCHITECTURES[arch]["img_size"]
        full = self.t._build_model(2, load_pretrained=True)
        base = full.layers[1]
        inp = keras.Input(shape=(*self.size, 3))
        self.model = keras.Model(inp, layers.GlobalAveragePooling2D()(base(inp, training=False)))

    def __call__(self, imgs):
        return self.model.predict(self.t._preprocess(np.stack(imgs)), verbose=0, batch_size=16)


def dense_head(xtr, ytr, k, lr, epochs, seed):
    keras.utils.set_random_seed(seed)
    m = keras.Sequential([keras.Input(shape=(xtr.shape[1],)), layers.Dropout(0.2), layers.Dense(k, activation="softmax")])
    m.compile(optimizer=keras.optimizers.Adam(learning_rate=lr), loss="sparse_categorical_crossentropy")
    m.fit(xtr, ytr, epochs=epochs, batch_size=8, verbose=0, shuffle=True, callbacks=[
        keras.callbacks.EarlyStopping(monitor="loss", patience=10, restore_best_weights=True),
        keras.callbacks.ReduceLROnPlateau(monitor="loss", factor=0.5, patience=5, min_lr=1e-4),
    ])
    return lambda x: m.predict(x, verbose=0)


def logreg_head(xtr, ytr, k, c, seed):
    norm = lambda x: x / (np.linalg.norm(x, axis=1, keepdims=True) + 1e-9)  # noqa: E731
    clf = LogisticRegression(C=c, max_iter=5000, class_weight="balanced", random_state=seed).fit(norm(xtr), ytr)
    return lambda x: clf.predict_proba(norm(x))


HEADS = {
    "dense lr .01 x20 (current)": lambda x, y, k, s: dense_head(x, y, k, 0.01, 20, s),
    "dense lr .001 x60": lambda x, y, k, s: dense_head(x, y, k, 0.001, 60, s),
    "logreg C=1": lambda x, y, k, s: logreg_head(x, y, k, 1.0, s),
    "logreg C=10": lambda x, y, k, s: logreg_head(x, y, k, 10.0, s),
}
AUGS = {"3 copies, mirrored (current)": (3, True), "8 copies, no mirror": (8, False)}


def main():
    m = json.loads((SAMPLE / "manifest.json").read_text(encoding="utf-8"))
    labels = [l["label"] for l in m["labels"]]
    train = [(f, labels.index(l["label"])) for l in m["labels"] for f in l["files"]]
    tests = {"standard": [(t["file"], labels.index(t["expected"])) for t in m["test"]],
             "handwritten": [(t["file"], labels.index(t["expected"])) for t in m.get("deepTest", [])]}
    archs = sys.argv[1:] or ["mobilenet", "efficientnet"]
    print(f"{len(train)} training images, {len(tests['standard'])} standard + {len(tests['handwritten'])} handwritten test images\n")

    for arch in archs:
        t0 = time.time()
        feat = Features(arch)
        size = feat.size
        orig = [load(f, size) for f, _ in train]
        f_orig = feat(orig)
        f_test = {k: feat([load(f, size) for f, _ in v]) for k, v in tests.items()}
        y_test = {k: np.array([y for _, y in v]) for k, v in tests.items()}
        aug_feats = {}
        for aname, (n, mirror) in AUGS.items():
            rng = random.Random(SEED)
            per = [feat(augment(img, size, n, mirror, rng)) for img in orig]  # n feature rows per image
            aug_feats[aname] = per
        print(f"# {arch} ({ARCHITECTURES[arch]['img_size'][0]} px), features in {time.time() - t0:.0f}s")

        for aname, per in aug_feats.items():
            for hname, make in HEADS.items():
                y = np.array([yy for _, yy in train])

                def rows(idx):
                    x = np.vstack([np.vstack([f_orig[i:i + 1], per[i]]) for i in idx])
                    yy = np.concatenate([[y[i]] * (1 + len(per[i])) for i in idx])
                    return x, yy

                # leave-one-out on the training images (the selection metric)
                right, confs = 0, []
                for i in range(len(train)):
                    xtr, ytr = rows([j for j in range(len(train)) if j != i])
                    p = make(xtr, ytr, len(labels), SEED)(f_orig[i:i + 1])[0]
                    right += int(np.argmax(p) == y[i])
                    confs.append(float(np.max(p)))
                # full training set -> the two test sets (reported only)
                xtr, ytr = rows(range(len(train)))
                predict = make(xtr, ytr, len(labels), SEED)
                res = {}
                for k in tests:
                    p = predict(f_test[k])
                    res[k] = int((np.argmax(p, axis=1) == y_test[k]).sum())
                print(f"{hname:<28} {aname:<30} LOO {right:>2}/20 (conf {np.mean(confs) * 100:>3.0f}%)  "
                      f"standard {res['standard']:>2}/{len(y_test['standard'])}  handwritten {res['handwritten']:>2}/{len(y_test['handwritten'])}")
        print()


if __name__ == "__main__":
    main()
