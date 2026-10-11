"""Text Classification projects (Day 1, Ex 2): the finance text classifier.

The five steps of the exercise, one project:
  1 choose a pack       tc_datasets.PACKS (complaint routing, BANKING77, prepaid, headlines, custody x2)
  2 inspect and clean   missing, duplicates, conflicting labels, leakage, XXXX masks
  3 representation      TF-IDF words (the default; Ex 3 can open it) or a hashed character vector
  4 train               logistic regression; loss and accuracy curves; scorecard at the threshold
  5 type + Enter        the model's label and confidence for the learner's own messages

TF-IDF runs are trained by cm_trainer.train with TC_SEED and the default text prep, the same
call the Confusion Matrix project makes when it opens this run: Ex 3 shows the same numbers.

Firestore
  text_classification_projects/{pid}             state (dataset, cleaning, representation, settings, open run)
  text_classification_projects/{pid}/runs/{id}   settings, scorecard, curves, per-item scores (as strings)
  text_classification_projects/{pid}/tries/{id}  a typed message, the model's answer, the learner's verdict
  tc_models/{modelId}                            the fitted vectorizer + classifier, zlib(pickle)
"""

from __future__ import annotations

import logging
import pickle
import threading
import time
import uuid
import warnings
import zlib
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from google.cloud import firestore
from sklearn.exceptions import ConvergenceWarning
from sklearn.feature_extraction.text import HashingVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss

from ..config import gcp_clients
from ..models import TCParams
from . import cm_trainer, tc_datasets
from .cm_datasets import CMDataset
from .exercises_tfidf_service import clean_note_text, normalize_text_prep

logger = logging.getLogger(__name__)

PROJECTS = "text_classification_projects"
RUNS = "runs"
TRIES = "tries"
MODELS = "tc_models"
SCHEMA_VERSION = 1
TC_SEED = 42  # split seed; the Confusion Matrix project reuses it for this model
MAX_MODEL_BYTES = 950_000  # Firestore document limit is 1 MiB
MAX_TRIES = 300
DEFAULT_PARAMS = TCParams().model_dump()
HASH_FEATURES = 2 ** 15
CURVE_POINTS = (1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 64, 85, 100, 150, 200, 300, 500, 750, 1000)


class TCError(ValueError):
    """A request the learner can fix (400)."""


class TCNotFound(LookupError):
    pass


class TCBusy(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


_TRAINING: set = set()
_TRAIN_LOCK = threading.Lock()
_MODEL_CACHE: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
_MODEL_CACHE_SIZE = 16
_MODEL_LOCK = threading.Lock()


# ── training ───────────────────────────────────────────────────


def _hashed_vectorizer() -> HashingVectorizer:
    """Character 3-5-grams hashed into a fixed-size vector. Not a neural model and not a sentence
    embedding: it is spelling-based, so it copes with typos but knows nothing about meaning."""
    return HashingVectorizer(analyzer="char_wb", ngram_range=(3, 5), n_features=HASH_FEATURES, alternate_sign=False,
                             norm="l2")


def _classifier(params: Dict[str, Any], max_iter: Optional[int] = None, warm: bool = False) -> LogisticRegression:
    return LogisticRegression(C=float(params["C"]), max_iter=int(max_iter or params["maxIter"]), solver="lbfgs",
                              warm_start=warm)


def _train_hashed(ds: CMDataset, params: Dict[str, Any]) -> cm_trainer.Fit:
    texts = cm_trainer.cleaned(ds)
    train_idx, test_idx = cm_trainer.stratified_split(ds.y, float(params["testSplit"]), TC_SEED)
    vectorizer = _hashed_vectorizer()
    x_train = vectorizer.transform([texts[i] for i in train_idx])
    y_train = np.array([1 if ds.y[i] == 0 else 0 for i in train_idx])
    if len(set(y_train.tolist())) < 2:
        raise TCError("Each class needs examples to learn from.")
    classifier = _classifier(params)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConvergenceWarning)
        classifier.fit(x_train, y_train)
    scores = classifier.predict_proba(vectorizer.transform([texts[i] for i in test_idx]))[:, 1]
    blob = zlib.compress(pickle.dumps({
        "kind": "hashed", "vectorizer": vectorizer, "classifier": classifier, "classes": ds.classes,
        "params": params, "seed": TC_SEED, "dataset": ds.key, "datasetVersion": ds.version,
    }), 6)
    return cm_trainer.Fit(test_idx=test_idx, labels=[ds.y[i] for i in test_idx], scores=[float(s) for s in scores],
                          train_n=len(train_idx), model_blob=blob)


