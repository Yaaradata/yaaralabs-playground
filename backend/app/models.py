from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from typing import List, Optional, Union, Dict, Any, ClassVar, Literal
from datetime import datetime, timezone, timedelta
from enum import Enum

# New Teacher-Classroom-Student Models
class SessionType(str, Enum):
    FORENOON = "forenoon"
    AFTERNOON = "afternoon"

class Classroom(BaseModel):
    classroom_id: str = Field(..., description="Unique classroom identifier")
    name: str = Field(..., description="Classroom name (e.g., Class 8A)")
    hashcode: str = Field(..., description="5-digit hashcode for students to join")
    students: List[str] = Field(default_factory=list, description="List of student IDs")
    demo_projects: List[str] = Field(default_factory=list, description="List of demo project IDs")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    active: bool = Field(True, description="Whether classroom is active")

class Teacher(BaseModel):
    teacher_id: str = Field(..., description="Unique teacher identifier")
    name: str = Field(..., description="Teacher's full name")
    school_name: str = Field(..., description="School name")
    date_of_training: str = Field(..., description="Training date (YYYY-MM-DD)")
    session: SessionType = Field(..., description="Training session time")
    classrooms: List[Classroom] = Field(default_factory=list, description="List of classrooms")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    active: bool = Field(True, description="Whether teacher account is active")

class TeacherCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    school_name: str = Field(..., min_length=1, max_length=200)
    date_of_training: str = Field(..., description="Training date (YYYY-MM-DD)")
    session: SessionType

class ClassroomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Classroom name")

class Student(BaseModel):
    student_id: str = Field(..., description="Unique student identifier")
    name: str = Field(..., description="Student's full name")
    teacher_id: str = Field(..., description="Teacher ID this student belongs to")
    classroom_id: str = Field(..., description="Classroom ID this student belongs to")
    hashcode: str = Field(..., description="Hashcode used to join")
    projects: List[dict] = Field(default_factory=list, description="List of student's projects")
    accessible_demos: List[str] = Field(default_factory=list, description="List of accessible demo project IDs")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    active: bool = Field(True, description="Whether student account is active")

class StudentJoin(BaseModel):
    hashcode: str = Field(..., min_length=5, max_length=5, description="5-digit hashcode")
    name: str = Field(..., min_length=1, max_length=100, description="Student's name")

class TeacherResponse(BaseModel):
    success: bool = True
    data: Teacher

class TeacherListResponse(BaseModel):
    success: bool = True
    data: List[Teacher]

class ClassroomResponse(BaseModel):
    success: bool = True
    data: Classroom

class StudentResponse(BaseModel):
    success: bool = True
    data: Student

class StudentListResponse(BaseModel):
    success: bool = True
    data: List[Student]

class TeacherDashboardResponse(BaseModel):
    success: bool = True
    data: dict


class ProjectType(str, Enum):
    TEXT_RECOGNITION = "text-recognition"
    IMAGE_RECOGNITION = "image-recognition"
    IMAGE_RECOGNITION_TEACHABLE_MACHINE = "image-recognition-teachable-machine"
    POSE_RECOGNITION_TEACHABLE_MACHINE = "pose-recognition-teachable-machine"
    CLASSIFICATION = "classification"
    REGRESSION = "regression"
    CUSTOM = "custom"
    RULE_BASED_PROCESS = "rule-based-process"
    LIVE_OBJECT_DETECTION = "live-object-detection"
    EXERCISES = "exercises"
    CONFUSION_MATRIX = "confusion-matrix"
    RAG_CHATBOT = "rag-chatbot"
    AI_AGENT = "ai-agent"
    LIVE_VIDEO_CLASSIFICATION = "live-video-classification"
    COPILOT_ETHICS = "copilot-ethics"
    COPILOT_DOCUMENT_AI = "copilot-document-ai"


class ProjectStatus(str, Enum):
    DRAFT = "draft"
    QUEUED = "queued"
    TRAINING = "training"
    TRAINED = "trained"
    TESTING = "testing"
    FAILED = "failed"


class TextExample(BaseModel):
    text: str = Field(..., description="Text example")
    label: str = Field(..., description="Label for this example")
    addedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ImageExampleAdd(BaseModel):
    image_url: str = Field(..., description="GCS URL of the uploaded image")
    label: str = Field(..., description="Label for this image example")
    filename: str = Field(..., description="Original filename of the image")

class Dataset(BaseModel):
    filename: str = Field("", description="Name of the dataset file")
    size: int = Field(0, description="File size in bytes")
    records: int = Field(0, description="Number of records in the dataset")
    uploadedAt: Optional[datetime] = Field(None, description="When the dataset was uploaded")
    gcsPath: str = Field("", description="GCS path to the dataset file")
    examples: List[TextExample] = Field(default_factory=list, description="Text examples")
    image_examples: List[ImageExampleAdd] = Field(default_factory=list, description="Image examples")
    labels: List[str] = Field(default_factory=list, description="Unique labels in dataset")


class TrainedModel(BaseModel):
    filename: str = Field("", description="Name of the model file")
    accuracy: Optional[float] = Field(None, description="Model accuracy score")
    loss: Optional[float] = Field(None, description="Model loss value")
    trainedAt: Optional[datetime] = Field(None, description="When the model was trained")
    gcsPath: str = Field("", description="GCS path to the model file")
    labels: List[str] = Field(default_factory=list, description="Labels the model can predict")
    modelType: str = Field("logistic_regression", description="Type of model used")
    endpointUrl: str = Field("", description="URL for prediction endpoint")


class ProjectConfig(BaseModel):
    epochs: int = Field(100, ge=1, le=10000, description="Number of training epochs")
    batchSize: int = Field(32, ge=1, le=10000, description="Training batch size")
    learningRate: float = Field(0.001, gt=0, le=1, description="Learning rate")
    validationSplit: float = Field(0.2, gt=0, lt=1, description="Validation split ratio")


