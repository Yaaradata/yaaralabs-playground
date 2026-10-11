"""Confusion Matrix projects (Exercise 3): persistence, pre-trained models and training runs.

Firestore
  cm_pretrained/{datasetId}                 shared pre-trained logistic regression per sample dataset
                                            (default settings), retrained only if the dataset changes
  cm_models/{modelId}                       every trained model (vectorizer + classifier), zlib(pickle)
  confusion_matrix_projects/{projectId}     the learner's state (source, dataset, level, settings,
                                            open run) and a snapshot of the Ex 2 run they opened
  confusion_matrix_projects/{pid}/runs/{id} every training run: settings, counts, per-item scores
  confusion_matrix_projects/{pid}/sources/{hash}
                                            examples copied from a Text Recognition project when it
                                            was opened (its examples may change later; runs keep theirs)

Long per-item arrays are stored as comma-separated strings (Firestore indexes array elements).
Ex 2 itself (Text Recognition projects, Exercises lab) is only ever read.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from google.cloud import firestore

from ..config import gcp_clients
from ..models import CM_THRESHOLDS, CMParams
from . import cm_datasets, cm_trainer, tc_datasets
from .cm_datasets import DEFAULT_TARGETS, MIN_PER_LABEL, CMDataset
from .exercises_service import COLLECTION as EXERCISES_COLLECTION
from .exercises_service import decode_from_firestore
from .text_classification_service import PROJECTS as TC_PROJECTS
from .text_classification_service import TC_SEED

logger = logging.getLogger(__name__)

PROJECTS = "confusion_matrix_projects"
RUNS = "runs"
SOURCES = "sources"
TEXTREC = "text-recognition"
TEXTCLASS = "text-classification"
PRETRAINED = "cm_pretrained"
MODELS = "cm_models"
SCHEMA_VERSION = 2
MAX_MODEL_BYTES = 950_000  # Firestore document limit is 1 MiB
DEFAULT_PARAMS = CMParams().model_dump()


class CMError(ValueError):
    """A request the learner can fix (400)."""


class CMNotFound(LookupError):
    pass


class CMBusy(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clock(dt: datetime) -> str:
    return dt.strftime("%H:%M")


_TRAINING: set = set()
_TRAIN_LOCK = threading.Lock()
_PRETRAIN_LOCKS: Dict[str, threading.Lock] = {d: threading.Lock() for d in cm_datasets.ALL_SAMPLE_IDS}


# ── Ex 2 → Ex 3 ────────────────────────────────────────────────


def _nearest_threshold(t: float) -> float:
    return min(CM_THRESHOLDS, key=lambda v: abs(v - t))


def _ex2_from_workspace(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    state = decode_from_firestore(raw.get("state") or {})
    ex2 = state.get("ex2Result") if isinstance(state, dict) else None
    if not isinstance(ex2, dict) or not ex2.get("classes"):
        return None
    snapshot = ((state.get("progress") or {}).get("2") or {}).get("snapshot") or {}
    return {"ex2": ex2, "snapshot": snapshot, "updatedAt": raw.get("updatedAt")}


def _ex2_matrix_accuracy(ex2: Dict[str, Any]) -> Tuple[Optional[float], int]:
    size = int(ex2.get("matrixSize") or len(ex2.get("classes") or []))
    cells = [float(c) for c in (ex2.get("matrixCells") or [])]
    if size < 2 or len(cells) < size * size:
        return None, 0
    total = sum(cells[: size * size])
    diag = sum(cells[i * size + i] for i in range(size))
    return (diag / total if total else None), int(total)


def _ex2_params(ex2: Dict[str, Any], snapshot: Dict[str, Any], classes: List[str], target: str) -> Tuple[CMParams, int, Optional[Dict[str, bool]]]:
    """Ex 2's applied settings in Ex 3 terms (threshold re-expressed for the target class)."""
    cfg = snapshot.get("appliedConfig") or {}
    t = float(ex2.get("threshold") or cfg.get("threshold") or 0.5)
    # Ex 2 decides "second class when P(second) >= t"; Ex 3 flags the target when P(target) >= t
    t_target = t if classes.index(target) == 1 else 1 - t
    prep_raw = snapshot.get("textPrep") or cfg.get("textPrep") or {}
    camel = {"dropMissing": "drop_missing", "dropDuplicates": "drop_duplicates", "lowercase": "lowercase",
             "stripNoise": "strip_noise", "stopwords": "stopwords", "lemmatize": "lemmatize"}
    prep = {snake: bool(prep_raw[k]) for k, snake in camel.items() if k in prep_raw} or None
    params = CMParams(
        threshold=_nearest_threshold(t_target),
        testSplit=min(0.3, max(0.1, float(cfg.get("test_size", 0.2)))),
        C=float(cfg.get("regularization_c", 1.0)),
        ngrams=2 if int(cfg.get("ngram_max", 2)) >= 2 else 1,
        maxFeatures=int(cfg.get("max_features", 5000)),
        maxIter=int(cfg.get("max_iter", 100)),
    )
    return params, int(cfg.get("seed", 42)), prep