def _curves(ds: CMDataset, params: Dict[str, Any], vectorizer) -> List[Dict[str, float]]:
    """Loss and accuracy on the training and test parts as the optimiser takes more steps.
    The same split, features and settings as the run; each point continues from the previous one."""
    texts = cm_trainer.cleaned(ds)
    train_idx, test_idx = cm_trainer.stratified_split(ds.y, float(params["testSplit"]), TC_SEED)
    x_train = vectorizer.transform([texts[i] for i in train_idx])
    x_test = vectorizer.transform([texts[i] for i in test_idx])
    y_train = np.array([1 if ds.y[i] == 0 else 0 for i in train_idx])
    y_test = np.array([1 if ds.y[i] == 0 else 0 for i in test_idx])
    limit = int(params["maxIter"])
    points = sorted({p for p in CURVE_POINTS if p < limit} | {limit})
    clf = _classifier(params, 1, warm=True)
    out, done = [], 0
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConvergenceWarning)
        for p in points:
            clf.max_iter = p - done
            clf.fit(x_train, y_train)
            done = p
            p_train, p_test = clf.predict_proba(x_train)[:, 1], clf.predict_proba(x_test)[:, 1]
            out.append({
                "iter": p,
                "trainLoss": round(float(log_loss(y_train, p_train, labels=[0, 1])), 4),
                "testLoss": round(float(log_loss(y_test, p_test, labels=[0, 1])), 4),
                "trainAcc": round(float(np.mean((p_train >= 0.5) == y_train)), 4),
                "testAcc": round(float(np.mean((p_test >= 0.5) == y_test)), 4),
            })
    return out


def fit_run(ds: CMDataset, params: Dict[str, Any], representation: str) -> Tuple[cm_trainer.Fit, bool, Dict[str, Any]]:
    """(fit, reused, model dict). TF-IDF goes through cm_trainer so Ex 3 retrains the identical model."""
    if representation == "tfidf":
        fit, reused = cm_trainer.train(ds, params, None, TC_SEED, "lr")
    else:
        fit, reused = _train_hashed(ds, params), False
    return fit, reused, pickle.loads(zlib.decompress(fit.model_blob))


def _fit_params(params: Dict[str, Any]) -> Tuple:
    return tuple(float(params[k]) for k in ("testSplit", "C", "ngrams", "maxFeatures", "maxIter"))


# ── service ────────────────────────────────────────────────────


