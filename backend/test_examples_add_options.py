"""add_examples options used by sample data: split=False keeps texts with commas whole,
skip_existing=True makes adding the same examples twice a no-op. The default (manual box) still splits."""

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.models import ExampleAdd, TextExample
from app.services.project_service import ProjectService


def _service(project):
    service = ProjectService.__new__(ProjectService)  # no Firestore client needed
    service.collection = MagicMock()

    async def get_project(_project_id):
        return project

    service.get_project = get_project
    return service


def _project(examples=None):
    project = SimpleNamespace(dataset=SimpleNamespace(examples=list(examples or []), labels=[], records=0))
    project.model_dump = lambda: {"dataset": {"examples": [e.model_dump() for e in project.dataset.examples]}}
    return project


def _texts(project, label):
    return [e.text for e in project.dataset.examples if e.label == label]


def _add(service, items, **kw):
    return asyncio.run(service.add_examples("p1", [ExampleAdd(text=t, label=l) for t, l in items], **kw))


def test_default_still_splits_on_commas():
    project = _project()
    _add(_service(project), [("happy, glad", "pos")])
    assert _texts(project, "pos") == ["happy", "glad"]


def test_split_false_keeps_commas():
    project = _project()
    _add(_service(project), [("Invoice bhej do please, quarter end wala.", "Fees and billing"),
                             ("Have the 5,000 TCS bonus shares been credited?", "Corporate action")], split=False)
    assert _texts(project, "Fees and billing") == ["Invoice bhej do please, quarter end wala."]
    assert _texts(project, "Corporate action") == ["Have the 5,000 TCS bonus shares been credited?"]


def test_skip_existing_is_idempotent_and_keeps_own_examples():
    own = TextExample(text="my own example", label="Onboarding and KYC")
    project = _project([own])
    service = _service(project)
    items = [("Please update our registered address, and the PAN too.", "Onboarding and KYC"), ("Why is the custody fee higher?", "Fees and billing")]
    first = _add(service, items, split=False, skip_existing=True)
    second = _add(service, items, split=False, skip_existing=True)
    assert first["skipped"] == 0 and second["skipped"] == 2
    assert len(project.dataset.examples) == 3  # own + 2, nothing duplicated
    assert "my own example" in _texts(project, "Onboarding and KYC")
    assert set(project.dataset.labels) == {"Onboarding and KYC", "Fees and billing"}


def test_skip_existing_ignores_case_and_spacing_but_not_label():
    project = _project([TextExample(text="Why is the custody fee higher?", label="Fees and billing")])
    service = _service(project)
    r = _add(service, [("  why is the CUSTODY fee   higher?", "Fees and billing"),
                       ("Why is the custody fee higher?", "Complaint or escalation")], split=False, skip_existing=True)
    assert r["skipped"] == 1
    assert _texts(project, "Complaint or escalation") == ["Why is the custody fee higher?"]
