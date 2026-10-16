import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from google.cloud import firestore

from ..models import (
    Agent, Persona, AgentCreateRequest, PersonaUpdateRequest, AgentSettings, SettingsUpdateRequest,
    AgentGuardrails, GuardrailsUpdateRequest,
)
from ..config import gcp_clients
from . import agent_stages
from .vertex_ai_service import VertexAIService

logger = logging.getLogger(__name__)


class AgentAccessError(PermissionError):
    """The agent belongs to another session (403)."""


class AgentRequestError(ValueError):
    """A request the participant can fix (400)."""


class AgentService:
    """Service layer for agent management operations"""
    
    def __init__(self):
        self._firestore_client = None
        self._project_id = None
        self._agents_collection = None
        self._personas_collection = None
        self._settings_collection = None
        self._guardrails_collection = None
        self._vertex_ai = None
        self._initialized = False
    
    def _ensure_initialized(self):
        """Lazy initialization - only initialize when first accessed"""
        if self._initialized:
            return
        
        try:
            self._firestore_client = gcp_clients.get_firestore_client()
            self._project_id = gcp_clients.get_project_id()
            
            # Initialize collections
            self._agents_collection = self._firestore_client.collection('agents')
            self._personas_collection = self._firestore_client.collection('personas')
            self._settings_collection = self._firestore_client.collection('agent_settings')
            self._guardrails_collection = self._firestore_client.collection('agent_guardrails')
            
            # Initialize Vertex AI service
            self._vertex_ai = VertexAIService(self._project_id)
            
            self._initialized = True
            logger.info("✅ AgentService initialized")
        except Exception as e:
            logger.warning(f"⚠️ AgentService initialization deferred (will retry on first use): {e}")
            # Don't raise - allow schema generation to proceed
    
    @property
    def firestore_client(self):
        self._ensure_initialized()
        return self._firestore_client
    
    @property
    def project_id(self):
        if self._project_id is None:
            self._project_id = gcp_clients.get_project_id()
        return self._project_id
    
    @property
    def agents_collection(self):
        self._ensure_initialized()
        return self._agents_collection
    
    @property
    def personas_collection(self):
        self._ensure_initialized()
        return self._personas_collection
    
    @property
    def settings_collection(self):
        self._ensure_initialized()
        return self._settings_collection
    
    @property
    def guardrails_collection(self):
        self._ensure_initialized()
        return self._guardrails_collection

    @property
    def vertex_ai(self):
        self._ensure_initialized()
        return self._vertex_ai
    
    def create_agent(self, request: AgentCreateRequest) -> Agent:
        """Create a new agent: from a description (Gemini drafts name, role and tone), or, for Day 2 stages,
        starting from an earlier agent of the same session (persona, model, guardrails, actions, and for
        AI Agent the knowledge base are copied)."""
        if request.copy_from_agent_id:
            return self._create_from(request)
        if not (request.agent_description or "").strip():
            raise AgentRequestError("Describe your agent, or start from an earlier one.")
        try:
            # Use session_id as user_id if user_id is not provided
            user_id = request.user_id if request.user_id else request.session_id

            logger.info(f"Creating agent for session: {request.session_id} (stage {request.stage})")
            
            # Generate agent specification using Vertex AI
            spec = self.vertex_ai.generate_agent_specification(request.agent_description)
            
            # Generate agent ID
            agent_id = f"AGENT_{uuid.uuid4().hex[:12].upper()}"
            
            # Create agent document
            agent_data = {
                "agent_id": agent_id,
                "user_id": user_id,
                "session_id": request.session_id,
                "name": spec["name"],
                "role": spec["role"],
                "tone": spec["tone"],
                "language": spec["language"],
                "description": request.agent_description,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
                "active": True,
                "stage": request.stage,
                "project_name": (request.project_name or "").strip() or None,
                "copied_from": None,
            }
            
            # Save agent to Firestore
            agent_ref = self.agents_collection.document(agent_id)
            agent_ref.set(agent_data)
            
            # Create persona document
            persona_data = {
                "agent_id": agent_id,
                "name": spec["name"],
                "role": spec["role"],
                "tone": spec["tone"],
                "language": spec["language"],
                "response_length": "short",  # Default response length
                # The description is the persona itself: sent to the model in every reply (WHO YOU ARE) and
                # editable in AI PERSONA. Instructions (Rules & Guardrails) start empty, for the learner's own rules
                "description": request.agent_description.strip(),
                "guidelines": "",
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc)
            }
            
            persona_ref = self.personas_collection.document(agent_id)
            persona_ref.set(persona_data)

            # The stage's default model (AI Agent starts on Flash: it calls tools more reliably)
            now = datetime.now(timezone.utc)
            self.settings_collection.document(agent_id).set({
                "agent_id": agent_id, "model": agent_stages.DEFAULT_MODEL[request.stage],
                "embedding_model": agent_stages.DEFAULT_EMBEDDING, "similarity": agent_stages.DEFAULT_SIMILARITY,
                "created_at": now, "updated_at": now})

            logger.info(f"✅ Agent created: {agent_id}")
            
            return Agent(**agent_data)
            
        except Exception as e:
            logger.error(f"❌ Failed to create agent: {e}")
            raise Exception(f"Failed to create agent: {str(e)}")
    
    def _create_from(self, request: AgentCreateRequest) -> Agent:
        """A new staged agent that starts from an earlier agent of the same session."""
        src = self.get_agent(request.copy_from_agent_id)
        if not src:
            raise AgentRequestError("The agent to start from no longer exists. Choose another or start fresh.")
        if src.session_id != request.session_id:
            raise AgentAccessError("That agent belongs to another session.")
        db = self.firestore_client
        src_id = src.agent_id
        persona = self.personas_collection.document(src_id).get()
        settings = self.settings_collection.document(src_id).get()
        guard = self.guardrails_collection.document(src_id).get()
        source = {
            "agent": src.model_dump(),
            "persona": persona.to_dict() if persona.exists else {"name": src.name, "role": src.role, "tone": src.tone,
                                                                 "language": src.language, "response_length": "short",
                                                                 "guidelines": ""},
            "settings": settings.to_dict() if settings.exists else None,
            "guardrails": guard.to_dict() if guard.exists else None,
            "rules": [d.to_dict() for d in db.collection("rules").where("agent_id", "==", src_id).stream()],
            "kb": None,
        }
        if request.stage == "agent":
            kb_ref = db.collection("agent_kb").document(src_id)
            kb_snap = kb_ref.get()
            if kb_snap.exists:
                source["kb"] = {"documents": (kb_snap.to_dict() or {}).get("documents") or [],
                                "chunks": [{"id": c.id, **c.to_dict()} for c in kb_ref.collection("chunks").stream()]}

        agent_id = f"AGENT_{uuid.uuid4().hex[:12].upper()}"
        plan = agent_stages.plan_copy(source, agent_id, request.stage, lambda: f"RULE_{uuid.uuid4().hex[:12].upper()}")
        now = datetime.now(timezone.utc)
        p = plan["persona"]
        agent_data = {
            "agent_id": agent_id, "user_id": request.user_id or request.session_id, "session_id": request.session_id,
            "name": p.get("name") or src.name, "role": p.get("role") or src.role, "tone": p.get("tone") or src.tone,
            "language": p.get("language") or src.language, "description": src.description,
            "created_at": now, "updated_at": now, "active": True, "stage": request.stage,
            "project_name": (request.project_name or "").strip() or None, "copied_from": plan["copied_from"],
        }
        batch = db.batch()
        batch.set(self.agents_collection.document(agent_id), agent_data)
        batch.set(self.personas_collection.document(agent_id), plan["persona"])
        batch.set(self.settings_collection.document(agent_id), plan["settings"])
        if plan["guardrails"]:
            batch.set(self.guardrails_collection.document(agent_id), plan["guardrails"])
        for r in plan["rules"]:
            batch.set(db.collection("rules").document(r["rule_id"]), r)
        batch.commit()
        if plan["kb_documents"]:
            if plan["blob_copies"]:
                bucket = gcp_clients.get_bucket()
                for b in plan["blob_copies"]:
                    bucket.copy_blob(bucket.blob(b["from"]), bucket, b["to"])
            kb_ref = db.collection("agent_kb").document(agent_id)
            batch, n = db.batch(), 0
            for c in plan["kb_chunks"]:
                cid = c.pop("id")
                batch.set(kb_ref.collection("chunks").document(cid), c)
                n += 1
                if n % 300 == 0:
                    batch.commit()
                    batch = db.batch()
            batch.commit()
            kb_ref.set({"documents": plan["kb_documents"], "updated_at": now})
        logger.info(f"✅ Agent {agent_id} ({request.stage}) created from {src_id}: {len(plan['rules'])} actions, "
                    f"{len(plan['kb_documents'])} documents, {len(plan['kb_chunks'])} passages")
        return Agent(**agent_data)

    def get_agent(self, agent_id: str) -> Optional[Agent]:
        """Get agent by ID"""
        try:
            agent_ref = self.agents_collection.document(agent_id)
            agent_doc = agent_ref.get()
            
            if not agent_doc.exists:
                return None
            
            agent_data = agent_doc.to_dict()
            return Agent(**agent_data)
            
        except Exception as e:
            logger.error(f"❌ Failed to get agent: {e}")
            raise Exception(f"Failed to get agent: {str(e)}")
    
    def get_persona(self, agent_id: str) -> Optional[Persona]:
        """Get persona by agent ID"""
        try:
            persona_ref = self.personas_collection.document(agent_id)
            persona_doc = persona_ref.get()
            
            if not persona_doc.exists:
                return None
            
            persona_data = persona_doc.to_dict()
            
            # Add default values for new fields if they don't exist in the database
            if 'response_length' not in persona_data:
                persona_data['response_length'] = 'short'
            if 'guidelines' not in persona_data:
                persona_data['guidelines'] = ''
            # Agents made before the persona kept its description: use the one saved on the agent
            if 'description' not in persona_data:
                agent_doc = self.agents_collection.document(agent_id).get()
                persona_data['description'] = ((agent_doc.to_dict() or {}).get('description') or '') if agent_doc.exists else ''

            return Persona(**persona_data)
            
        except Exception as e:
            logger.error(f"❌ Failed to get persona: {e}")
            raise Exception(f"Failed to get persona: {str(e)}")
    
    def update_persona(self, agent_id: str, request: PersonaUpdateRequest) -> Persona:
        """Update persona for an agent"""
        try:
            # Get existing persona
            persona_ref = self.personas_collection.document(agent_id)
            persona_doc = persona_ref.get()
            
            if not persona_doc.exists:
                raise Exception(f"Persona not found for agent: {agent_id}")
            
            # Build update data (only include non-None fields)
            update_data = {}
            if request.name is not None:
                update_data["name"] = request.name
            if request.role is not None:
                update_data["role"] = request.role
            if request.tone is not None:
                update_data["tone"] = request.tone
            if request.language is not None:
                update_data["language"] = request.language
            if request.response_length is not None:
                update_data["response_length"] = request.response_length
            if request.description is not None:
                update_data["description"] = request.description.strip()
            if request.guidelines is not None:
                update_data["guidelines"] = request.guidelines
            
            # Always update the timestamp
            update_data["updated_at"] = datetime.now(timezone.utc)
            
            # Update persona in Firestore
            persona_ref.update(update_data)
            
            # Also update agent name if it changed
            if request.name is not None:
                agent_ref = self.agents_collection.document(agent_id)
                agent_ref.update({
                    "name": request.name,
                    "updated_at": datetime.now(timezone.utc)
                })
            
            # Also update agent role and tone if changed
            agent_update = {}
            if request.role is not None:
                agent_update["role"] = request.role
            if request.tone is not None:
                agent_update["tone"] = request.tone
            if agent_update:
                agent_update["updated_at"] = datetime.now(timezone.utc)
                agent_ref = self.agents_collection.document(agent_id)
                agent_ref.update(agent_update)
            
            # Return updated persona
            updated_doc = persona_ref.get()
            updated_data = updated_doc.to_dict()
            
            logger.info(f"✅ Persona updated for agent: {agent_id}")
            return Persona(**updated_data)
            
        except Exception as e:
            logger.error(f"❌ Failed to update persona: {e}")
            raise Exception(f"Failed to update persona: {str(e)}")
    
    def get_agents_by_session(self, session_id: str) -> List[Agent]:
        """Get all agents for a session"""
        try:
            agents_refs = self.agents_collection.where('session_id', '==', session_id).where('active', '==', True).stream()
            
            agents = []
            for agent_doc in agents_refs:
                agent_data = agent_doc.to_dict()
                agents.append(Agent(**agent_data))
            
            return agents
            
        except Exception as e:
            logger.error(f"❌ Failed to get agents by session: {e}")
            return []
    
    def get_all_agents(self) -> List[Agent]:
        """Get all active agents"""
        try:
            agents_refs = self.agents_collection.where('active', '==', True).stream()
            
            agents = []
            for agent_doc in agents_refs:
                agent_data = agent_doc.to_dict()
                agents.append(Agent(**agent_data))
            
            return agents
            
        except Exception as e:
            logger.error(f"❌ Failed to get all agents: {e}")
            return []
    
    def delete_agent(self, agent_id: str) -> bool:
        """Delete agent and cascade delete related data"""
        try:
            # Delete agent
            agent_ref = self.agents_collection.document(agent_id)
            agent_ref.delete()
            
            # Delete persona
            persona_ref = self.personas_collection.document(agent_id)
            persona_ref.delete()
            
            # Delete knowledge (cascade)
            knowledge_refs = self.firestore_client.collection('knowledge').where('agent_id', '==', agent_id).stream()
            for knowledge_ref in knowledge_refs:
                knowledge_ref.reference.delete()
            
            # Delete rules (cascade)
            rule_refs = self.firestore_client.collection('rules').where('agent_id', '==', agent_id).stream()
            for rule_ref in rule_refs:
                rule_ref.reference.delete()
            
            # Delete chat logs (cascade)
            chat_refs = self.firestore_client.collection('chat_logs').where('agent_id', '==', agent_id).stream()
            for chat_ref in chat_refs:
                chat_ref.reference.delete()

            # Day 2 Agent Studio: settings, guardrails, tools, knowledge base (passages and uploaded PDFs)
            db = self.firestore_client
            for coll in ('agent_settings', 'agent_guardrails', 'agent_tools_state'):
                db.collection(coll).document(agent_id).delete()
            kb_ref = db.collection('agent_kb').document(agent_id)
            for c in kb_ref.collection('chunks').list_documents():
                c.delete()
            kb_ref.delete()
            try:
                for blob in gcp_clients.get_bucket().list_blobs(prefix=f"agents/{agent_id}/"):
                    blob.delete()
            except Exception as e:
                logger.warning(f"⚠️ Could not delete uploaded PDFs of {agent_id}: {e}")
            
            logger.info(f"✅ Agent deleted: {agent_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to delete agent: {e}")
            raise Exception(f"Failed to delete agent: {str(e)}")
    
    def cleanup_old_agents(self, days_old: int = 7) -> int:
        """Delete agents older than N days"""
        try:
            from datetime import timedelta
            
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_old)
            
            # Find old agents
            old_agents = self.agents_collection.where('created_at', '<', cutoff_date).stream()
            
            deleted_count = 0
            for agent_doc in old_agents:
                agent_id = agent_doc.id
                self.delete_agent(agent_id)
                deleted_count += 1
            
            logger.info(f"✅ Cleaned up {deleted_count} old agents")
            return deleted_count
            
        except Exception as e:
            logger.error(f"❌ Failed to cleanup old agents: {e}")
            raise Exception(f"Failed to cleanup old agents: {str(e)}")
    
    def get_settings(self, agent_id: str) -> Optional[AgentSettings]:
        """Get settings for an agent"""
        try:
            settings_ref = self.settings_collection.document(agent_id)
            settings_doc = settings_ref.get()
            
            if not settings_doc.exists:
                # Return default settings if not found
                return AgentSettings(
                    agent_id=agent_id,
                    model="gemini-3.8-flash",
                    embedding_model="text-embedding-005",
                    similarity="Cosine similarity"
                )
            
            settings_data = settings_doc.to_dict()
            return AgentSettings(**settings_data)
            
        except Exception as e:
            logger.error(f"❌ Failed to get settings: {e}")
            raise Exception(f"Failed to get settings: {str(e)}")
    
    def update_settings(self, agent_id: str, request: SettingsUpdateRequest) -> AgentSettings:
        """Update settings for an agent"""
        try:
            # Verify agent exists
            agent = self.get_agent(agent_id)
            if not agent:
                raise Exception("Agent not found")
            
            settings_ref = self.settings_collection.document(agent_id)
            settings_doc = settings_ref.get()
            
            # Get current settings or use defaults
            if settings_doc.exists:
                current_data = settings_doc.to_dict()
                current_settings = AgentSettings(**current_data)
            else:
                current_settings = AgentSettings(
                    agent_id=agent_id,
                    model="gemini-3.8-flash",
                    embedding_model="text-embedding-005",
                    similarity="Cosine similarity"
                )
            
            # Update only provided fields
            update_data = {
                "agent_id": agent_id,
                "model": request.model if request.model is not None else current_settings.model,
                "embedding_model": request.embedding_model if request.embedding_model is not None else current_settings.embedding_model,
                "similarity": request.similarity if request.similarity is not None else current_settings.similarity,
                "updated_at": datetime.now(timezone.utc)
            }
            
            # Set created_at only if creating new
            if not settings_doc.exists:
                update_data["created_at"] = datetime.now(timezone.utc)
            else:
                update_data["created_at"] = current_settings.created_at
            
            # Save to Firestore
            settings_ref.set(update_data)
            
            logger.info(f"✅ Settings updated for agent: {agent_id}")
            logger.info(f"   Model: {update_data['model']}")
            logger.info(f"   Embedding Model: {update_data['embedding_model']}")
            logger.info(f"   Similarity: {update_data['similarity']}")
            
            return AgentSettings(**update_data)
            
        except Exception as e:
            logger.error(f"❌ Failed to update settings: {e}")
            raise Exception(f"Failed to update settings: {str(e)}")

    def get_guardrails(self, agent_id: str) -> Optional[AgentGuardrails]:
        """Saved guardrails, or None when the agent has never saved any (chat then behaves as before)."""
        try:
            doc = self.guardrails_collection.document(agent_id).get()
            if not doc.exists:
                return None
            return AgentGuardrails(**{**doc.to_dict(), "agent_id": agent_id})
        except Exception as e:
            logger.error(f"❌ Failed to get guardrails: {e}")
            raise Exception(f"Failed to get guardrails: {str(e)}")

    def update_guardrails(self, agent_id: str, request: GuardrailsUpdateRequest) -> AgentGuardrails:
        """Save guardrails; fields left out keep their saved (or default) value."""
        try:
            current = self.get_guardrails(agent_id) or AgentGuardrails(agent_id=agent_id)
            data = current.model_dump()
            data.update(request.model_dump(exclude_none=True))
            data["agent_id"] = agent_id
            data["updated_at"] = datetime.now(timezone.utc)
            guardrails = AgentGuardrails(**data)
            self.guardrails_collection.document(agent_id).set(guardrails.model_dump())
            logger.info(f"✅ Guardrails updated for agent: {agent_id} (on: "
                        f"{[k for k in ('stay_on_topic', 'no_made_up_facts', 'protect_client_data', 'block_instruction_changes') if data.get(k)]})")
            return guardrails
        except Exception as e:
            logger.error(f"❌ Failed to update guardrails: {e}")
            raise Exception(f"Failed to update guardrails: {str(e)}")