class TextClassificationService:
    def _db(self):
        return gcp_clients.get_firestore_client()

    def _ref(self, project_id: str):
        return self._db().collection(PROJECTS).document(project_id)

    def _mark_guest_trained(self, project_id: str) -> None:
        """Workspace project status, so the projects list shows Model Trained."""
        try:
            ref = self._db().collection("projects").document(project_id)
            if ref.get().exists:
                ref.update({"status": "trained", "model.trainedAt": _now(), "updatedAt": _now()})
        except Exception as e:
            logger.warning("Could not mark text-classification project %s as trained: %s", project_id, e)

    # ── project doc ──

    def _doc(self, project_id: str, session_id: str) -> Dict[str, Any]:
        snap = self._ref(project_id).get()
        data = snap.to_dict() if snap.exists else None
        if not data or data.get("version") != SCHEMA_VERSION:
            return {"project_id": project_id, "session_id": session_id, "version": SCHEMA_VERSION,
                    "state": {"datasetId": None, "step": 1, "inspected": False, "clean": dict(tc_datasets.CLEAN_DEFAULTS),
                              "representation": "tfidf", "level": "basic", "preset": "balanced",
                              "params": dict(DEFAULT_PARAMS), "selectedRunId": None},
                    "runCount": 0, "createdAt": _now(), "updatedAt": _now()}
        return data

    def _write(self, doc: Dict[str, Any]) -> None:
        doc["updatedAt"] = _now()
        doc["version"] = SCHEMA_VERSION
        self._ref(doc["project_id"]).set(doc)

    def _runs(self, project_id: str) -> List[Dict[str, Any]]:
        return sorted((d.to_dict() for d in self._ref(project_id).collection(RUNS).stream()), key=lambda r: r["createdAt"])

    def _run(self, project_id: str, run_id: str) -> Dict[str, Any]:
        snap = self._ref(project_id).collection(RUNS).document(run_id).get()
        if not snap.exists:
            raise TCNotFound("Run not found.")
        return snap.to_dict()

    def _tries(self, project_id: str) -> List[Dict[str, Any]]:
        return sorted((d.to_dict() for d in self._ref(project_id).collection(TRIES).stream()), key=lambda r: r["createdAt"])

    @staticmethod
    def _summary(run: Dict[str, Any]) -> Dict[str, Any]:
        keep = ("id", "no", "datasetId", "datasetKey", "classes", "clean", "representation", "params", "trainN", "m",
                "curves", "seconds", "modelSaved", "reusedFit", "createdAt")
        return {k: run.get(k) for k in keep}

    def view(self, project_id: str, session_id: str, doc: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        doc = doc or self._doc(project_id, session_id)
        dataset_id = doc["state"].get("datasetId")
        return {
            "project_id": project_id,
            "state": doc["state"],
            "dataset": tc_datasets.info(dataset_id) if tc_datasets.find_pack(dataset_id) else None,
            "runs": [self._summary(r) for r in self._runs(project_id)],
            "tries": self._tries(project_id),
        }

    # ── steps 1-3 ──

    def choose_dataset(self, project_id: str, session_id: str, dataset_id: str) -> Dict[str, Any]:
        if not tc_datasets.find_pack(dataset_id):
            raise TCNotFound("Unknown dataset.")
        doc = self._doc(project_id, session_id)
        state = doc["state"]
        if state.get("datasetId") != dataset_id:
            # A new pack starts the checks again; runs on other packs stay in the history
            state.update(datasetId=dataset_id, inspected=False, clean=dict(tc_datasets.CLEAN_DEFAULTS), selectedRunId=None)
            same = [r for r in self._runs(project_id) if r["datasetId"] == dataset_id]
            if same:
                state.update(selectedRunId=same[-1]["id"], clean=same[-1]["clean"], inspected=True)
        state["step"] = max(int(state.get("step") or 1), 1)
        self._write(doc)
        return self.view(project_id, session_id, doc)

    def inspect(self, project_id: str, session_id: str, clean: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        dataset_id = doc["state"].get("datasetId")
        if not dataset_id:
            raise TCError("Choose a dataset first.")
        if clean is not None:
            doc["state"]["clean"] = tc_datasets.norm_clean(clean)
        doc["state"]["inspected"] = True
        self._write(doc)
        stats = tc_datasets.inspect(dataset_id)
        ds = tc_datasets.load(dataset_id, doc["state"]["clean"])
        return {**stats, "clean": doc["state"]["clean"], "after": {"n": len(ds.y), "counts": ds.counts}}

    def save_state(self, project_id: str, session_id: str, changes: Dict[str, Any]) -> Dict[str, Any]:
        ref = self._ref(project_id)

        @firestore.transactional
        def run(tx):
            snap = ref.get(transaction=tx)
            ok = snap.exists and snap.to_dict().get("version") == SCHEMA_VERSION
            doc = snap.to_dict() if ok else self._doc(project_id, session_id)
            for k, v in changes.items():
                if v is not None:
                    doc["state"][k] = v
            doc["updatedAt"] = _now()
            doc["version"] = SCHEMA_VERSION
            tx.set(ref, doc)
            return doc["state"]

        return run(self._db().transaction())

    # ── step 4: train ──

    def _begin(self, project_id: str) -> None:
        with _TRAIN_LOCK:
            if project_id in _TRAINING:
                raise TCBusy("A model is already training for this project.")
            _TRAINING.add(project_id)

    def _end(self, project_id: str) -> None:
        with _TRAIN_LOCK:
            _TRAINING.discard(project_id)

    def _save_model(self, model_id: str, blob: bytes, meta: Dict[str, Any]) -> bool:
        if len(blob) > MAX_MODEL_BYTES:
            logger.warning("Text classification model %s is %d bytes; too large to store", model_id, len(blob))
            return False
        self._db().collection(MODELS).document(model_id).set({**meta, "blob": blob, "bytes": len(blob), "createdAt": _now()})
        return True

    def train(self, project_id: str, session_id: str, params: Dict[str, Any], representation: str, preset: str,
              level: str) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        state = doc["state"]
        if not state.get("datasetId"):
            raise TCError("Choose a dataset first.")
        params = TCParams(**params).model_dump()
        ds = tc_datasets.load(state["datasetId"], state.get("clean"))
        runs = self._runs(project_id)
        self._begin(project_id)
        started = time.perf_counter()
        try:
            # Same data, representation and settings apart from the threshold: the same fitted model.
            # Reuse its stored scores, curves and model (instant, and survives restarts).
            twin = next((r for r in reversed(runs) if r["datasetKey"] == ds.key and r["representation"] == representation
                         and _fit_params(r["params"]) == _fit_params(params)), None)
            if twin:
                fit = cm_trainer.Fit(test_idx=cm_trainer.decode_ints(twin["testIdx"]), labels=cm_trainer.decode_ints(twin["labels"]),
                                     scores=cm_trainer.decode_scores(twin["scores"]), train_n=twin["trainN"], model_blob=b"")
                curves, model_id, reused = twin.get("curves") or [], twin.get("modelId"), True
            else:
                fit, _, model = fit_run(ds, params, representation)
                reused = False  # "reused" tells the learner only the threshold moved; a warm cache is not that
                curves = _curves(ds, params, model["vectorizer"])
                model_id = f"{project_id}-{uuid.uuid4().hex[:10]}"
                if self._save_model(model_id, fit.model_blob, {"projectId": project_id, "datasetKey": ds.key,
                                                               "representation": representation}):
                    _cache_put(model_id, model)
                else:
                    model_id = None
        finally:
            self._end(project_id)

        run_id = uuid.uuid4().hex[:16]
        run = {
            "id": run_id, "no": len(runs) + 1, "datasetId": ds.id, "datasetKey": ds.key, "datasetVersion": ds.version,
            "classes": ds.classes, "clean": tc_datasets.norm_clean(state.get("clean")), "representation": representation,
            "params": params, "seed": TC_SEED, "trainN": fit.train_n,
            "m": cm_trainer.metrics(fit.labels, fit.scores, params["threshold"]), "curves": curves,
            "testIdx": cm_trainer.encode_ints(fit.test_idx), "labels": cm_trainer.encode_ints(fit.labels),
            "scores": cm_trainer.encode_scores(fit.scores), "modelId": model_id, "modelSaved": bool(model_id),
            "reusedFit": reused, "seconds": round(time.perf_counter() - started, 2), "createdAt": _now(),
        }
        self._ref(project_id).collection(RUNS).document(run_id).set(run)
        state.update(selectedRunId=run_id, params=params, representation=representation, preset=preset, level=level,
                     step=max(int(state.get("step") or 1), 4))
        doc["runCount"] = len(runs) + 1
        self._write(doc)
        self._mark_guest_trained(project_id)
        return self.view(project_id, session_id, doc)

    # ── step 5: type + Enter ──

    def _model(self, run: Dict[str, Any]) -> Dict[str, Any]:
        """The run's fitted model: memory, then Firestore, then retrain (training is deterministic)."""
        model_id = run.get("modelId") or f"run-{run['id']}"
        hit = _cache_get(model_id)
        if hit:
            return hit
        if run.get("modelId"):
            snap = self._db().collection(MODELS).document(run["modelId"]).get()
            if snap.exists:
                model = pickle.loads(zlib.decompress(snap.to_dict()["blob"]))
                _cache_put(model_id, model)
                return model
        ds = tc_datasets.load_by_key(run["datasetKey"])
        _, _, model = fit_run(ds, run["params"], run["representation"])
        _cache_put(model_id, model)
        return model

    def predict(self, project_id: str, session_id: str, text: str, run_id: Optional[str]) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        run_id = run_id or doc["state"].get("selectedRunId")
        if not run_id:
            raise TCError("Train a model first.")
        run = self._run(project_id, run_id)
        message = " ".join(text.split())
        if not message:
            raise TCError("Type a message first.")
        tries = self._tries(project_id)
        if len(tries) >= MAX_TRIES:
            raise TCError(f"This project keeps up to {MAX_TRIES} messages. Delete some to type more.")
        model = self._model(run)
        clean = run.get("clean") or {}
        prepared = tc_datasets.strip_masks(message) if clean.get("removeMasks") else message
        prepared = clean_note_text(prepared, normalize_text_prep(None), "tfidf")
        if not prepared:
            raise TCError("That message has no words the model can read. Type some words.")
        x = model["vectorizer"].transform([prepared])
        p = float(model["classifier"].predict_proba(x)[0, 1])
        classes = run["classes"]
        flagged = p >= float(run["params"]["threshold"]) - 1e-9
        label = classes[0] if flagged else classes[1]
        item = {
            "id": uuid.uuid4().hex[:16], "text": message, "label": label, "p": round(p, 4),
            "confidence": round(p if flagged else 1 - p, 4), "runId": run["id"], "runNo": run["no"], "verdict": None,
            "evidence": _evidence(model, x), "createdAt": _now(),
        }
        self._ref(project_id).collection(TRIES).document(item["id"]).set(item)
        if int(doc["state"].get("step") or 1) < 5:
            self.save_state(project_id, session_id, {"step": 5})
        return item

    def mark_try(self, project_id: str, try_id: str, verdict: Optional[str]) -> Dict[str, Any]:
        ref = self._ref(project_id).collection(TRIES).document(try_id)
        snap = ref.get()
        if not snap.exists:
            raise TCNotFound("Message not found.")
        ref.update({"verdict": verdict})
        return {**snap.to_dict(), "verdict": verdict}

    def delete_try(self, project_id: str, try_id: str) -> None:
        ref = self._ref(project_id).collection(TRIES).document(try_id)
        if not ref.get().exists:
            raise TCNotFound("Message not found.")
        ref.delete()

    # ── per-run detail ──

    def examples(self, project_id: str, run_id: str, cell: str, limit: int) -> Tuple[List[Dict[str, Any]], int]:
        run = self._run(project_id, run_id)
        ds = tc_datasets.load_by_key(run["datasetKey"])
        idx, labels, scores = (cm_trainer.decode_ints(run["testIdx"]), cm_trainer.decode_ints(run["labels"]),
                               cm_trainer.decode_scores(run["scores"]))
        thr = run["params"]["threshold"]
        hits = [k for k in range(len(idx)) if cm_trainer.cell_of(labels[k], scores[k], thr) == cell]
        hits.sort(key=lambda k: -abs(scores[k] - thr))  # most confident first
        ids = getattr(ds, "ids", None) or list(range(1, len(ds.texts) + 1))
        return [{"id": ids[idx[k]], "text": tc_datasets._short(ds.texts[idx[k]]), "score": round(scores[k], 4)}
                for k in hits[:limit]], len(hits)

    # ── delete ──

    def delete(self, project_id: str, session_id: Optional[str] = None) -> bool:
        ref = self._ref(project_id)
        db = self._db()
        model_ids = set()
        for run in ref.collection(RUNS).stream():
            model_id = (run.to_dict() or {}).get("modelId") or ""
            if model_id.startswith(f"{project_id}-"):
                model_ids.add(model_id)
            run.reference.delete()
        for item in ref.collection(TRIES).stream():
            item.reference.delete()
        for model_id in model_ids:
            db.collection(MODELS).document(model_id).delete()
            with _MODEL_LOCK:
                _MODEL_CACHE.pop(model_id, None)
        existed = ref.get().exists
        if existed:
            ref.delete()
        return existed


def _cache_get(model_id: str) -> Optional[Dict[str, Any]]:
    with _MODEL_LOCK:
        if model_id in _MODEL_CACHE:
            _MODEL_CACHE.move_to_end(model_id)
            return _MODEL_CACHE[model_id]
    return None


def _cache_put(model_id: str, model: Dict[str, Any]) -> None:
    with _MODEL_LOCK:
        _MODEL_CACHE[model_id] = model
        _MODEL_CACHE.move_to_end(model_id)
        while len(_MODEL_CACHE) > _MODEL_CACHE_SIZE:
            _MODEL_CACHE.popitem(last=False)


def _evidence(model: Dict[str, Any], x) -> List[Dict[str, Any]]:
    """The words in the message that pushed hardest each way (TF-IDF only: hashed features have no names)."""
    vectorizer = model["vectorizer"]
    if not hasattr(vectorizer, "vocabulary_"):
        return []
    names = model.get("_names")
    if names is None:
        names = model["_names"] = vectorizer.get_feature_names_out()
    coef = model["classifier"].coef_[0]
    row = x.tocoo()
    contrib = sorted(((float(v * coef[j]), names[j]) for j, v in zip(row.col, row.data)), key=lambda t: -abs(t[0]))
    return [{"term": str(term), "weight": round(w, 3)} for w, term in contrib[:6] if abs(w) >= 0.01]