class Project(BaseModel):
    id: str = Field(..., description="Unique project identifier")
    name: str = Field(..., min_length=1, max_length=100, description="Project name")
    description: str = Field("", max_length=500, description="Project description")
    type: ProjectType = Field(ProjectType.TEXT_RECOGNITION, description="Project type")
    status: ProjectStatus = Field(ProjectStatus.DRAFT, description="Current project status")
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Creation timestamp")
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Last update timestamp")
    createdBy: str = Field("", description="User who created the project")
    
    # Teacher-Classroom-Student linking
    teacher_id: str = Field("", description="Teacher ID this project belongs to")
    classroom_id: str = Field("", description="Classroom ID this project belongs to")
    student_id: str = Field("", description="Student ID who created this project")
    
    # School and class information (legacy, can be derived from teacher/classroom)
    schoolId: str = Field("", description="School identifier")
    classId: str = Field("", description="Class identifier")
    
    # Dataset information
    dataset: Dataset = Field(default_factory=lambda: Dataset(), description="Primary dataset")
    datasets: List[Dataset] = Field(default_factory=list, description="List of all datasets")
    
    # Model information
    model: TrainedModel = Field(default_factory=lambda: TrainedModel(), description="Trained model details")
    
    # Training configuration (optional for image-recognition-teachable-machine projects)
    config: Optional[ProjectConfig] = Field(None, description="Training configuration")
    
    # Teachable Machine integration (for image recognition projects)
    teachable_machine_link: Optional[str] = Field(None, description="Teachable Machine model link for image recognition projects")
    
    # Training history and job management
    trainingHistory: List[dict] = Field(default_factory=list, description="Training history logs")
    currentJobId: Optional[str] = Field(None, description="Current training job ID")
    
    # Lifecycle management
    expiryTimestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=timezone.utc) + timedelta(days=7),
        description="Project expiry timestamp (default 7 days)"
    )
    
    # Metadata
    tags: List[str] = Field(default_factory=list, description="Project tags")
    notes: str = Field("", max_length=1000, description="Additional notes")

    # Rule Based Process projects edited in Scratch (saved as an .sb3 in Cloud Storage).
    # Kept on the model so whole-document rewrites (e.g. update_project) don't drop them.
    rbpEditor: Optional[str] = Field(None, description="Rule Based Process editor: 'blocks' (default, block editor), 'legacy' (same block editor, older projects), 'scratch', or 'rules-bot' (parked)")
    scratchProjectPath: Optional[str] = Field(None, description="GCS path of the saved Scratch project (.sb3)")
    scratchSavedAt: Optional[datetime] = Field(None, description="When the Scratch project was last saved")
    scratchSizeBytes: Optional[int] = Field(None, description="Size of the saved .sb3 in bytes")
    scratchVersion: Optional[int] = Field(None, description="Save counter used to detect saves from an outdated tab")
    scratchClientId: Optional[str] = Field(None, description="Editor tab that made the last save")


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field("", max_length=500)
    type: ProjectType = Field(ProjectType.TEXT_RECOGNITION)
    createdBy: str = Field("")
    teacher_id: str = Field("", description="Teacher ID this project belongs to")
    classroom_id: str = Field("", description="Classroom ID this project belongs to")
    student_id: str = Field("", description="Student ID who created this project")
    tags: List[str] = Field(default_factory=list)
    notes: str = Field("", max_length=1000)
    config: Optional[ProjectConfig] = None
    teachable_machine_link: Optional[str] = Field(None, description="Teachable Machine model link for image recognition projects")


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    type: Optional[ProjectType] = None
    status: Optional[ProjectStatus] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = Field(None, max_length=1000)
    config: Optional[ProjectConfig] = None
    dataset: Optional[Dataset] = None
    teachable_machine_link: Optional[str] = Field(None, description="Teachable Machine model link for image recognition projects")


class TrainingConfig(BaseModel):
    epochs: Optional[int] = Field(100, ge=1, le=10000)
    batchSize: Optional[int] = Field(32, ge=1, le=10000)
    learningRate: Optional[float] = Field(0.001, gt=0, le=1)
    validationSplit: Optional[float] = Field(0.2, gt=0, lt=1)
    modelType: Optional[str] = Field(
        None,
        description="Text recognition only: 'logistic_regression' or 'distilbert'. Omit to keep the existing default.",
    )


# Limits that keep a project document far below Firestore's 1 MiB (docs/hardening.md, item 8)
MAX_EXAMPLE_TEXT = 500
MAX_LABEL = 50
MAX_EXAMPLES_PER_REQUEST = 50
MAX_EXAMPLES_PER_PROJECT = 500


class ExampleAdd(BaseModel):
    text: str = Field(..., max_length=MAX_EXAMPLE_TEXT, description="Text example to add (500 characters at most)")
    label: str = Field(..., max_length=MAX_LABEL, description="Label for this example (50 characters at most)")

class ExamplesBulkAdd(BaseModel):
    examples: List[ExampleAdd] = Field(..., description="List of examples to add")
    # The manual box lets learners type several examples separated by commas. Sample data sends
    # whole sentences (which may contain commas) with split=False, and skip_existing=True so adding
    # the same sample twice does not duplicate anything.
    split: bool = Field(True, description="Split each text on commas into several examples")
    skip_existing: bool = Field(False, description="Skip texts already present under the same label")

class ImageExamplesBulkAdd(BaseModel):
    examples: List[ImageExampleAdd] = Field(..., description="List of image examples to add")

class DatasetUpload(BaseModel):
    records: Optional[int] = Field(None, ge=0)
    description: Optional[str] = Field("")


class TrainingJob(BaseModel):
    id: str = Field(..., description="Training job identifier")
    projectId: str = Field(..., description="Project ID")
    status: str = Field("queued", description="Job status: queued|training|ready|failed")
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    startedAt: Optional[datetime] = Field(None, description="When training started")
    completedAt: Optional[datetime] = Field(None, description="When training completed")
    error: Optional[str] = Field(None, description="Error message if failed")
    progress: float = Field(0.0, ge=0.0, le=100.0, description="Training progress percentage")
    config: Optional[ProjectConfig] = Field(None, description="Training configuration")
    result: Optional[dict] = Field(None, description="Training results (accuracy, etc.)")

class TrainingJobStatus(str, Enum):
    QUEUED = "queued"
    TRAINING = "training"
    READY = "ready"
    FAILED = "failed"


class FileUploadResponse(BaseModel):
    success: bool
    gcsPath: str


class TrainingResponse(BaseModel):
    success: bool
    message: str
    jobId: Optional[str] = Field(None, description="Training job ID")

class PredictionRequest(BaseModel):
    text: str = Field(..., max_length=500, description="Text to predict (500 characters at most), or an image's gs:// URL")

class PredictionResponse(BaseModel):
    success: bool
    label: str
    confidence: float
    alternatives: List[dict] = Field(default_factory=list, description="Alternative predictions")


class ProjectStatusResponse(BaseModel):
    id: str
    status: ProjectStatus
    dataset: Dataset
    datasets: List[Dataset]
    model: TrainedModel
    updatedAt: datetime


class PaginationInfo(BaseModel):
    limit: int
    offset: int
    total: int


class ProjectListResponse(BaseModel):
    success: bool = True
    data: List[Project]
    pagination: PaginationInfo


class ProjectResponse(BaseModel):
    success: bool = True
    data: Project


class ProjectStatusResponseWrapper(BaseModel):
    success: bool = True
    data: ProjectStatusResponse


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    details: Optional[List[str]] = None

