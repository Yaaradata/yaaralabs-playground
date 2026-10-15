"""Isolated Exercises API — does not alter other project-type flows."""

from __future__ import annotations

import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, Query

from .off_loop import off_loop
from ..models import (
    ProjectType,
    ExercisesEmbedRequest,
    ExercisesEmbedResponse,
    ExercisesGenerateRequest,
    ExercisesGenerateResponse,
    ExercisesTfidfDatasetListResponse,
    ExercisesTfidfDatasetResponse,
    ExercisesTfidfPredictRequest,
    ExercisesTfidfPredictResponse,
    ExercisesTfidfSampleResponse,
    ExercisesTfidfTrainRequest,
    ExercisesTfidfTrainResponse,
    ExercisesWorkspaceDeleteResponse,
    ExercisesWorkspaceResponse,
    ExercisesWorkspaceUpdate,
)
from ..services.guest_service import GuestService
from ..services.project_service import ProjectService
from ..services.exercises_service import ExercisesService
from ..services import exercises_tfidf_datasets, exercises_tfidf_service
from .slots import CPU_TRAINING
from .exercises_agent import register_agent_routes
from .exercises_build_rag import register_build_rag_routes
from .exercises_compare import register_compare_routes
from .exercises_ethics import register_ethics_routes
from .exercises_limit import register_limit_routes
from .exercises_dials import register_dials_routes
from .exercises_metric import register_metric_routes
from .exercises_persona import register_persona_routes
from .exercises_rag import register_rag_routes
from .exercises_tokeniser import register_tokeniser_routes
from .exercises_vision import register_vision_routes


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/exercises", tags=["exercises"])


def get_guest_service() -> GuestService:
    return GuestService()


def get_project_service() -> ProjectService:
    return ProjectService()


def get_exercises_service() -> ExercisesService:
    return ExercisesService()