def _textrec_examples(project: Dict[str, Any]) -> Tuple[List[str], List[str], List[str]]:
    """(texts, labels, label order) of a Text Recognition project; blank texts are skipped."""
    dataset = project.get("dataset") or {}
    texts, labels = [], []
    for ex in dataset.get("examples") or []:
        text, label = str((ex or {}).get("text") or "").strip(), str((ex or {}).get("label") or "").strip()
        if text and label:
            texts.append(text)
            labels.append(label)
    present = set(labels)
    order = [str(l) for l in (dataset.get("labels") or []) if str(l) in present]
    order += sorted(present - set(order))
    return texts, labels, order


def _textrec_trained_at(project: Dict[str, Any]) -> Optional[datetime]:
    raw = (project.get("model") or {}).get("trainedAt")
    if isinstance(raw, datetime):
        return raw
    try:
        return datetime.fromisoformat(str(raw)) if raw else None
    except ValueError:
        return None


def _textrec_is_trained(project: Dict[str, Any]) -> bool:
    return project.get("status") == "trained" or bool((project.get("model") or {}).get("trainedAt"))


def _textrec_params(project: Dict[str, Any]) -> CMParams:
    """Text Recognition's own recipe (text_ovr_service) in Ex 3 terms."""
    split = float((project.get("config") or {}).get("validationSplit") or 0.2)
    return CMParams(threshold=0.5, testSplit=min(0.3, max(0.1, split)), C=20.0, ngrams=2, maxFeatures=5000, maxIter=5000)


def _textrec_summary(project_id: str, project: Dict[str, Any]) -> Dict[str, Any]:
    texts, labels, order = _textrec_examples(project)
    counts = {l: labels.count(l) for l in order}
    model = project.get("model") or {}
    name = project.get("name") or "Text Recognition"
    item = {"kind": "textrec", "projectId": project_id, "projectName": name, "datasetId": None, "datasetName": name,
            "classes": order[:2], "labels": order, "labelCounts": counts, "nExamples": len(texts),
            "modelType": model.get("modelType") or "", "params": _textrec_params(project).model_dump(),
            "accuracy": model.get("accuracy"), "nTest": 0, "usable": False, "reason": "",
            "updatedAt": _textrec_trained_at(project) or project.get("updatedAt")}
    if len(order) > 1:
        others = order[1:]
        item["classes"] = [order[0], others[0] if len(others) == 1 else cm_datasets.OTHER_LABELS]
    thin = [l for l in order if counts[l] < MIN_PER_LABEL]
    if len(order) < 2:
        item["reason"] = "Needs at least two labels. Add another label in Exercise 2."
    elif thin:
        item["reason"] = (f"Needs at least {MIN_PER_LABEL} examples per label "
                          f"({', '.join(f'{l}: {counts[l]}' for l in thin)}). Add examples in Exercise 2.")
    else:
        item["usable"] = True
    return item