# New Demo Project Models
class DemoProject(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    
    demo_project_id: str = Field(..., description="Unique demo project identifier")
    name: str = Field(..., description="Demo project name")
    description: str = Field(..., description="Project description")
    teacher_id: str = Field(..., description="Teacher who created this demo")
    classroom_id: str = Field(..., description="Classroom this demo belongs to")
    project_type: str = Field(..., description="Type of project (e.g., 'text_classification', 'image_classification')")
    dataset_info: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Dataset information")
    trained_model_info: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Trained model information")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    active: bool = Field(True, description="Whether demo project is active")

class DemoProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Demo project name")
    description: str = Field(..., min_length=1, max_length=500, description="Project description")
    project_type: str = Field(..., description="Type of project")
    dataset_info: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Dataset information")
    trained_model_info: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Trained model information")

class DemoProjectResponse(BaseModel):
    success: bool = True
    data: DemoProject

class DemoProjectListResponse(BaseModel):
    success: bool = True
    data: List[DemoProject]

# New Guest Models
class Guest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    
    session_id: str = Field(..., description="Unique session ID")
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Session creation timestamp")
    expiresAt: datetime = Field(..., description="Session expiration timestamp")
    active: bool = Field(True, description="Whether session is active")
    
    # Optional metadata fields for tracking
    ip_address: Optional[str] = Field(None, description="IP address of the guest")
    user_agent: Optional[str] = Field(None, description="User agent string")
    last_active: Optional[datetime] = Field(None, description="Last activity timestamp")
    
    # Project data stored directly in guest collection
    project_id: str = Field(..., description="Unique project identifier")
    name: str = Field(..., description="Project name")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Project creation timestamp")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Last update timestamp")
    status: str = Field("draft", description="Project status: draft, training, trained, failed")
    
    # Dataset information
    dataset_type: str = Field("text", description="Type of dataset (text, image, etc.)")
    dataset: List[Dict[str, str]] = Field(default_factory=list, description="Training examples with input and label")
    dataset_size: int = Field(0, description="Number of training examples")
    
    # Model information
    model_type: str = Field("logistic_regression", description="Type of model used")
    model_version: int = Field(1, description="Model version number")
    ml_config: Dict[str, Any] = Field(default_factory=dict, description="Model configuration parameters")
    
    # Training information
    training_status: str = Field("pending", description="Training status: pending, training, completed, failed")
    training_logs: List[str] = Field(default_factory=list, description="Training progress logs")
    trained_at: Optional[datetime] = Field(None, description="When training completed")
    metrics: Dict[str, float] = Field(default_factory=dict, description="Training metrics (accuracy, loss, f1)")
    currentJobId: Optional[str] = Field(None, description="Current training job ID")
    
    # Test results
    test_results: List[Dict[str, str]] = Field(default_factory=list, description="Test predictions with input, expected, and predicted")
    test_accuracy: Optional[float] = Field(None, description="Test accuracy score")
    last_tested_at: Optional[datetime] = Field(None, description="Last test timestamp")
    
    # Scratch integration
    scratch_api_key: Optional[str] = Field(None, description="Scratch API key for integration")
    scratch_enabled: bool = Field(False, description="Whether Scratch integration is enabled")
    usage_count: int = Field(0, description="Number of times project was used")
    
    # Access tracking
    last_accessed_by: Optional[str] = Field(None, description="Last user who accessed the project")
    last_accessed_at: Optional[datetime] = Field(None, description="Last access timestamp")

class GuestCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Project name")
    dataset_type: str = Field("text", description="Type of dataset")
    session_duration_hours: int = Field(48, ge=1, le=168, description="Session duration in hours (1-168 hours = 1 week max)")

class GuestUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    dataset: Optional[List[Dict[str, str]]] = None
    ml_config: Optional[Dict[str, Any]] = None
    training_status: Optional[str] = None
    status: Optional[str] = None
    currentJobId: Optional[str] = None
    metrics: Optional[Dict[str, float]] = None
    test_results: Optional[List[Dict[str, str]]] = None
    scratch_enabled: Optional[bool] = None

class GuestResponse(BaseModel):
    success: bool = True
    data: Guest

class GuestListResponse(BaseModel):
    success: bool = True
    data: List[Guest]

# Simple Guest Session (without project data)
class GuestSession(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    
    session_id: str = Field(..., description="Unique session ID")
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Session creation timestamp")
    expiresAt: datetime = Field(..., description="Session expiration timestamp")
    active: bool = Field(True, description="Whether session is active")
    
    # Optional metadata fields for tracking
    ip_address: Optional[str] = Field(None, description="IP address of the guest")
    user_agent: Optional[str] = Field(None, description="User agent string")
    last_active: Optional[datetime] = Field(None, description="Last activity timestamp")

class GuestSessionResponse(BaseModel):
    success: bool = True
    data: GuestSession

# Agent Creation API Models
class Agent(BaseModel):
    agent_id: str = Field(..., description="Unique agent identifier")
    user_id: str = Field(..., description="User ID who created the agent")
    session_id: str = Field(..., description="Session ID")
    name: str = Field(..., description="Agent name")
    role: str = Field(..., description="Agent role")
    tone: str = Field(..., description="Agent tone")
    language: str = Field(..., description="Agent language")
    description: str = Field(..., description="Agent description")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    active: bool = Field(True, description="Whether agent is active")
    # Day 2 Agent Studio. No stage = legacy agent (old inline UI and ChatService.chat)
    stage: Optional[Literal["assistant", "rag", "agent"]] = Field(None, description="assistant (Ex 6), rag (Ex 7), agent (Ex 8)")
    project_name: Optional[str] = Field(None, description="Name the participant gave the project")
    copied_from: Optional[Dict[str, Any]] = Field(None, description="{agent_id, name, stage} this agent started from")

class Persona(BaseModel):
    agent_id: str = Field(..., description="Agent ID this persona belongs to")
    name: str = Field(..., description="Persona name")
    role: str = Field(..., description="Persona role")
    tone: str = Field(..., description="Persona tone")
    language: str = Field("English", description="Persona language")
    response_length: str = Field("short", description="Response length: minimal, short, long, chatty")
    description: str = Field("", description="Who the agent is and what it does (from the create screen), sent in every reply")
    guidelines: str = Field("", description="Custom chat guidelines")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PersonaUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, description="Persona name")
    role: Optional[str] = Field(None, description="Persona role")
    tone: Optional[str] = Field(None, description="Persona tone (friendly, professional, casual)")
    language: Optional[str] = Field(None, description="Persona language")
    response_length: Optional[str] = Field(None, description="Response length: minimal, short, long, chatty")
    description: Optional[str] = Field(None, description="Who the agent is and what it does")
    guidelines: Optional[str] = Field(None, description="Custom chat guidelines")

class PersonaUpdateResponse(BaseModel):
    success: bool = True
    persona: Persona
    message: str = "Persona updated successfully"

# Chat models in the pickers (Gemini on Vertex AI; "provider/model" ids through OpenRouter), and the
# Gemini ids saved before the pickers changed (they now run as Gemini 3.8 Flash: resolve_vertex_model)
PICKER_MODELS: List[str] = ["gemini-3.8-flash", "openai/gpt-6-luna", "anthropic/claude-haiku-5.5"]
LEGACY_MODELS: List[str] = ["gemini-2.5-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"]


class AgentSettings(BaseModel):
    agent_id: str = Field(..., description="Agent ID this settings belongs to")
    model: str = Field("gemini-3.8-flash", description="Model id: gemini-3.8-flash (Vertex), openai/gpt-6-luna or anthropic/claude-haiku-5.5 (OpenRouter)")
    embedding_model: str = Field("text-embedding-005", description="Embedding model name")
    similarity: str = Field("Cosine similarity", description="Similarity method (Cosine similarity, Euclidean Distance, Jaccard Similarity)")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Valid model names
    # the model picker (exercises_vertex_models), plus the Gemini ids saved before it changed
    VALID_MODELS: ClassVar[List[str]] = PICKER_MODELS + LEGACY_MODELS
    
    @field_validator('model')
    @classmethod
    def validate_model(cls, v):
        """Validate that model name is one of the supported models"""
        if v not in cls.VALID_MODELS:
            raise ValueError(f"Invalid model name: {v}. Supported models: {', '.join(cls.VALID_MODELS)}")
        return v

class SettingsUpdateRequest(BaseModel):
    model: Optional[str] = Field(None, description="Model name")
    embedding_model: Optional[str] = Field(None, description="Embedding model name")
    similarity: Optional[str] = Field(None, description="Similarity method")
    
    # Valid model names
    # what a save may set: the models in the picker (exercises_vertex_models)
    VALID_MODELS: ClassVar[List[str]] = PICKER_MODELS
    
    @field_validator('model')
    @classmethod
    def validate_model(cls, v):
        """Validate that model name is one of the supported models"""
        if v is not None and v not in cls.VALID_MODELS:
            raise ValueError(f"Invalid model name: {v}. Supported models: {', '.join(cls.VALID_MODELS)}")
        return v