async def validate_session(session_id: str, guest_service: GuestService = Depends(get_guest_service)):
    try:
        return await off_loop(guest_service.validate_session, session_id)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        if "expired" in msg:
            raise HTTPException(status_code=410, detail=msg)
        if "inactive" in msg:
            raise HTTPException(status_code=403, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Session validation error: {e}")


async def _assert_exercises_project(
    session_id: str,
    project_id: str,
    project_service: ProjectService,
):
    project = await off_loop(project_service.get_project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.student_id != session_id:
        raise HTTPException(status_code=403, detail="Project not accessible for this session")
    if project.type != ProjectType.EXERCISES and str(project.type) != "exercises":
        raise HTTPException(
            status_code=400,
            detail="This endpoint is only for exercises projects",
        )
    return project


@router.get(
    "/session/{session_id}/projects/{project_id}/workspace",
    response_model=ExercisesWorkspaceResponse,
)
async def get_workspace(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    exercises_service: ExercisesService = Depends(get_exercises_service),
):
    """Load (or lazily create) the Exercises workspace for a project."""
    await _assert_exercises_project(session_id, project_id, project_service)
    try:
        workspace = exercises_service.get_or_create(project_id, session_id)
        return ExercisesWorkspaceResponse(data=workspace)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error("Exercises get_workspace failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put(
    "/session/{session_id}/projects/{project_id}/workspace",
    response_model=ExercisesWorkspaceResponse,
)
async def save_workspace(
    session_id: str,
    project_id: str,
    body: ExercisesWorkspaceUpdate,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    exercises_service: ExercisesService = Depends(get_exercises_service),
):
    """Persist exercise progress, notes, and snapshots."""
    await _assert_exercises_project(session_id, project_id, project_service)
    try:
        workspace = exercises_service.save(project_id, session_id, body.state)
        return ExercisesWorkspaceResponse(data=workspace)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error("Exercises save_workspace failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session/{session_id}/projects/{project_id}/workspace/reset",
    response_model=ExercisesWorkspaceResponse,
)
async def reset_workspace(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    exercises_service: ExercisesService = Depends(get_exercises_service),
):
    """Reset all exercise progress for this project."""
    await _assert_exercises_project(session_id, project_id, project_service)
    try:
        exercises_tfidf_service.drop_model(session_id, project_id)
        workspace = exercises_service.reset(project_id, session_id)
        return ExercisesWorkspaceResponse(data=workspace)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error("Exercises reset_workspace failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session/{session_id}/projects/{project_id}/generate",
    response_model=ExercisesGenerateResponse,
)
async def generate(
    session_id: str,
    project_id: str,
    body: ExercisesGenerateRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    exercises_service: ExercisesService = Depends(get_exercises_service),
):
    """Run a classroom LLM call for prompt / temperature / model labs."""
    await _assert_exercises_project(session_id, project_id, project_service)
    try:
        result = exercises_service.generate(
            prompt=body.prompt,
            system=body.system,
            examples=body.examples,
            model=body.model,
            temperature=body.temperature,
            n=body.n,
            max_tokens=body.max_tokens,
        )
        return ExercisesGenerateResponse(**result)
    except Exception as e:
        logger.error("Exercises generate failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session/{session_id}/projects/{project_id}/embed",
    response_model=ExercisesEmbedResponse,
)
async def embed(
    session_id: str,
    project_id: str,
    body: ExercisesEmbedRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    exercises_service: ExercisesService = Depends(get_exercises_service),
):
    """Generate embeddings for the two-model similarity lab."""
    await _assert_exercises_project(session_id, project_id, project_service)
    try:
        result = exercises_service.embed(body.texts, body.model)
        return ExercisesEmbedResponse(**result)
    except Exception as e:
        logger.error("Exercises embed failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/session/{session_id}/projects/{project_id}/tfidf/sample",
    response_model=ExercisesTfidfSampleResponse,
)
async def tfidf_sample(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
):
    """Classroom sample CSV for TF-IDF Logistic Regression."""
    await _assert_exercises_project(session_id, project_id, project_service)
    return ExercisesTfidfSampleResponse(**exercises_tfidf_service.sample_payload())


@router.get(
    "/session/{session_id}/projects/{project_id}/tfidf/datasets",
    response_model=ExercisesTfidfDatasetListResponse,
)
async def tfidf_datasets(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
):
    """List department datasets students can load into TF-IDF Logistic Regression."""
    await _assert_exercises_project(session_id, project_id, project_service)
    return ExercisesTfidfDatasetListResponse(datasets=exercises_tfidf_datasets.list_department_datasets())


@router.get(
    "/session/{session_id}/projects/{project_id}/tfidf/datasets/{dataset_id}",
    response_model=ExercisesTfidfDatasetResponse,
)
async def tfidf_dataset(
    session_id: str,
    project_id: str,
    dataset_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(4, ge=1, le=200),
    full: bool = Query(False),
    inspect: bool = Query(False),
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
):
    """Load a department-tagged text classification dataset."""
    await _assert_exercises_project(session_id, project_id, project_service)
    try:
        if full:
            payload = await asyncio.to_thread(exercises_tfidf_datasets.load_department_table, dataset_id)
        else:
            payload = await asyncio.to_thread(
                exercises_tfidf_datasets.load_department_slice,
                dataset_id,
                offset,
                limit,
            )
        if inspect and "inspect" not in payload:
            payload["inspect"] = await asyncio.to_thread(
                exercises_tfidf_datasets.inspect_department_pack,
                dataset_id,
            )
        return ExercisesTfidfDatasetResponse(**payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Exercises TF-IDF dataset load failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session/{session_id}/projects/{project_id}/tfidf/train",
    response_model=ExercisesTfidfTrainResponse,
)
async def tfidf_train(
    session_id: str,
    project_id: str,
    body: ExercisesTfidfTrainRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
):
    """Fit TF-IDF + logistic regression on labeled reviews for this exercises project."""
    await _assert_exercises_project(session_id, project_id, project_service)
    try:
        if body.dataset_id:
            table = exercises_tfidf_datasets.load_department_table(body.dataset_id)
            rows = exercises_tfidf_service.rows_from_payload(table["rows"])
        else:
            rows = exercises_tfidf_service.rows_from_payload(body.rows)
        ngram_max = max(body.ngram_min, body.ngram_max)
        exercises_tfidf_service.begin_train(session_id, project_id)
        try:
            async with CPU_TRAINING():
                result = await asyncio.to_thread(
                    exercises_tfidf_service.train,
                    session_id,
                    project_id,
                    rows,
                    body.test_size,
                    body.seed,
                    body.max_features,
                    body.ngram_min,
                    ngram_max,
                    body.min_df,
                    body.regularization_c,
                    body.solver,
                    body.max_iter,
                    body.threshold,
                    body.epochs,
                    body.representation,
                    body.text_prep.model_dump() if body.text_prep else None,
                )
        finally:
            exercises_tfidf_service.end_train(session_id, project_id)
        return ExercisesTfidfTrainResponse(**result)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Exercises TF-IDF train failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session/{session_id}/projects/{project_id}/tfidf/predict",
    response_model=ExercisesTfidfPredictResponse,
)
async def tfidf_predict(
    session_id: str,
    project_id: str,
    body: ExercisesTfidfPredictRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
):
    """Score a review with the project's fitted TF-IDF + logistic regression model."""
    await _assert_exercises_project(session_id, project_id, project_service)
    try:
        result = await asyncio.to_thread(
            exercises_tfidf_service.predict,
            session_id,
            project_id,
            body.text,
        )
        return ExercisesTfidfPredictResponse(**result)
    except LookupError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Exercises TF-IDF predict failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete(
    "/session/{session_id}/projects/{project_id}/workspace",
    response_model=ExercisesWorkspaceDeleteResponse,
)
async def delete_workspace(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    exercises_service: ExercisesService = Depends(get_exercises_service),
):
    """Delete persisted exercises workspace (project shell remains)."""
    await _assert_exercises_project(session_id, project_id, project_service)
    try:
        exercises_tfidf_service.drop_model(session_id, project_id)
        deleted = exercises_service.delete(project_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Workspace not found")
        return ExercisesWorkspaceDeleteResponse()
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Exercises delete_workspace failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


register_metric_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_tokeniser_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_dials_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_persona_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_compare_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_limit_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_rag_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_build_rag_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_agent_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_ethics_routes(router, validate_session, get_project_service, _assert_exercises_project)
register_vision_routes(router, validate_session, get_project_service, _assert_exercises_project)