def _textclass_summary(project_id: str, name: str, picked) -> Optional[Dict[str, Any]]:
    """A Text Classification project's model as an Ex 2 run. Ex 3 retrains it with the same data,
    split seed and settings (cm_trainer, TC_SEED), so its first matrix matches the Ex 2 scorecard."""
    run, current = picked
    shown = run or current
    if not shown:
        return None
    pack = tc_datasets.find_pack(shown["datasetId"]) or {}
    item = {"kind": "textclass", "projectId": project_id, "projectName": name, "datasetId": shown["datasetId"],
            "datasetName": pack.get("name") or shown["datasetId"], "datasetKey": shown["datasetKey"],
            "classes": list(shown["classes"]), "labels": list(shown["classes"]),
            "labelCounts": {}, "nExamples": 0, "modelType": "TF-IDF + logistic regression",
            "params": CMParams(**shown["params"]).model_dump(), "accuracy": shown["m"]["accuracy"],
            "nTest": shown["m"]["n"], "usable": bool(run), "reason": "", "updatedAt": shown["createdAt"]}
    if not run:
        item["reason"] = ("Exercise 3 opens TF-IDF models. Train this project once with TF-IDF words "
                          "(step 3) and open it again.")
    return item


class ConfusionMatrixService:
    def _db(self):
        return gcp_clients.get_firestore_client()

    def _ref(self, project_id: str):
        return self._db().collection(PROJECTS).document(project_id)

    def _mark_guest_trained(self, project_id: str) -> None:
        """Set the workspace project status so the projects list shows Model Trained."""
        try:
            ref = self._db().collection("projects").document(project_id)
            if not ref.get().exists:
                return
            ref.update({
                "status": "trained",
                "model.trainedAt": _now(),
                "updatedAt": _now(),
            })
        except Exception as e:
            logger.warning("Could not mark confusion-matrix project %s as trained: %s", project_id, e)

    # ── datasets ──

    def dataset_for(self, doc: Dict[str, Any]) -> Optional[CMDataset]:
        state = doc.get("state") or {}
        if state.get("source") == "pre" and state.get("datasetId"):
            return cm_datasets.load_sample(state["datasetId"])
        if state.get("source") == "ex2" and doc.get("ex2"):
            ex2 = doc["ex2"]
            if ex2.get("kind") == "textrec":
                return self._textrec_dataset(doc["project_id"], ex2["datasetKey"])
            if ex2.get("kind") == "textclass":
                return tc_datasets.load_by_key(ex2["datasetKey"])
            return cm_datasets.load_ex2(ex2["datasetId"], ex2["classes"][0])
        return None

    def _textrec_dataset(self, project_id: str, key: str) -> CMDataset:
        """The examples snapshot behind a 'tr:' key (memory cache first, then Firestore)."""
        hit = cm_datasets.cached(key)
        if hit:
            return hit
        _, _, digest, target = key.split(":", 3)
        snap = self._ref(project_id).collection(SOURCES).document(digest).get()
        if not snap.exists:
            raise CMNotFound("The examples for this run are no longer stored.")
        src = snap.to_dict()
        return cm_datasets.make_textrec(key, src.get("projectName") or "", json.loads(src["texts"]),
                                        json.loads(src["labels"]), target)

    # ── pre-trained models (shared, permanent) ──

    def _save_model(self, model_id: str, blob: bytes, meta: Dict[str, Any]) -> bool:
        if len(blob) > MAX_MODEL_BYTES:
            logger.warning("Model %s is %d bytes; too large to store", model_id, len(blob))
            return False
        self._db().collection(MODELS).document(model_id).set({**meta, "blob": blob, "bytes": len(blob), "createdAt": _now()})
        return True

    def pretrained(self, dataset_id: str) -> Dict[str, Any]:
        """The shared pre-trained model for a sample dataset, training it once if missing or stale."""
        ds = cm_datasets.load_sample(dataset_id)
        ref = self._db().collection(PRETRAINED).document(dataset_id)
        snap = ref.get()
        if snap.exists and snap.to_dict().get("version") == ds.version:
            return snap.to_dict()
        with _PRETRAIN_LOCKS[dataset_id]:
            snap = ref.get()
            if snap.exists and snap.to_dict().get("version") == ds.version:
                return snap.to_dict()
            fit, _ = cm_trainer.train(ds, DEFAULT_PARAMS)
            model_id = f"pretrained-{dataset_id}-{ds.version}"
            saved = self._save_model(model_id, fit.model_blob, {"kind": "pretrained", "datasetId": dataset_id})
            doc = {
                "datasetId": dataset_id, "version": ds.version, "model": "lr", "params": DEFAULT_PARAMS,
                "trainN": fit.train_n, "m": cm_trainer.metrics(fit.labels, fit.scores, DEFAULT_PARAMS["threshold"]),
                "testIdx": cm_trainer.encode_ints(fit.test_idx), "labels": cm_trainer.encode_ints(fit.labels),
                "scores": cm_trainer.encode_scores(fit.scores), "modelId": model_id if saved else None, "trainedAt": _now(),
            }
            ref.set(doc)
            logger.info("Pre-trained model ready for %s (accuracy %.3f)", dataset_id, doc["m"]["accuracy"])
            return doc

    # ── Ex 2 runs in this session ──

    def list_ex2_runs(self, session_id: str) -> List[Dict[str, Any]]:
        """Every Ex 2 model in this workspace: Text Classification projects (the Day 1 Ex 2) first,
        then trained Text Recognition projects, then Exercises-lab runs."""
        return self._textclass_runs(session_id) + self._textrec_runs(session_id) + self._exercises_runs(session_id)

    def _textclass_runs(self, session_id: str) -> List[Dict[str, Any]]:
        query = self._db().collection("projects").where(filter=firestore.FieldFilter("student_id", "==", session_id))
        out = []
        for snap in query.stream():
            project = snap.to_dict() or {}
            if project.get("type") != TEXTCLASS:
                continue
            item = _textclass_summary(snap.id, project.get("name") or "Text Classification", self._textclass_pick(snap.id))
            if item:
                out.append(item)
        out.sort(key=lambda r: r["updatedAt"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out

    def _textclass_pick(self, tc_project_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        """(run Ex 3 opens, open run): the open run when it is TF-IDF, else the latest TF-IDF run."""
        tc = self._db().collection(TC_PROJECTS).document(tc_project_id)
        doc = tc.get()
        if not doc.exists:
            return None, None
        selected = (doc.to_dict().get("state") or {}).get("selectedRunId")
        runs = sorted((r.to_dict() for r in tc.collection(RUNS).stream()), key=lambda r: r["createdAt"])
        current = next((r for r in runs if r["id"] == selected), runs[-1] if runs else None)
        if current and current.get("representation") == "tfidf":
            return current, current
        return next((r for r in reversed(runs) if r.get("representation") == "tfidf"), None), current

    def _textrec_runs(self, session_id: str) -> List[Dict[str, Any]]:
        # One equality filter, so no composite index is needed; type and status are checked here
        query = self._db().collection("projects").where(filter=firestore.FieldFilter("student_id", "==", session_id))
        out = []
        for snap in query.stream():
            project = snap.to_dict() or {}
            if project.get("type") == TEXTREC and _textrec_is_trained(project):
                out.append(_textrec_summary(snap.id, project))
        out.sort(key=lambda r: r["updatedAt"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out

    def _exercises_runs(self, session_id: str) -> List[Dict[str, Any]]:
        db = self._db()
        out = []
        for doc in db.collection(EXERCISES_COLLECTION).where("session_id", "==", session_id).stream():
            found = _ex2_from_workspace(doc.to_dict())
            if not found:
                continue
            project = db.collection("projects").document(doc.id).get()
            if not project.exists or project.to_dict().get("student_id") != session_id:
                continue
            ex2, snapshot = found["ex2"], found["snapshot"]
            classes = [str(c) for c in ex2["classes"]]
            dataset_id = (snapshot.get("datasetId") or "").lower() or None
            accuracy, n_test = _ex2_matrix_accuracy(ex2)
            item = {"projectId": doc.id, "projectName": project.to_dict().get("name") or "Exercises",
                    "datasetId": dataset_id, "datasetName": "", "classes": classes, "params": None,
                    "accuracy": accuracy, "nTest": n_test, "usable": False, "reason": "", "updatedAt": found["updatedAt"]}
            if len(classes) != 2:
                item["reason"] = "Exercise 3 reads two-class models; this run has more classes."
            elif not dataset_id or not snapshot.get("appliedConfig") or snapshot.get("trained") is not True:
                item["reason"] = "This run did not save its settings. Train it once more in Exercise 2."
            else:
                try:
                    target = DEFAULT_TARGETS.get(dataset_id) if DEFAULT_TARGETS.get(dataset_id) in classes else classes[1]
                    ds_classes = list(cm_datasets.ex2_classes(dataset_id, target))
                    params, _, _ = _ex2_params(ex2, snapshot, classes, target)
                    meta = cm_datasets.exercises_tfidf_datasets.get_department_dataset(dataset_id) or {}
                    item.update(classes=ds_classes, params=params.model_dump(), usable=True, datasetName=meta.get("name") or dataset_id)
                except (LookupError, ValueError) as e:
                    item["reason"] = str(e)
            out.append(item)
        out.sort(key=lambda r: r["updatedAt"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out

    # ── project read ──

    def _doc(self, project_id: str, session_id: str) -> Dict[str, Any]:
        snap = self._ref(project_id).get()
        data = snap.to_dict() if snap.exists else None
        if not data or data.get("version") != SCHEMA_VERSION:
            # New project (or one from the earlier Ex 3 design): start fresh
            return {"project_id": project_id, "session_id": session_id, "version": SCHEMA_VERSION,
                    "state": {"source": None, "datasetId": None, "model": "lr", "level": "basic",
                              "params": DEFAULT_PARAMS, "selectedRunId": None},
                    "ex2": None, "runCount": 0, "createdAt": _now(), "updatedAt": _now()}
        return data

    def _runs(self, project_id: str) -> List[Dict[str, Any]]:
        docs = self._ref(project_id).collection(RUNS).stream()
        return sorted((d.to_dict() for d in docs), key=lambda r: r["createdAt"])

    @staticmethod
    def _summary(run: Dict[str, Any]) -> Dict[str, Any]:
        keep = ("id", "no", "source", "datasetKey", "kind", "model", "params", "trainN", "m", "modelSaved", "reusedFit", "createdAt")
        return {k: run.get(k) for k in keep}

    def view(self, project_id: str, session_id: str, doc: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        doc = doc or self._doc(project_id, session_id)
        ds = None
        try:
            ds = self.dataset_for(doc)
        except Exception as e:  # dataset missing: show the state, not a crash
            logger.warning("Dataset for %s unavailable: %s", project_id, e)
        return {
            "project_id": project_id,
            "state": doc["state"],
            "ex2": doc.get("ex2"),
            "dataset": ds.info() if ds else None,
            "runs": [self._summary(r) for r in self._runs(project_id)],
        }

    # ── training runs ──

    def _begin(self, project_id: str) -> None:
        with _TRAIN_LOCK:
            if project_id in _TRAINING:
                raise CMBusy("A model is already training for this project.")
            _TRAINING.add(project_id)

    def _end(self, project_id: str) -> None:
        with _TRAIN_LOCK:
            _TRAINING.discard(project_id)

    def _add_run(self, project_id: str, doc: Dict[str, Any], ds: CMDataset, kind: str, params: Dict[str, Any],
                 fit: cm_trainer.Fit, reused: bool, model_id: Optional[str], model: str = "lr") -> Dict[str, Any]:
        source = doc["state"]["source"]
        runs = self._runs(project_id)
        no = 1 + sum(1 for r in runs if r["source"] == source and r["datasetKey"] == ds.key)
        run_id = uuid.uuid4().hex[:16]
        created = _now()
        run = {
            "id": run_id, "no": no, "source": source, "datasetKey": ds.key, "kind": kind, "model": model,
            "params": params, "trainN": fit.train_n, "m": cm_trainer.metrics(fit.labels, fit.scores, params["threshold"]),
            "testIdx": cm_trainer.encode_ints(fit.test_idx), "labels": cm_trainer.encode_ints(fit.labels),
            "scores": cm_trainer.encode_scores(fit.scores), "modelId": model_id, "modelSaved": bool(model_id),
            "reusedFit": reused, "createdAt": created,
        }
        self._ref(project_id).collection(RUNS).document(run_id).set(run)
        doc["state"]["selectedRunId"] = run_id
        doc["state"]["params"] = params
        doc["state"]["model"] = model
        doc["runCount"] = len(runs) + 1
        self._write(doc)
        self._mark_guest_trained(project_id)
        return run

    def _write(self, doc: Dict[str, Any]) -> None:
        doc["updatedAt"] = _now()
        doc["version"] = SCHEMA_VERSION
        self._ref(doc["project_id"]).set(doc)

    @staticmethod
    def _full(params: Dict[str, Any]) -> Dict[str, Any]:
        """Every setting, with defaults for fields older runs did not have."""
        return CMParams(**params).model_dump()

    def _train_run(self, project_id: str, doc: Dict[str, Any], ds: CMDataset, params: Dict[str, Any], kind: str,
                   model: str = "lr") -> Dict[str, Any]:
        params = self._full(params)
        # Saved-run cache: same settings apart from the threshold means the same fitted model,
        # so reuse its stored scores and saved model instead of training again (survives restarts)
        source = doc["state"]["source"]
        twin = next((r for r in reversed(self._runs(project_id))
                     if r["source"] == source and r["datasetKey"] == ds.key and r.get("model", "lr") == model
                     and cm_trainer.same_fit(model, self._full(r["params"]), params)), None)
        if twin:
            fit = cm_trainer.Fit(test_idx=cm_trainer.decode_ints(twin["testIdx"]), labels=cm_trainer.decode_ints(twin["labels"]),
                                 scores=cm_trainer.decode_scores(twin["scores"]), train_n=twin["trainN"], model_blob=b"")
            return self._add_run(project_id, doc, ds, kind, params, fit, True, twin.get("modelId"), model)

        prep, seed = None, cm_trainer.SAMPLE_SEED
        if source == "ex2":
            prep, seed = doc["ex2"].get("textPrep"), int(doc["ex2"].get("seed") or 42)
        fit, reused = cm_trainer.train(ds, params, prep, seed, model)
        model_id = f"{project_id}-{uuid.uuid4().hex[:10]}"
        saved = self._save_model(model_id, fit.model_blob, {"kind": "run", "model": model, "projectId": project_id,
                                                             "datasetKey": ds.key})
        return self._add_run(project_id, doc, ds, kind, params, fit, reused, model_id if saved else None, model)

    def open(self, project_id: str, session_id: str, source: str, dataset_id: Optional[str],
             ex2_project_id: Optional[str], target: Optional[str] = None) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        state = doc["state"]
        if source == "pre":
            if not cm_datasets.find_sample(dataset_id):
                raise CMNotFound("Unknown dataset.")
            state.update(source="pre", datasetId=dataset_id)
        else:
            snap = self._ex2_snapshot(project_id, session_id, ex2_project_id, target)
            doc["ex2"] = snap
            state.update(source="ex2", datasetId=None)
        ds = self.dataset_for(doc)
        existing = [r for r in self._runs(project_id) if r["source"] == source and r["datasetKey"] == ds.key]
        if existing:  # reopening: show what was there, nothing retrains
            state["selectedRunId"] = existing[-1]["id"]
            state["params"] = self._full(existing[-1]["params"])
            state["model"] = existing[-1].get("model", "lr")
            self._write(doc)
            self._mark_guest_trained(project_id)
            return self.view(project_id, session_id, doc)

        self._begin(project_id)
        try:
            if source == "pre":
                pre = self.pretrained(dataset_id)
                fit = cm_trainer.Fit(test_idx=cm_trainer.decode_ints(pre["testIdx"]), labels=cm_trainer.decode_ints(pre["labels"]),
                                     scores=cm_trainer.decode_scores(pre["scores"]), train_n=pre["trainN"], model_blob=b"")
                self._add_run(project_id, doc, ds, "pre", dict(pre["params"]), fit, False, pre.get("modelId"))
            else:
                self._train_run(project_id, doc, ds, dict(doc["ex2"]["params"]), "ex2")
        finally:
            self._end(project_id)
        return self.view(project_id, session_id, doc)

    def _textrec_snapshot(self, project_id: str, session_id: str, project: Dict[str, Any], tr_project_id: str,
                          target: Optional[str]) -> Dict[str, Any]:
        """Copy the Text Recognition project's examples (once per distinct set) and describe the scope."""
        if not _textrec_is_trained(project):
            raise CMError("Train this Text Recognition project in Exercise 2 first.")
        run = _textrec_summary(tr_project_id, project)
        if not run["usable"]:
            raise CMError(run["reason"])
        texts, labels, order = _textrec_examples(project)
        target = target or order[0]
        if target not in order:
            raise CMError(f"“{target}” is not a label in this project.")
        key = cm_datasets.textrec_key(tr_project_id, target, texts, labels)
        src_ref = self._ref(project_id).collection(SOURCES).document(key.split(":")[2])
        if not src_ref.get().exists:  # same examples, same snapshot: written once
            src_ref.set({"projectId": tr_project_id, "projectName": run["projectName"], "n": len(texts),
                         "texts": json.dumps(texts, ensure_ascii=False), "labels": json.dumps(labels, ensure_ascii=False),
                         "createdAt": _now()})
        ds = cm_datasets.make_textrec(key, run["projectName"], texts, labels, target)
        return {"kind": "textrec", "projectId": tr_project_id, "projectName": run["projectName"], "datasetId": "",
                "datasetName": run["projectName"], "datasetKey": key, "classes": ds.classes, "labels": order,
                "params": run["params"], "seed": 42, "textPrep": None, "trainedAt": run["updatedAt"]}

    def _ex2_snapshot(self, project_id: str, session_id: str, ex2_project_id: Optional[str],
                      target: Optional[str]) -> Dict[str, Any]:
        if not ex2_project_id:
            raise CMError("Pick an Exercise 2 model.")
        snap = self._db().collection("projects").document(ex2_project_id).get()
        project = snap.to_dict() if snap.exists else None
        if not project or project.get("student_id") != session_id:
            raise CMNotFound("That Exercise 2 model was not found in your workspace.")
        if project.get("type") == TEXTREC:
            return self._textrec_snapshot(project_id, session_id, project, ex2_project_id, target)
        if project.get("type") == TEXTCLASS:
            item = _textclass_summary(ex2_project_id, project.get("name") or "Text Classification",
                                      self._textclass_pick(ex2_project_id))
            if not item:
                raise CMError("Train this Text Classification project first.")
            if not item["usable"]:
                raise CMError(item["reason"])
            return {"kind": "textclass", "projectId": ex2_project_id, "projectName": item["projectName"],
                    "datasetId": item["datasetId"], "datasetName": item["datasetName"], "datasetKey": item["datasetKey"],
                    "classes": item["classes"], "labels": item["classes"], "params": item["params"],
                    "seed": TC_SEED, "textPrep": None, "trainedAt": item["updatedAt"]}
        run = next((r for r in self._exercises_runs(session_id) if r["projectId"] == ex2_project_id), None)
        if not run:
            raise CMNotFound("That Exercise 2 run was not found in your workspace.")
        if not run["usable"]:
            raise CMError(run["reason"] or "That Exercise 2 run can't be opened here.")
        ws = self._db().collection(EXERCISES_COLLECTION).document(ex2_project_id).get().to_dict()
        found = _ex2_from_workspace(ws)
        target = run["classes"][0]
        params, seed, prep = _ex2_params(found["ex2"], found["snapshot"], [str(c) for c in found["ex2"]["classes"]], target)
        return {"kind": "exercises", "projectId": ex2_project_id, "projectName": run["projectName"], "datasetId": run["datasetId"],
                "datasetName": run["datasetName"], "classes": run["classes"], "params": params.model_dump(),
                "datasetKey": f"ex2:{run['datasetId']}:{target}", "labels": [str(c) for c in found["ex2"]["classes"]],
                "seed": seed, "textPrep": prep, "trainedAt": run["updatedAt"]}

    def train(self, project_id: str, session_id: str, params: Dict[str, Any], model: str = "lr") -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        if not doc["state"].get("source"):
            raise CMError("Open a model first.")
        ds = self.dataset_for(doc)
        self._begin(project_id)
        try:
            self._train_run(project_id, doc, ds, params, "retrain", model)
        finally:
            self._end(project_id)
        return self.view(project_id, session_id, doc)

    def save_state(self, project_id: str, session_id: str, level: Optional[str], params: Optional[Dict[str, Any]],
                   selected_run_id: Optional[str], model: Optional[str] = None) -> Dict[str, Any]:
        ref = self._ref(project_id)
        db = self._db()

        @firestore.transactional
        def run(tx):
            snap = ref.get(transaction=tx)
            doc = snap.to_dict() if snap.exists and snap.to_dict().get("version") == SCHEMA_VERSION else self._doc(project_id, session_id)
            if model:
                doc["state"]["model"] = model
            if level:
                doc["state"]["level"] = level
            if params:
                doc["state"]["params"] = params
            if selected_run_id:
                doc["state"]["selectedRunId"] = selected_run_id
            doc["updatedAt"] = _now()
            doc["version"] = SCHEMA_VERSION
            tx.set(ref, doc)
            return doc["state"]

        return run(db.transaction())

    def start_over(self, project_id: str, session_id: str) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        doc["state"].update(source=None, datasetId=None, selectedRunId=None)
        self._write(doc)
        return self.view(project_id, session_id, doc)

    # ── per-run detail ──

    def sample(self, project_id: str, session_id: str, page: int) -> List[Dict[str, Any]]:
        ds = self.dataset_for(self._doc(project_id, session_id))
        if not ds:
            raise CMError("Open a model first.")
        return cm_datasets.sample_rows(ds, page)

    def examples(self, project_id: str, session_id: str, run_id: str, cell: str, limit: int) -> Tuple[List[Dict[str, Any]], int]:
        snap = self._ref(project_id).collection(RUNS).document(run_id).get()
        if not snap.exists:
            raise CMNotFound("Run not found.")
        run = snap.to_dict()
        doc = self._doc(project_id, session_id)
        ds = self._dataset_by_key(run["datasetKey"], doc)
        idx, labels, scores = (cm_trainer.decode_ints(run["testIdx"]), cm_trainer.decode_ints(run["labels"]),
                               cm_trainer.decode_scores(run["scores"]))
        thr = run["params"]["threshold"]
        hits = [k for k in range(len(idx)) if cm_trainer.cell_of(labels[k], scores[k], thr) == cell]
        # Most confident mistakes / clearest hits first
        hits.sort(key=lambda k: -abs(scores[k] - thr))
        return [{"text": ds.texts[idx[k]], "score": round(scores[k], 4)} for k in hits[:limit]], len(hits)

    def _dataset_by_key(self, key: str, doc: Dict[str, Any]) -> CMDataset:
        kind, _, rest = key.partition(":")
        if kind == "sample":
            return cm_datasets.load_sample(rest)
        if kind == "tr":
            return self._textrec_dataset(doc["project_id"], key)
        if kind == "tc":
            return tc_datasets.load_by_key(key)
        dataset_id, _, target = rest.partition(":")
        return cm_datasets.load_ex2(dataset_id, target)

    # ── delete ──

    def delete(self, project_id: str, session_id: Optional[str] = None) -> bool:
        ref = self._ref(project_id)
        db = self._db()
        model_ids = set()
        for run in ref.collection(RUNS).stream():
            data = run.to_dict()
            # Only this project's own models: runs may point at a shared pre-trained model
            if (data.get("modelId") or "").startswith(f"{project_id}-"):
                model_ids.add(data["modelId"])
            run.reference.delete()
        for src in ref.collection(SOURCES).stream():
            src.reference.delete()
        for model_id in model_ids:
            db.collection(MODELS).document(model_id).delete()
        existed = ref.get().exists
        if existed:
            ref.delete()
        return existed