class SettingsUpdateResponse(BaseModel):
    success: bool = True
    settings: AgentSettings
    message: str = "Settings updated successfully"

GUARDRAIL_NEVER_RULES_MAX = 10
GUARDRAIL_NEVER_RULE_CHARS = 200
GUARDRAIL_HANDOFF_CHARS = 300


def _check_never_rules(v):
    if v is None:
        return v
    v = [r.strip() for r in v if r and r.strip()]
    if len(v) > GUARDRAIL_NEVER_RULES_MAX:
        raise ValueError(f"At most {GUARDRAIL_NEVER_RULES_MAX} 'Also never' lines")
    for r in v:
        if len(r) > GUARDRAIL_NEVER_RULE_CHARS:
            raise ValueError(f"Each 'Also never' line can be at most {GUARDRAIL_NEVER_RULE_CHARS} characters")
    return v


class AgentGuardrails(BaseModel):
    """Custom AI Agent guardrails: what the agent must never do. All off by default."""
    agent_id: str = Field(..., description="Agent ID these guardrails belong to")
    stay_on_topic: bool = False
    no_made_up_facts: bool = False
    protect_client_data: bool = False
    block_instruction_changes: bool = False
    never_rules: List[str] = Field(default_factory=list)
    handoff_message: str = Field("", max_length=GUARDRAIL_HANDOFF_CHARS)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator('never_rules')
    @classmethod
    def validate_never_rules(cls, v):
        return _check_never_rules(v)


class GuardrailsUpdateRequest(BaseModel):
    stay_on_topic: Optional[bool] = None
    no_made_up_facts: Optional[bool] = None
    protect_client_data: Optional[bool] = None
    block_instruction_changes: Optional[bool] = None
    never_rules: Optional[List[str]] = None
    handoff_message: Optional[str] = Field(None, max_length=GUARDRAIL_HANDOFF_CHARS)

    @field_validator('never_rules')
    @classmethod
    def validate_never_rules(cls, v):
        return _check_never_rules(v)


class GuardrailsUpdateResponse(BaseModel):
    success: bool = True
    guardrails: AgentGuardrails
    message: str = "Guardrails updated successfully"


class KnowledgeType(str, Enum):
    TEXT = "text"
    FILE = "file"
    LINK = "link"
    QNA = "qna"

class Knowledge(BaseModel):
    knowledge_id: str = Field(..., description="Unique knowledge identifier")
    agent_id: str = Field(..., description="Agent ID this knowledge belongs to")
    type: KnowledgeType = Field(..., description="Knowledge type")
    content: str = Field(..., description="Knowledge content")
    embedding: Optional[List[float]] = Field(None, description="Embedding vector")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")
    priority: int = Field(1, description="Priority (higher = more important)")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Rule Condition Types (WHEN dropdown options)
class RuleConditionType(str, Enum):
    CONVERSATION_STARTS = "Conversation starts"
    USER_WANTS_TO = "User wants to"
    USER_TALKS_ABOUT = "User talks about"
    USER_ASKS_ABOUT = "User asks about"
    USER_SENTIMENT_IS = "User sentiment is"
    USER_PROVIDES = "User provides"
    SENTENCE_CONTAINS = "The sentence contains"

# Rule Action Types (DO dropdown options)
class RuleActionType(str, Enum):
    SAY_EXACT_MESSAGE = "Say exact message"
    ALWAYS_INCLUDE = "Always include"
    ALWAYS_TALK_ABOUT = "Always talk about"
    TALK_ABOUT_MENTION = "Talk about/mention"
    DONT_TALK_ABOUT = "Don't talk about/mention"
    ASK_FOR_INFORMATION = "Ask for information"
    FIND_IN_WEBSITE = "Find in website"
    ANSWER_USING_KB = "Answer Using Knowledge Base"

# Match Type for multiple conditions
class RuleMatchType(str, Enum):
    ANY = "ANY"  # OR logic - any condition matches
    ALL = "ALL"  # AND logic - all conditions must match

class RuleCondition(BaseModel):
    type: str = Field(..., description="Condition type from RuleConditionType enum")
    value: Optional[str] = Field("", description="Condition value (empty for 'Conversation starts')")
    
    @field_validator('value', mode='before')
    @classmethod
    def convert_none_to_empty(cls, v):
        """Convert None values to empty string"""
        return "" if v is None else v

class RuleAction(BaseModel):
    type: str = Field(..., description="Action type from RuleActionType enum")
    value: str = Field(..., description="Action value/content")

class Rule(BaseModel):
    rule_id: str = Field(..., description="Unique rule identifier")
    agent_id: str = Field(..., description="Agent ID this rule belongs to")
    name: str = Field("", description="Rule name (auto-generated if empty)")
    conditions: List[RuleCondition] = Field(..., description="List of WHEN conditions")
    match_type: RuleMatchType = Field(RuleMatchType.ANY, description="Match type: ANY (OR) or ALL (AND)")
    actions: List[RuleAction] = Field(..., description="List of DO actions")
    priority: int = Field(1, description="Rule priority (higher = evaluated first)")
    active: bool = Field(True, description="Whether rule is active")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Backward compatibility - expose first condition/action as 'when'/'do'
    @property
    def when(self) -> Optional[RuleCondition]:
        return self.conditions[0] if self.conditions else None
    
    @property
    def do(self) -> Optional[RuleAction]:
        return self.actions[0] if self.actions else None

class ChatLog(BaseModel):
    chat_id: str = Field(..., description="Unique chat log identifier")
    agent_id: str = Field(..., description="Agent ID")
    user_id: str = Field(..., description="User ID")
    session_id: str = Field(..., description="Session ID")
    message: str = Field(..., description="User message")
    response: str = Field(..., description="Agent response")
    conditions_detected: List[Dict[str, Any]] = Field(default_factory=list, description="Conditions detected")
    rule_matched: Optional[str] = Field(None, description="Rule ID if rule matched")
    kb_used: List[str] = Field(default_factory=list, description="Knowledge IDs used")
    llm_used: bool = Field(True, description="Whether LLM was used")
    trace: Dict[str, Any] = Field(default_factory=dict, description="Full trace data")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Request/Response Models
class AgentCreateRequest(BaseModel):
    session_id: str = Field(..., description="Session ID")
    agent_description: Optional[str] = Field(None, description="Free-text description of the agent (needed unless copying)")
    user_id: Optional[str] = Field(None, description="User ID (optional, defaults to session_id if not provided)")
    stage: Literal["assistant", "rag", "agent"] = Field("assistant", description="Day 2 stage")
    copy_from_agent_id: Optional[str] = Field(None, description="Start from this agent of the same session")
    project_name: Optional[str] = Field(None, max_length=120, description="Project name shown in the list")

class AgentCreateResponse(BaseModel):
    success: bool = True
    data: Agent

class KnowledgeTextRequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID")
    session_id: Optional[str] = Field(None, description="Session ID for traceability")
    content: str = Field(..., description="Text content")

class KnowledgeFileRequest(BaseModel):
    """Request model for file upload (used with form data, not JSON body)"""
    agent_id: str = Field(..., description="Agent ID")
    session_id: Optional[str] = Field(None, description="Session ID for traceability")
    # Note: file is handled separately via FastAPI's UploadFile

class KnowledgeFileResponse(BaseModel):
    """Response model for file KB upload"""
    success: bool = True
    knowledge_ids: List[str] = Field(..., description="List of created knowledge chunk IDs")
    chunks_added: int = Field(..., description="Number of chunks created")
    file_name: str = Field(..., description="Uploaded file name")
    file_type: str = Field(..., description="File type (pdf, xlsx, csv, txt)")
    file_url: str = Field(..., description="GCS URL of uploaded file")
    extracted_chars: int = Field(..., description="Number of characters extracted")
    message: str = Field(..., description="Status message")

class KnowledgeLinkRequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID")
    session_id: Optional[str] = Field(None, description="Session ID for traceability")
    url: str = Field(..., description="URL to fetch")

class KnowledgeQnARequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID")
    question: str = Field(..., description="Question")
    answer: str = Field(..., description="Answer")

class KnowledgeResponse(BaseModel):
    success: bool = True
    knowledge_id: str
    message: str

class RuleSaveRequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID")
    rule_id: Optional[str] = Field(None, description="Rule ID for updates (omit for new rules)")
    name: str = Field("", description="Rule name (auto-generated if empty)")
    conditions: List[RuleCondition] = Field(..., description="List of WHEN conditions")
    match_type: str = Field("ANY", description="Match type: ANY (OR) or ALL (AND)")
    actions: List[RuleAction] = Field(..., description="List of DO actions")
    priority: int = Field(1, description="Rule priority")

class RuleResponse(BaseModel):
    success: bool = True
    data: Rule

class RuleListResponse(BaseModel):
    success: bool = True
    data: List[Rule]

class ChatRequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID")
    session_id: str = Field(..., description="Session ID")
    message: str = Field(..., description="User message")
    user_id: Optional[str] = Field(None, description="User ID (optional, defaults to session_id if not provided)")

class ChatResponse(BaseModel):
    success: bool = True
    response: str
    trace: Dict[str, Any] = Field(default_factory=dict, description="Full trace data")
    images: List[Dict[str, Any]] = Field(default_factory=list, description="Related images from search")
    chat_id: Optional[str] = Field(None, description="Chat log ID")

class ChatTeachRequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID")
    chat_id: str = Field(..., description="Chat log ID")
    approved_response: str = Field(..., description="Approved response to teach")

class ChatTeachResponse(BaseModel):
    success: bool = True
    knowledge_id: str
    message: str

class CleanupRequest(BaseModel):
    days_old: int = Field(7, ge=1, description="Delete agents older than N days")

class CleanupResponse(BaseModel):
    success: bool = True
    deleted_count: int
    message: str

# Chat History Models (Playground AI-like)
class ChatMessage(BaseModel):
    """Individual chat message"""
    message_id: str
    role: str = Field(..., description="Message role: 'user' or 'assistant'")
    content: str = Field(..., description="Message content")
    created_at: datetime = Field(..., description="Message timestamp")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Additional message metadata")

class Chat(BaseModel):
    """Chat session with messages"""
    chat_id: str = Field(..., description="Unique chat identifier")
    agent_id: str = Field(..., description="Associated agent ID")
    session_id: str = Field(..., description="Session ID (for ongoing chat)")
    messages: List[ChatMessage] = Field(default_factory=list, description="List of messages in this chat")
    created_at: datetime = Field(..., description="Chat creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")
    is_active: bool = Field(True, description="True for ongoing chat, False for archived")
    title: Optional[str] = Field(None, description="Optional chat title")
    message_count: int = Field(0, description="Total number of messages")

class CreateChatRequest(BaseModel):
    """Request to create a new chat"""
    agent_id: str = Field(..., description="Agent ID")
    session_id: Optional[str] = Field(None, description="Optional session ID")

class CreateChatResponse(BaseModel):
    """Response after creating a chat"""
    success: bool = True
    chat: Chat

class GetChatsResponse(BaseModel):
    """Response for getting all chats"""
    success: bool = True
    chats: List[Chat]
    ongoing_chat: Optional[Chat] = Field(None, description="The currently active chat")

class GetChatResponse(BaseModel):
    """Response for getting a single chat"""
    success: bool = True
    chat: Chat

class ArchiveChatRequest(BaseModel):
    """Request to archive a chat"""
    chat_id: str = Field(..., description="Chat ID to archive")

class ArchiveChatResponse(BaseModel):
    """Response after archiving a chat"""
    success: bool = True
    message: str = "Chat archived successfully"

class DeleteChatResponse(BaseModel):
    """Response after deleting a chat"""
    success: bool = True
    message: str = "Chat deleted successfully"


# ---------------------------------------------------------------------------
# Rule Based Process (isolated workspace persistence)
# ---------------------------------------------------------------------------

class RbpAnswerRule(BaseModel):
    type: str = Field("text", description="text | number | int")
    min: Optional[float] = None
    max: Optional[float] = None
    noun: Optional[str] = None
    # Frontend flags (Edit concept / Python Build) — persist so reload keeps answer mode
    fromEdit: Optional[bool] = None
    fromBuild: Optional[bool] = None


class RbpTestCase(BaseModel):
    inputs: List[str] = Field(default_factory=list, alias="in", description="Answers typed during the run")
    out: str = Field("", description="Expected say/print output")

    model_config = {"populate_by_name": True}


class RbpConcept(BaseModel):
    id: str
    title: str = ""
    brief: str = ""
    vars: List[str] = Field(default_factory=list)
    answer: RbpAnswerRule = Field(default_factory=RbpAnswerRule)
    tests: List[RbpTestCase] = Field(default_factory=list)


class RbpPan(BaseModel):
    x: float = 40
    y: float = 30


class RbpWorkspaceState(BaseModel):
    """Serializable workspace: concepts + block stacks (JSON trees)."""
    version: int = 1
    pan: RbpPan = Field(default_factory=RbpPan)
    zoom: float = Field(1.0, description="Canvas zoom factor from the editor")
    active_concept_id: Optional[str] = None
    concepts: List[RbpConcept] = Field(default_factory=list)
    stacks: List[Dict[str, Any]] = Field(default_factory=list, description="Block stacks with nested block trees")
    # When true, an empty canvas is intentional (Clear workspace) and must not
    # be replaced by a built-in concept solution on reload.
    empty_canvas: bool = False


class RuleBasedWorkspace(BaseModel):
    project_id: str
    session_id: str
    state: RbpWorkspaceState = Field(default_factory=RbpWorkspaceState)
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RuleBasedWorkspaceUpdate(BaseModel):
    state: RbpWorkspaceState


class RuleBasedWorkspaceResponse(BaseModel):
    success: bool = True
    data: RuleBasedWorkspace


class RuleBasedWorkspaceDeleteResponse(BaseModel):
    success: bool = True
    message: str = "Workspace deleted"


class ScratchProjectSaveResponse(BaseModel):
    """Result of saving a Rule Based Process project's Scratch file."""
    savedAt: datetime
    sizeBytes: int
    version: int


class ScratchProjectMetaResponse(BaseModel):
    """Saved-state summary for a Rule Based Process project, without the file itself."""
    savedAt: Optional[datetime] = None
    sizeBytes: Optional[int] = None
    version: int = 0
    editor: str = "scratch"


class RuleBasedAskRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000, description="Question or text for the model")


class RuleBasedAskResponse(BaseModel):
    success: bool = True
    reply: str = ""
    prompt: str = ""


class LodCaptionObject(BaseModel):
    class_name: str = Field("", alias="className")
    score: float = 0
    color_name: Optional[str] = Field(None, alias="colorName")

    model_config = {"populate_by_name": True}


class LodCaptionRequest(BaseModel):
    image_base64: str = Field(..., min_length=32, max_length=2_500_000)
    detections: List[LodCaptionObject] = Field(default_factory=list)
    recent_events: List[str] = Field(default_factory=list, max_length=8)


class LodVisionObject(BaseModel):
    name: str = ""
    score: float = 0.85
    box: List[float] = Field(default_factory=list, description="[ymin, xmin, ymax, xmax] in 0-1000")


class LodCaptionResponse(BaseModel):
    success: bool = True
    caption: str = ""
    objects: List[LodVisionObject] = Field(default_factory=list)


class LodDetectRequest(BaseModel):
    image_base64: str = Field(..., min_length=32, max_length=2_500_000)


class LodDetectResponse(BaseModel):
    success: bool = True
    objects: List[LodVisionObject] = Field(default_factory=list)


class ExerciseProgress(BaseModel):
    status: str = Field("not_started", description="not_started | in_progress | completed")
    notes: str = ""
    snapshot: Dict[str, Any] = Field(default_factory=dict)


class ExercisesWorkspaceState(BaseModel):
    version: int = 1
    progress: Dict[str, ExerciseProgress] = Field(default_factory=dict)
    activeId: Optional[int] = None
    ex2Result: Optional[Dict[str, Any]] = None


class ExercisesWorkspace(BaseModel):
    project_id: str
    session_id: str
    state: ExercisesWorkspaceState = Field(default_factory=ExercisesWorkspaceState)
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ExercisesWorkspaceUpdate(BaseModel):
    state: ExercisesWorkspaceState


class ExercisesWorkspaceResponse(BaseModel):
    success: bool = True
    data: ExercisesWorkspace


class ExercisesWorkspaceDeleteResponse(BaseModel):
    success: bool = True
    message: str = "Workspace deleted"


class ExercisesChatExample(BaseModel):
    user: str = ""
    assistant: str = ""


class ExercisesGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=12000)
    system: Optional[str] = Field(None, max_length=8000)
    examples: List[ExercisesChatExample] = Field(default_factory=list)
    model: str = Field("gemini-3.8-flash")
    temperature: float = Field(0.7, ge=0.0, le=2.0)
    n: int = Field(1, ge=1, le=10)
    max_tokens: int = Field(400, ge=32, le=2048)


class ExercisesGenerateResponse(BaseModel):
    success: bool = True
    outputs: List[str] = Field(default_factory=list)
    model: str = ""
    temperature: float = 0.7
    simulated: bool = False


class ExercisesEmbedRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=12)
    model: str = Field("text-embedding-005")


class ExercisesEmbedResponse(BaseModel):
    success: bool = True
    embeddings: List[List[float]] = Field(default_factory=list)
    model: str = ""
    simulated: bool = False
    dimensions: int = 0


class ExercisesTfidfRow(BaseModel):
    review: str = Field(..., min_length=1, max_length=4000)
    sentiment: Optional[str] = Field(None, max_length=80)
    label: Optional[str] = Field(None, max_length=80)
    y: Optional[int] = Field(None, ge=0, le=20)


class ExercisesTextPrep(BaseModel):
    drop_missing: bool = True
    drop_duplicates: bool = True
    lowercase: bool = True
    strip_noise: bool = True
    stopwords: bool = False
    lemmatize: bool = False


class ExercisesTfidfTrainRequest(BaseModel):
    rows: List[ExercisesTfidfRow] = Field(default_factory=list, min_length=0, max_length=40000)
    dataset_id: Optional[str] = Field(None, max_length=40)
    test_size: float = Field(..., ge=0.1, le=0.3)
    seed: int = Field(..., ge=0, le=2_147_483_647)
    max_features: int = Field(..., ge=50, le=8000)
    ngram_min: int = Field(..., ge=1, le=3)
    ngram_max: int = Field(..., ge=1, le=3)
    min_df: int = Field(..., ge=1, le=50)
    regularization_c: float = Field(..., ge=0.1, le=10.0)
    solver: str = Field(...)
    max_iter: int = Field(..., ge=50, le=5000)
    epochs: int = Field(..., ge=10, le=2000)
    threshold: float = Field(..., ge=0.05, le=0.95)
    representation: str = Field("tfidf")
    text_prep: Optional["ExercisesTextPrep"] = None

    @model_validator(mode="after")
    def require_rows_or_dataset(self):
        dataset_id = (self.dataset_id or "").strip().lower()
        self.dataset_id = dataset_id or None
        if self.dataset_id:
            return self
        if len(self.rows) < 4:
            raise ValueError("Need at least 4 labeled rows, or a department dataset_id.")
        return self


class ExercisesTfidfTestProb(BaseModel):
    y: int
    p: float
    pred: Optional[int] = None
    label: Optional[str] = None
    pred_label: Optional[str] = None
    probs: List[float] = Field(default_factory=list)


class ExercisesTfidfWordWeight(BaseModel):
    word: str
    weight: float
    label: str = ""


class ExercisesTfidfClassBelief(BaseModel):
    label: str
    words: List[str] = Field(default_factory=list)


class ExercisesTfidfCurvePoint(BaseModel):
    epoch: int = 0
    loss: float
    acc: float
    train_acc: float = 0.0
    prec: float = 0.0
    rec: float = 0.0
    f1: float = 0.0
    pos_words: List[str] = Field(default_factory=list)
    neg_words: List[str] = Field(default_factory=list)
    class_words: List[ExercisesTfidfClassBelief] = Field(default_factory=list)


class ExercisesTfidfExportedModel(BaseModel):
    vocab: List[str] = Field(default_factory=list)
    idf: List[float] = Field(default_factory=list)
    weights: Union[List[float], List[List[float]]] = Field(default_factory=list)
    bias: Union[float, List[float]] = 0.0
    classes: List[str] = Field(default_factory=list)
    ngram_min: int = 1
    ngram_max: int = 1
    representation: str = "tfidf"


class ExercisesTfidfTrainResponse(BaseModel):
    success: bool = True
    simulated: bool = False
    n_train: int = 0
    n_test: int = 0
    n_features: int = 0
    n_classes: int = 2
    classes: List[str] = Field(default_factory=list)
    class_counts: Dict[str, int] = Field(default_factory=dict)
    n_positive: int = 0
    n_negative: int = 0
    baseline: float = 0.0
    n_epochs: int = 0
    epochs: int = 100
    train_accuracy: float = 0.0
    test_accuracy: float = 0.0
    test_precision: float = 0.0
    test_recall: float = 0.0
    test_f1: float = 0.0
    cv_accuracy: float = 0.0
    solver: str = "lbfgs"
    regularization_c: float = 1.0
    max_features: int = 1000
    ngram_min: int = 1
    ngram_max: int = 2
    min_df: int = 1
    max_iter: int = 500
    test_size: float = 0.2
    seed: int = 42
    threshold: float = 0.5
    representation: str = "tfidf"
    curve_kind: str = "holdout"
    test_probs: List[ExercisesTfidfTestProb] = Field(default_factory=list)
    confusion_matrix: List[List[int]] = Field(default_factory=list)
    word_weights: List[ExercisesTfidfWordWeight] = Field(default_factory=list)
    class_beliefs: List[ExercisesTfidfClassBelief] = Field(default_factory=list)
    curve: List[ExercisesTfidfCurvePoint] = Field(default_factory=list)
    model: ExercisesTfidfExportedModel = Field(default_factory=ExercisesTfidfExportedModel)


class ExercisesTfidfPredictRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class ExercisesTfidfTokenScore(BaseModel):
    word: str
    contribution: float = 0.0
    tfidf: float = 0.0


class ExercisesTfidfClassProb(BaseModel):
    label: str
    p: float


class ExercisesTfidfPredictResponse(BaseModel):
    success: bool = True
    probability: float = 0.5
    label: str = ""
    classes: List[str] = Field(default_factory=list)
    probs: List[ExercisesTfidfClassProb] = Field(default_factory=list)
    known_tokens: int = 0
    chips: List[ExercisesTfidfTokenScore] = Field(default_factory=list)
    features: List[ExercisesTfidfTokenScore] = Field(default_factory=list)


class ExercisesTfidfSampleResponse(BaseModel):
    success: bool = True
    csv: str = ""
    n_rows: int = 0


class ExercisesTfidfDatasetInfo(BaseModel):
    id: str
    name: str
    short: str = ""
    theme: str = ""
    source: str = ""
    use_case: str = ""
    filename: str = ""
    classes: List[str] = Field(default_factory=list)
    n_rows: int = 0


class ExercisesTfidfDatasetListResponse(BaseModel):
    success: bool = True
    datasets: List[ExercisesTfidfDatasetInfo] = Field(default_factory=list)


class ExercisesTfidfDatasetExample(BaseModel):
    label: str
    text: str


class ExercisesTfidfDatasetRow(BaseModel):
    review: str
    label: str


class ExercisesTfidfInspectStats(BaseModel):
    empty_text: int = 0
    empty_label: int = 0
    extra: int = 0
    groups: int = 0
    label_in_text: int = 0
    mixed_labels: int = 0
    n_rows: int = 0


class ExercisesTfidfDatasetResponse(BaseModel):
    success: bool = True
    id: str
    name: str
    short: str = ""
    theme: str = ""
    source: str = ""
    use_case: str = ""
    filename: str = ""
    classes: List[str] = Field(default_factory=list)
    counts: Dict[str, int] = Field(default_factory=dict)
    n_rows: int = 0
    rows: List[ExercisesTfidfDatasetRow] = Field(default_factory=list)
    examples: List[ExercisesTfidfDatasetExample] = Field(default_factory=list)
    inspect: Optional[ExercisesTfidfInspectStats] = None


# ---------------------------------------------------------------------------
# Rules Bot (Rule Based Process projects): keyword rules that route a message to a team
# ---------------------------------------------------------------------------

RULES_BOT_MAX_RULES = 30
RULES_BOT_MAX_KEYWORDS = 50
RULES_BOT_DEFAULT_REPLY = "Sorry, I didn't understand. A person will reply."


class RulesBotSampleRule(BaseModel):
    desk: str = Field(..., min_length=1, max_length=60)
    keywords: List[str] = Field(..., min_length=1, max_length=RULES_BOT_MAX_KEYWORDS)


class RulesBotSample(BaseModel):
    """A ready-made rule set offered in the Samples menu (collection rules_bot_samples)."""
    id: str
    name: str
    summary: str = ""
    reply: str = RULES_BOT_DEFAULT_REPLY
    rules: List[RulesBotSampleRule] = Field(default_factory=list)
    order: int = 0


class RulesBotSampleListResponse(BaseModel):
    success: bool = True
    data: List[RulesBotSample]


class RulesBotSampleResponse(BaseModel):
    success: bool = True
    data: RulesBotSample


class RulesBotRule(BaseModel):
    id: str = Field(..., min_length=1, max_length=40)
    desk: str = Field("", max_length=60)
    color: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    keywords: List[str] = Field(default_factory=list, max_length=RULES_BOT_MAX_KEYWORDS)

    @field_validator("keywords")
    @classmethod
    def _clean_keywords(cls, v: List[str]) -> List[str]:
        # Trim, drop blanks and case-insensitive duplicates, keep the user's order
        seen, out = set(), []
        for k in v:
            k = k.strip()
            if not k:
                continue
            if len(k) > 60:
                raise ValueError("Keywords must be 60 characters or fewer")
            if k.lower() not in seen:
                seen.add(k.lower())
                out.append(k)
        return out


class RulesBotBoardState(BaseModel):
    rules: List[RulesBotRule] = Field(default_factory=list, max_length=RULES_BOT_MAX_RULES)
    reply: str = Field(RULES_BOT_DEFAULT_REPLY, max_length=300)
    sampleId: Optional[str] = Field(None, max_length=60)


class RulesBotBoard(RulesBotBoardState):
    """A project's rule board (collection rules_bot_boards, document id = project id)."""
    project_id: str
    session_id: str
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RulesBotBoardResponse(BaseModel):
    success: bool = True
    data: RulesBotBoard


class RulesBotLoadSampleRequest(BaseModel):
    sampleId: str = Field(..., min_length=1, max_length=60)


# ---------------------------------------------------------------------------
# Confusion Matrix projects (Exercise 3): open a trained model (the learner's Ex 2 model or a
# shared pre-trained one), retrain logistic regression with other settings, compare runs.
# Two classes; class 0 is the class we care about, its score is P(class 0).
# ---------------------------------------------------------------------------

CM_THRESHOLDS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


class CMParams(BaseModel):
    """Settings for both models; each run uses its model's fields (cm_trainer.FIT_KEYS) plus the threshold."""
    threshold: float = Field(0.5, ge=0.05, le=0.95)
    testSplit: float = Field(0.2, ge=0.1, le=0.3)
    # logistic regression
    C: float = Field(1.0, ge=0.001, le=1000)
    ngrams: int = Field(2, ge=1, le=2)
    maxFeatures: int = Field(5000, ge=50, le=20000)
    maxIter: int = Field(100, ge=1, le=5000)
    # DistilBERT
    maxLen: int = Field(64, ge=8, le=128)  # tokens read per text
    epochs: int = Field(5, ge=1, le=50)  # training rounds
    lr: float = Field(0.01, ge=0.0001, le=1.0)  # learning rate
    batch: int = Field(16, ge=4, le=128)


class CMDatasetInfo(BaseModel):
    id: str
    name: str
    classes: List[str]  # [class we care about, other class]
    short: List[str]
    noun: str
    source: str
    licence: str = ""
    blurb: str = ""
    counts: List[int] = Field(default_factory=list)
    n: int = 0


class CMDatasetListResponse(BaseModel):
    success: bool = True
    data: List[CMDatasetInfo]


class CMMetrics(BaseModel):
    tp: int
    fn: int
    fp: int
    tn: int
    n: int
    accuracy: float
    precision: float
    recall: float
    f1: float


class CMRunSummary(BaseModel):
    """One training run, without its per-example arrays."""
    id: str
    no: int
    source: str  # 'ex2' | 'pre'
    datasetKey: str
    kind: str  # 'ex2' | 'pre' | 'retrain'
    model: str = "lr"
    params: CMParams
    trainN: int
    m: CMMetrics
    modelSaved: bool = False
    reusedFit: bool = False  # only the threshold changed: same fitted model, new decision line
    createdAt: datetime


class CMEx2Snapshot(BaseModel):
    """The Ex 2 model this project opened, copied at the time (Ex 2 itself is never changed)."""
    kind: str = "exercises"  # 'textrec' = Text Recognition project, 'exercises' = Exercises lab Ex 2
    projectId: str
    projectName: str
    datasetId: str = ""
    datasetName: str
    datasetKey: str = ""
    classes: List[str]  # [target, other]
    labels: List[str] = Field(default_factory=list)  # every label the Ex 2 model knows
    params: CMParams
    seed: int = 42
    textPrep: Optional[Dict[str, bool]] = None
    trainedAt: Optional[datetime] = None


class CMState(BaseModel):
    """Where the learner is: restored on every visit."""
    source: Optional[str] = Field(None, pattern=r"^(ex2|pre)$")
    datasetId: Optional[str] = Field(None, max_length=40)  # sample dataset id when source == 'pre'
    model: str = Field("lr", pattern=r"^(lr|bert)$")
    level: str = Field("basic", pattern=r"^(basic|intermediate|advanced)$")
    params: CMParams = Field(default_factory=CMParams)
    selectedRunId: Optional[str] = Field(None, max_length=60)


class CMProjectOut(BaseModel):
    project_id: str
    state: CMState
    ex2: Optional[CMEx2Snapshot] = None
    dataset: Optional[CMDatasetInfo] = None  # dataset of the current scope
    runs: List[CMRunSummary] = Field(default_factory=list)


class CMProjectResponse(BaseModel):
    success: bool = True
    data: CMProjectOut


class CMEx2RunSummary(BaseModel):
    kind: str = "exercises"  # 'textrec' | 'exercises'
    projectId: str
    projectName: str
    datasetId: Optional[str] = None
    datasetName: str = ""
    classes: List[str]  # [default target, other]
    labels: List[str] = Field(default_factory=list)
    labelCounts: Dict[str, int] = Field(default_factory=dict)
    nExamples: int = 0
    modelType: str = ""
    params: Optional[CMParams] = None
    accuracy: Optional[float] = None
    nTest: int = 0
    usable: bool = False
    reason: str = ""
    updatedAt: Optional[datetime] = None


class CMEx2RunListResponse(BaseModel):
    success: bool = True
    data: List[CMEx2RunSummary]


class CMOpenRequest(BaseModel):
    source: str = Field(..., pattern=r"^(ex2|pre)$")
    datasetId: Optional[str] = Field(None, max_length=40)
    ex2ProjectId: Optional[str] = Field(None, max_length=80)
    target: Optional[str] = Field(None, max_length=100)  # class we care about (Text Recognition labels)

    @model_validator(mode="after")
    def _check(self):
        if self.source == "pre" and not self.datasetId:
            raise ValueError("Choose a dataset.")
        if self.source == "ex2" and not self.ex2ProjectId:
            raise ValueError("Choose your Exercise 2 run.")
        return self


class CMTrainRequest(BaseModel):
    model: str = Field("lr", pattern=r"^(lr|bert)$")
    params: CMParams


class CMStateRequest(BaseModel):
    model: Optional[str] = Field(None, pattern=r"^(lr|bert)$")
    level: Optional[str] = Field(None, pattern=r"^(basic|intermediate|advanced)$")
    params: Optional[CMParams] = None
    selectedRunId: Optional[str] = Field(None, max_length=60)


class CMSampleRow(BaseModel):
    text: str
    y: int


class CMSampleResponse(BaseModel):
    success: bool = True
    data: List[CMSampleRow]


class CMExample(BaseModel):
    text: str
    score: float


class CMExamplesResponse(BaseModel):
    success: bool = True
    data: List[CMExample]
    total: int = 0


# ---------------------------------------------------------------------------
# RAG Chatbot projects: documents → chunks → search → grounded answers → test set.
# Responses are documented in services/rag_chatbot_service.py (Firestore layout) and
# frontend/components/RagChatbot/types.ts.
# ---------------------------------------------------------------------------


class RagChunking(BaseModel):
    mode: str = Field("sections", pattern=r"^(sections|words)$")
    size: int = Field(60, ge=20, le=400)  # words per chunk (words mode)
    overlap: int = Field(10, ge=0, le=200)


class RagRetrieval(BaseModel):
    method: str = Field("meaning", pattern=r"^(meaning|keyword)$")
    k: int = Field(3, ge=1, le=8)
    minScore: float = Field(0.0, ge=0.0, le=1.0)


class RagAnswer(BaseModel):
    model: str = Field("gemini-flash-lite", max_length=60)
    temperature: float = Field(0.2, ge=0.0, le=2.0)
    strict: bool = True
    useDocuments: bool = True


class RagStateRequest(BaseModel):
    step: Optional[int] = Field(None, ge=1, le=5)
    chunking: Optional[RagChunking] = None
    embeddingModel: Optional[str] = Field(None, max_length=60)
    retrieval: Optional[RagRetrieval] = None
    answer: Optional[RagAnswer] = None


class RagLibraryRequest(BaseModel):
    libraryId: str = Field(..., max_length=80)


class RagPreviewRequest(BaseModel):
    chunking: RagChunking


class RagSearchRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    k: int = Field(3, ge=1, le=8)
    minScore: float = Field(0.0, ge=0.0, le=1.0)


class RagAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    testQuestionId: Optional[str] = Field(None, max_length=20)
    retrieval: Optional[RagRetrieval] = None  # default: the project's settings
    answer: Optional[RagAnswer] = None


class RagVerdictRequest(BaseModel):
    verdict: Optional[str] = Field(None, pattern=r"^(grounded|made-up|refused)$")


class RagEvalRequest(BaseModel):
    questionIds: Optional[List[str]] = Field(None, max_length=20)
    retrieval: Optional[RagRetrieval] = None
    answer: Optional[RagAnswer] = None


# ---------------------------------------------------------------------------
# AI Agent projects: instructions + tools + the agent loop with a trace, guardrails, test prompts.
# Responses are documented in services/ai_agent_service.py and frontend/components/AiAgent/types.ts.
# ---------------------------------------------------------------------------


class AgentSettingsIn(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    instructions: Optional[str] = Field(None, min_length=1, max_length=4000)
    model: Optional[str] = Field(None, max_length=60)
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)


class AgentGuardIn(BaseModel):
    blockRiskyActions: bool = True


class AgentStateRequest(BaseModel):
    step: Optional[int] = Field(None, ge=1, le=5)
    agent: Optional[AgentSettingsIn] = None
    enabled: Optional[List[str]] = Field(None, max_length=20)  # tool names
    guard: Optional[AgentGuardIn] = None


class AgentOwnFunction(BaseModel):
    name: str = Field(..., max_length=64)
    desc: str = Field("", max_length=2000)
    schema_: Dict[str, Any] = Field(default_factory=dict, alias="schema")

    model_config = ConfigDict(populate_by_name=True)


class AgentOwnToolRequest(BaseModel):
    source: str = Field(..., min_length=1, max_length=20000)
    functions: List[AgentOwnFunction] = Field(..., max_length=8)
    notes: List[str] = Field(default_factory=list, max_length=40)


class AgentTurnRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    chat: str = Field("current", pattern=r"^(current|baseline)$")  # baseline = step 2, no tools
    useTools: bool = True
    evalId: Optional[str] = Field(None, max_length=40)
    testPromptId: Optional[str] = Field(None, max_length=10)


class AgentToolResult(BaseModel):
    callId: str = Field(..., max_length=60)
    ok: bool
    output: Optional[str] = Field(None, max_length=20000)
    error: Optional[str] = Field(None, max_length=4000)
    ms: int = Field(0, ge=0)


class AgentResumeRequest(BaseModel):
    results: List[AgentToolResult] = Field(..., min_length=1, max_length=20)


class AgentEvalRequest(BaseModel):
    promptIds: Optional[List[str]] = Field(None, max_length=20)
    useTools: bool = True
