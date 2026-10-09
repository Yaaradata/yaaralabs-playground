"""
Training Chat Service - Conversational AI Agent Training

This service handles:
1. Intent detection (persona updates, knowledge additions, action creation, behavior testing)
2. Configuration extraction from natural language
3. Before/After preview generation
4. Change application and sync across sections
"""

import uuid
import logging
import json
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple
from enum import Enum
from google.cloud import firestore

from ..config import gcp_clients
from .vertex_ai_service import VertexAIService
from .agent_service import AgentService
from .knowledge_service import KnowledgeService
from .rules_service import RulesService

logger = logging.getLogger(__name__)


class TrainingIntent(str, Enum):
    """Types of training intents that can be detected"""
    PERSONA_UPDATE = "persona_update"
    KNOWLEDGE_ADD = "knowledge_add"
    ACTION_CREATE = "action_create"
    BEHAVIOR_TEST = "behavior_test"
    GENERAL_CHAT = "general_chat"
    CONFIRMATION = "confirmation"
    REJECTION = "rejection"


class TrainingChatService:
    """Service for conversational agent training"""
    
    def __init__(self):
        self._firestore_client = None
        self._project_id = None
        self._training_sessions_collection = None
        self._training_messages_collection = None
        self._pending_changes_collection = None
        self._chats_collection = None
        self._vertex_ai = None
        self._agent_service = None
        self._knowledge_service = None
        self._rules_service = None
        self._initialized = False
    
    def _ensure_initialized(self):
        """Lazy initialization - only initialize when first accessed"""
        if self._initialized:
            return
        
        try:
            self._firestore_client = gcp_clients.get_firestore_client()
            self._project_id = gcp_clients.get_project_id()
            
            # Initialize collections
            self._training_sessions_collection = self._firestore_client.collection('training_sessions')
            self._training_messages_collection = self._firestore_client.collection('training_messages')
            self._pending_changes_collection = self._firestore_client.collection('pending_changes')
            self._chats_collection = self._firestore_client.collection('training_chats')
            
            # Initialize services
            self._vertex_ai = VertexAIService(self._project_id)
            self._agent_service = AgentService()
            self._knowledge_service = KnowledgeService()
            self._rules_service = RulesService()
            
            self._initialized = True
            logger.info("✅ TrainingChatService initialized")
        except Exception as e:
            logger.warning(f"⚠️ TrainingChatService initialization deferred (will retry on first use): {e}")
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
    def training_sessions_collection(self):
        self._ensure_initialized()
        return self._training_sessions_collection
    
    @property
    def training_messages_collection(self):
        self._ensure_initialized()
        return self._training_messages_collection
    
    @property
    def pending_changes_collection(self):
        self._ensure_initialized()
        return self._pending_changes_collection
    
    @property
    def chats_collection(self):
        self._ensure_initialized()
        return self._chats_collection
    
    @property
    def vertex_ai(self):
        self._ensure_initialized()
        return self._vertex_ai
    
    @property
    def agent_service(self):
        self._ensure_initialized()
        return self._agent_service
    
    @property
    def knowledge_service(self):
        self._ensure_initialized()
        return self._knowledge_service
    
    @property
    def rules_service(self):
        self._ensure_initialized()
        return self._rules_service
    
    def _clean_json_response(self, response: str, model_name: Optional[str] = None) -> str:
        """Clean JSON response, especially for flash-lite which may add extra text"""
        is_flash_lite = model_name and "flash-lite" in model_name.lower()
        
        # Remove markdown code blocks if present
        cleaned = response.strip()
        if "```json" in cleaned:
            cleaned = cleaned.split("```json")[1].split("```")[0].strip()
        elif "```" in cleaned:
            cleaned = cleaned.split("```")[1].split("```")[0].strip()
        
        # For flash-lite, be more aggressive in cleaning
        if is_flash_lite:
            # Remove common prefixes that flash-lite might add
            prefixes_to_remove = [
                "Hi!",
                "Hello!",
                "Hey!",
                "Here is",
                "Here's",
                "I'll",
                "Let me",
                "I have",
                "I can",
                "Sure,",
                "Of course,",
                "Certainly,",
            ]
            for prefix in prefixes_to_remove:
                if cleaned.lower().startswith(prefix.lower()):
                    # Find the first { after the prefix
                    brace_pos = cleaned.find("{")
                    if brace_pos > 0:
                        cleaned = cleaned[brace_pos:]
                        break
            
            # Remove any text before the first {
            first_brace = cleaned.find("{")
            if first_brace > 0:
                cleaned = cleaned[first_brace:]
            
            # Remove any text after the last }
            last_brace = cleaned.rfind("}")
            if last_brace >= 0 and last_brace < len(cleaned) - 1:
                cleaned = cleaned[:last_brace + 1]
        
        return cleaned.strip()
    
    def _generate_intent_detection_prompt(self, message: str, context: List[Dict], model_name: Optional[str] = None) -> str:
        """Generate prompt for intent detection"""
        context_str = ""
        if context:
            recent_messages = context[-5:]  # Last 5 messages for context
            for msg in recent_messages:
                role = "User" if msg.get("role") == "user" else "Agent"
                context_str += f"{role}: {msg.get('content', '')}\n"
        
        # Add model-specific instructions for flash-lite to be more structured
        is_flash_lite = model_name and "flash-lite" in model_name.lower()
        model_instructions = ""
        if is_flash_lite:
            model_instructions = "\n\n⚠️ CRITICAL: YOU MUST FOLLOW THESE RULES EXACTLY:\n1. Your response MUST start with the character '{' (opening brace)\n2. Your response MUST end with the character '}' (closing brace)\n3. Do NOT write ANY text before the opening brace\n4. Do NOT write ANY text after the closing brace\n5. Do NOT include greetings like 'Hi', 'Hello', 'Hey'\n6. Do NOT include explanations like 'Here is the JSON:', 'I'll analyze', 'Let me provide'\n7. Output ONLY the raw JSON object, nothing else\n8. Example of CORRECT output: {\"intent\": \"...\", \"confidence\": 0.9}\n9. Example of WRONG output: Hi! Here is the JSON: {\"intent\": \"...\"} - this is WRONG\n\nREMEMBER: Start with { and end with }. Nothing before, nothing after."
        
        # Add critical distinction instructions for flash-lite
        distinction_instructions = ""
        if is_flash_lite:
            distinction_instructions = """

⚠️ CRITICAL: DISTINGUISHING ACTION_CREATE vs PERSONA_UPDATE

ACTION_CREATE (Conditional Rules):
- Messages that start with "When...", "If...", "When user...", "When students...", "When someone..."
- Messages that describe a TRIGGER/CONDITION followed by what to do
- Examples:
  * "When students ask learning-related questions: Explain concepts step by step"
  * "When user asks about fees: Provide clear information"
  * "If someone mentions pricing: Be transparent"
- These are CONDITIONAL RULES = ACTION_CREATE

PERSONA_UPDATE (General Behavior):
- Messages that describe general behavior WITHOUT a specific condition/trigger
- Messages about overall personality, tone, or general guidelines
- Examples:
  * "Be more friendly and helpful"
  * "Use simple language"
  * "Always be polite"
  * "Explain concepts step by step" (WITHOUT "When..." condition)
- These are GENERAL BEHAVIOR = PERSONA_UPDATE

KEY RULE: If the message contains "When", "If", or describes a specific trigger/condition, it MUST be ACTION_CREATE, NOT PERSONA_UPDATE.
"""
        
        return f"""You are an AI assistant that helps users train their AI agent through conversation.
Analyze the user's message and determine their intent.

Previous conversation context:
{context_str}

Current user message: "{message}"

Classify the intent as ONE of the following:
1. "persona_update" - User wants to change the agent's personality, tone, behavior, name, role, language, or guidelines (GENERAL behavior changes, NO specific conditions/triggers)
2. "knowledge_add" - User wants to add facts, FAQs, information, or training data to the agent
3. "action_create" - User wants to create triggers, conditional rules, or automated responses (MUST have a condition/trigger like "When...", "If...", "When user...")
4. "behavior_test" - User wants to test the agent's current behavior or responses
5. "confirmation" - User is confirming/approving a proposed change (yes, proceed, apply, confirm, etc.)
6. "rejection" - User is rejecting a proposed change (no, cancel, don't, reject, etc.)
7. "general_chat" - General conversation or question not related to training

{distinction_instructions}

Respond in this exact JSON format:
{{
    "intent": "<intent_type>",
    "confidence": <0.0-1.0>,
    "sub_category": "<optional sub-category>",
    "reasoning": "<brief explanation>"
}}

Only respond with the JSON, no other text.{model_instructions}"""

    def _generate_config_extraction_prompt(self, message: str, intent: str, context: List[Dict], model_name: Optional[str] = None) -> str:
        """Generate prompt for extracting configuration from natural language"""
        
        # Add model-specific instructions for flash-lite to be more structured
        is_flash_lite = model_name and "flash-lite" in model_name.lower()
        model_instructions = ""
        if is_flash_lite:
            model_instructions = "\n\n⚠️ CRITICAL: YOU MUST FOLLOW THESE RULES EXACTLY:\n1. Your response MUST start with the character '{' (opening brace)\n2. Your response MUST end with the character '}' (closing brace)\n3. Do NOT write ANY text before the opening brace\n4. Do NOT write ANY text after the closing brace\n5. Do NOT include greetings like 'Hi', 'Hello', 'Hey'\n6. Do NOT include explanations like 'Here is the JSON:', 'I'll extract', 'Let me provide'\n7. Do NOT include conversational filler or pleasantries\n8. Output ONLY the raw JSON object, nothing else\n9. Example of CORRECT output: {\"extracted_config\": {...}, \"summary\": \"...\"}\n10. Example of WRONG output: Hi! Here is the JSON: {\"extracted_config\": {...}} - this is WRONG\n\nREMEMBER: Start with { and end with }. Nothing before, nothing after."
        
        if intent == TrainingIntent.PERSONA_UPDATE:
            # Add stricter summary instructions for flash-lite
            summary_instructions = ""
            if is_flash_lite:
                summary_instructions = "\n\nSUMMARY REQUIREMENTS:\n- The summary field must be a concise, direct description of what will change.\n- Do NOT use phrases like 'I will', 'The agent will', 'We are going to'.\n- Start directly with what is being added/changed.\n- Example CORRECT: 'Added guidelines for explaining concepts step by step with simple examples, encouraging curiosity and confidence, and asking about further explanation or practice.'\n- Example WRONG: 'I have prepared to update the persona to include guidelines for...' - this is WRONG.\n- Keep it under 200 characters. Be specific and factual."
            
            return f"""Extract persona configuration from this user message.
            
User message: "{message}"

Extract any of these persona attributes mentioned:
- name: Agent's name
- role: Agent's role/purpose (e.g., "customer support", "sales assistant")
- tone: Communication style (e.g., "friendly", "professional", "casual", "formal")
- language: Response language
- response_length: How verbose responses should be ("minimal", "short", "long", "chatty")
- guidelines: Custom behavior guidelines or instructions. IMPORTANT: If the user provides multiple guidelines or instructions, separate each guideline with a newline character (\\n). Each guideline should be a complete, standalone sentence. For example, if the user says "Be polite. Be helpful. Be clear.", the guidelines field should be: "Be polite.\\nBe helpful.\\nBe clear."

Respond in this exact JSON format:
{{
    "extracted_config": {{
        "name": "<value or null>",
        "role": "<value or null>",
        "tone": "<single value or null>",
        "language": "<value or null>",
        "response_length": "<value or null>",
        "guidelines": "<guidelines separated by \\n, each on a new line, or null>"
    }},
    "summary": "<human-readable summary of changes - be concise and direct>"
}}

Only include fields that were explicitly mentioned or implied. Set others to null.
Only respond with the JSON, no other text.{summary_instructions}{model_instructions}"""

        elif intent == TrainingIntent.KNOWLEDGE_ADD:
            # Add stricter summary instructions for flash-lite
            summary_instructions = ""
            if is_flash_lite:
                summary_instructions = "\n\nSUMMARY REQUIREMENTS:\n- The summary must be concise and direct.\n- Start with 'Added' or 'Added knowledge about'.\n- Do NOT use phrases like 'I will add', 'The system will', 'We are going to'.\n- Example CORRECT: 'Added knowledge about school fees and payment structure.'\n- Example WRONG: 'I have added the instruction to add knowledge about...' - this is WRONG.\n- Keep it under 150 characters."
            
            return f"""Extract knowledge/information from this user message to add to the agent's knowledge base.
            
User message: "{message}"

Extract knowledge items in one of these formats:
- text: Plain text information
- qna: Question and answer pair
- fact: Specific fact or data point

Respond in this exact JSON format:
{{
    "extracted_config": {{
        "type": "<text|qna|fact>",
        "content": "<the knowledge content>",
        "question": "<if qna type, the question>",
        "answer": "<if qna type, the answer>",
        "category": "<optional category>"
    }},
    "summary": "<human-readable summary of what will be added - be concise and direct>"
}}

Only respond with the JSON, no other text.{summary_instructions}{model_instructions}"""

        elif intent == TrainingIntent.ACTION_CREATE:
            # Add stricter summary instructions for flash-lite
            summary_instructions = ""
            if is_flash_lite:
                summary_instructions = "\n\nSUMMARY REQUIREMENTS:\n- The summary must be concise and direct.\n- Start with 'Added rule' or 'Created action'.\n- Describe what triggers the action and what the agent will do.\n- Do NOT use phrases like 'I will create', 'The system will', 'We are going to'.\n- Example CORRECT: 'Added rule: When user asks about fees, provide clear and transparent information about payment structure.'\n- Example WRONG: 'I have added the instruction to create a rule that...' - this is WRONG.\n- Keep it under 200 characters."
            
            return f"""Extract action/rule configuration from this user message.
            
User message: "{message}"

Extract rule configuration with:
- conditions: When should this action trigger (e.g., "Conversation starts", "User asks about X", "User wants to Y")
- actions: What should the agent do (e.g., "Say exact message", "Talk about X", "Ask for information")

Available condition types:
- "Conversation starts"
- "User wants to"
- "User talks about"
- "User asks about"
- "User sentiment is"
- "User provides"
- "The sentence contains"

Available action types:
- "Say exact message"
- "Always include"
- "Always talk about"
- "Talk about/mention"
- "Don't talk about/mention"
- "Ask for information"
- "Answer Using Knowledge Base"

Respond in this exact JSON format:
{{
    "extracted_config": {{
        "name": "<rule name>",
        "conditions": [
            {{"type": "<condition_type>", "value": "<condition_value>"}}
        ],
        "actions": [
            {{"type": "<action_type>", "value": "<action_value>"}}
        ],
        "match_type": "ANY"
    }},
    "summary": "<human-readable summary of the rule - be concise and direct>"
}}

Only respond with the JSON, no other text.{summary_instructions}{model_instructions}"""

        else:
            return f"""User message: "{message}"
            
Provide a helpful response as a training assistant.

CRITICAL: Be direct and concise. Do NOT add greetings, pleasantries, or conversational filler. Start your response immediately with the task at hand.

Respond in JSON format:
{{
    "response": "<your helpful response - be direct, no greetings>",
    "suggestions": ["<suggested next steps>"]
}}

Only respond with the JSON, no other text.{model_instructions}"""

    def detect_intent(self, message: str, context: List[Dict] = None, agent_id: str = None) -> Dict[str, Any]:
        """Detect the intent of a training message"""
        try:
            # Get model from settings if agent_id is provided
            model_name = None
            if agent_id:
                try:
                    settings = self.agent_service.get_settings(agent_id)
                    if settings:
                        model_name = settings.model
                        logger.info(f"📋 Using model from settings for intent detection: {model_name}")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to load model from settings: {e}")
            
            prompt = self._generate_intent_detection_prompt(message, context or [], model_name=model_name)
            
            response = self.vertex_ai.generate_text(prompt, max_tokens=500, model_name=model_name)
            
            # Parse JSON response with enhanced cleaning for flash-lite
            try:
                cleaned = self._clean_json_response(response, model_name)
                result = json.loads(cleaned)
                return {
                    "intent": result.get("intent", "general_chat"),
                    "confidence": result.get("confidence", 0.5),
                    "sub_category": result.get("sub_category"),
                    "reasoning": result.get("reasoning", "")
                }
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse intent detection response: {e}")
                logger.warning(f"Raw response: {response[:500]}")
                logger.warning(f"Cleaned response: {cleaned[:500] if 'cleaned' in locals() else 'N/A'}")
                return {
                    "intent": "general_chat",
                    "confidence": 0.3,
                    "reasoning": "Failed to parse response"
                }
                
        except Exception as e:
            logger.error(f"Intent detection error: {e}")
            return {
                "intent": "general_chat",
                "confidence": 0.0,
                "reasoning": str(e)
            }
    
    def extract_config(self, message: str, intent: str, context: List[Dict] = None, agent_id: str = None) -> Dict[str, Any]:
        """Extract configuration from natural language based on intent"""
        try:
            # Get model from settings if agent_id is provided
            model_name = None
            if agent_id:
                try:
                    settings = self.agent_service.get_settings(agent_id)
                    if settings:
                        model_name = settings.model
                        logger.info(f"📋 Using model from settings for config extraction: {model_name}")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to load model from settings: {e}")
            
            prompt = self._generate_config_extraction_prompt(message, intent, context or [], model_name=model_name)
            
            response = self.vertex_ai.generate_text(prompt, max_tokens=1000, model_name=model_name)
            
            # Parse JSON response with enhanced cleaning for flash-lite
            try:
                cleaned = self._clean_json_response(response, model_name)
                logger.debug(f"🧹 Cleaned response for {model_name}: {cleaned[:200]}...")
                result = json.loads(cleaned)
                extracted_config = result.get("extracted_config", {})
                
                # Normalize persona config to ensure strings (LLM sometimes returns arrays)
                if intent == TrainingIntent.PERSONA_UPDATE:
                    extracted_config = self._normalize_extracted_config(extracted_config)
                
                # Clean and normalize summary for flash-lite
                summary = result.get("summary", "")
                if model_name and "flash-lite" in model_name.lower():
                    original_summary = summary
                    summary = summary.strip()
                    
                    # Remove common verbose prefixes from summary (case-insensitive)
                    verbose_prefixes = [
                        "I have prepared to update",
                        "I have added the instruction to",
                        "I have added",
                        "I will",
                        "The agent will",
                        "We are going to",
                        "I can",
                        "Let me",
                        "I'll",
                        "I'm going to",
                        "I'm preparing to",
                    ]
                    
                    for prefix in verbose_prefixes:
                        if summary.lower().startswith(prefix.lower()):
                            # Find where the actual content starts (usually after "to" or colon)
                            remaining = summary[len(prefix):].strip()
                            if remaining.lower().startswith(" to "):
                                summary = remaining[4:].strip()
                            elif remaining.startswith(":"):
                                summary = remaining[1:].strip()
                            elif remaining.startswith(" that"):
                                summary = remaining[5:].strip()
                            else:
                                summary = remaining
                            break
                    
                    # Also check for patterns like "update my persona to..." or "update the persona to..."
                    patterns_to_remove = [
                        r"^update (my|the) persona to\s*",
                        r"^update persona to\s*",
                        r"^prepared to update\s*",
                        r"^added the instruction to\s*",
                    ]
                    for pattern in patterns_to_remove:
                        summary = re.sub(pattern, "", summary, flags=re.IGNORECASE).strip()
                    
                    # Capitalize first letter
                    if summary:
                        summary = summary[0].upper() + summary[1:] if len(summary) > 1 else summary.upper()
                    
                    if original_summary != summary:
                        logger.info(f"🧹 Cleaned summary for flash-lite:\n  Original: {original_summary}\n  Cleaned: {summary}")
                    else:
                        logger.debug(f"🧹 Summary unchanged for flash-lite: {summary}")
                
                return {
                    "success": True,
                    "config": extracted_config,
                    "summary": summary,
                    "response": result.get("response", "")
                }
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse config extraction response: {e}")
                logger.warning(f"Raw response: {response[:500]}")
                logger.warning(f"Cleaned response: {cleaned[:500] if 'cleaned' in locals() else 'N/A'}")
                return {
                    "success": False,
                    "config": {},
                    "summary": "",
                    "error": "Failed to parse configuration"
                }
                
        except Exception as e:
            logger.error(f"Config extraction error: {e}")
            return {
                "success": False,
                "config": {},
                "error": str(e)
            }
    
    def _normalize_extracted_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize extracted config to ensure values are in expected format.
        Converts arrays to comma-separated strings, except guidelines which use newlines.
        """
        normalized = {}
        for key, value in config.items():
            if value is None:
                normalized[key] = None
            elif isinstance(value, list):
                # For guidelines, join with newlines; for other fields, join with commas
                if key == 'guidelines':
                    normalized[key] = "\n".join(str(v).strip() for v in value if str(v).strip()) if value else None
                else:
                    normalized[key] = ", ".join(str(v) for v in value) if value else None
            elif isinstance(value, dict):
                # Keep dicts as-is for nested structures
                normalized[key] = value
            else:
                normalized[key] = value
        return normalized
    
    def get_current_config(self, agent_id: str, config_type: str) -> Dict[str, Any]:
        """Get current configuration for before/after comparison"""
        try:
            if config_type == TrainingIntent.PERSONA_UPDATE:
                persona = self.agent_service.get_persona(agent_id)
                if persona:
                    return {
                        "name": persona.name,
                        "role": persona.role,
                        "tone": persona.tone,
                        "language": persona.language,
                        "response_length": persona.response_length,
                        "guidelines": persona.guidelines
                    }
                return {}
            
            elif config_type == TrainingIntent.KNOWLEDGE_ADD:
                # Return empty for knowledge (new addition)
                return {"items": []}
            
            elif config_type == TrainingIntent.ACTION_CREATE:
                # Return empty for new action
                return {"rules": []}
            
            return {}
            
        except Exception as e:
            logger.error(f"Error getting current config: {e}")
            return {}
    
    def generate_preview(self, agent_id: str, intent: str, extracted_config: Dict) -> Dict[str, Any]:
        """Generate before/after preview for proposed changes"""
        try:
            current_config = self.get_current_config(agent_id, intent)
            
            if intent == TrainingIntent.PERSONA_UPDATE:
                # Merge current config with extracted updates
                updated_config = {**current_config}
                for key, value in extracted_config.items():
                    if value is not None:
                        # Special handling for guidelines - append to existing instead of replacing
                        if key == 'guidelines' and current_config.get('guidelines'):
                            existing_guidelines = [g.strip() for g in current_config['guidelines'].split('\n') if g.strip()]
                            # Parse new guidelines (could be comma or newline separated)
                            new_guidelines = [g.strip() for g in str(value).split(',') if g.strip()]
                            if len(new_guidelines) == 1:
                                new_guidelines = [g.strip() for g in str(value).split('\n') if g.strip()]
                            # Combine and deduplicate while preserving order
                            combined = existing_guidelines.copy()
                            for g in new_guidelines:
                                if g not in combined:
                                    combined.append(g)
                            updated_config[key] = '\n'.join(combined)
                        else:
                            updated_config[key] = value
                
                return {
                    "type": "persona_update",
                    "before": current_config,
                    "after": updated_config,
                    "changes": [
                        {"field": k, "old": current_config.get(k), "new": v}
                        for k, v in extracted_config.items()
                        if v is not None and current_config.get(k) != v
                    ]
                }
            
            elif intent == TrainingIntent.KNOWLEDGE_ADD:
                return {
                    "type": "knowledge_add",
                    "before": None,
                    "after": extracted_config,
                    "changes": [{"action": "add", "content": extracted_config}]
                }
            
            elif intent == TrainingIntent.ACTION_CREATE:
                return {
                    "type": "action_create",
                    "before": None,
                    "after": extracted_config,
                    "changes": [{"action": "add", "rule": extracted_config}]
                }
            
            return {"type": "unknown", "before": None, "after": None}
            
        except Exception as e:
            logger.error(f"Error generating preview: {e}")
            return {"type": "error", "error": str(e)}
    
    def save_pending_change(self, agent_id: str, session_id: str, change_data: Dict) -> str:
        """Save a pending change for user approval"""
        try:
            change_id = f"CHANGE_{uuid.uuid4().hex[:12].upper()}"
            
            pending_change = {
                "change_id": change_id,
                "agent_id": agent_id,
                "session_id": session_id,
                "intent": change_data.get("intent"),
                "config": change_data.get("config"),
                "preview": change_data.get("preview"),
                "summary": change_data.get("summary"),
                "status": "pending",
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc)
            }
            
            self.pending_changes_collection.document(change_id).set(pending_change)
            
            logger.info(f"✅ Saved pending change: {change_id}")
            return change_id
            
        except Exception as e:
            logger.error(f"Error saving pending change: {e}")
            raise
    
    def get_pending_change(self, change_id: str) -> Optional[Dict]:
        """Get a pending change by ID"""
        try:
            doc = self.pending_changes_collection.document(change_id).get()
            if doc.exists:
                return doc.to_dict()
            return None
        except Exception as e:
            logger.error(f"Error getting pending change: {e}")
            return None
    
    def _normalize_persona_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize persona config to ensure all values are strings.
        The LLM sometimes returns arrays instead of strings.
        """
        normalized = {}
        for key, value in config.items():
            if value is None:
                normalized[key] = None
            elif isinstance(value, list):
                # For guidelines, join with newlines; for other fields, join with commas
                if key == 'guidelines':
                    normalized[key] = "\n".join(str(v).strip() for v in value if str(v).strip()) if value else None
                else:
                    normalized[key] = ", ".join(str(v) for v in value) if value else None
            elif isinstance(value, dict):
                # Convert dict to string representation
                normalized[key] = str(value)
            else:
                normalized[key] = str(value) if value else None
        return normalized
    
    def apply_change(self, agent_id: str, change_id: str) -> Dict[str, Any]:
        """Apply a pending change"""
        try:
            # Get pending change
            pending_change = self.get_pending_change(change_id)
            if not pending_change:
                return {"success": False, "error": "Change not found"}
            
            if pending_change["status"] != "pending":
                return {"success": False, "error": "Change already processed"}
            
            intent = pending_change["intent"]
            config = pending_change["config"]
            
            result = {"success": False}
            
            if intent == TrainingIntent.PERSONA_UPDATE:
                # Apply persona update
                from ..models import PersonaUpdateRequest
                # Normalize config to ensure all values are strings (LLM sometimes returns arrays)
                normalized_config = self._normalize_persona_config(config)
                
                # For guidelines, append to existing instead of replacing
                if normalized_config.get("guidelines"):
                    current_persona = self.agent_service.get_persona(agent_id)
                    if current_persona and current_persona.guidelines:
                        # Parse existing guidelines and new guidelines
                        existing_guidelines = [g.strip() for g in current_persona.guidelines.split('\n') if g.strip()]
                        # Parse new guidelines (could be comma or newline separated)
                        new_guidelines = [g.strip() for g in normalized_config["guidelines"].split(',') if g.strip()]
                        # Also handle newline-separated input
                        if len(new_guidelines) == 1:
                            new_guidelines = [g.strip() for g in normalized_config["guidelines"].split('\n') if g.strip()]
                        # Combine and deduplicate while preserving order
                        combined = existing_guidelines.copy()
                        for g in new_guidelines:
                            if g not in combined:
                                combined.append(g)
                        normalized_config["guidelines"] = '\n'.join(combined)
                
                update_request = PersonaUpdateRequest(**{k: v for k, v in normalized_config.items() if v is not None})
                self.agent_service.update_persona(agent_id, update_request)
                result = {"success": True, "type": "persona_update", "message": "Persona updated successfully"}
            
            elif intent == TrainingIntent.KNOWLEDGE_ADD:
                # Add knowledge
                from ..models import KnowledgeTextRequest, KnowledgeQnARequest
                
                kb_type = config.get("type", "text")
                if kb_type == "qna":
                    qna_request = KnowledgeQnARequest(
                        agent_id=agent_id,
                        question=config.get("question", ""),
                        answer=config.get("answer", config.get("content", ""))
                    )
                    knowledge_id = self.knowledge_service.add_qna_knowledge(qna_request)
                else:
                    text_request = KnowledgeTextRequest(
                        agent_id=agent_id,
                        content=config.get("content", "")
                    )
                    kb_result = self.knowledge_service.add_text_knowledge(text_request)
                    knowledge_id = kb_result.get("knowledge_ids", [""])[0] if kb_result.get("knowledge_ids") else ""
                result = {"success": True, "type": "knowledge_add", "knowledge_id": knowledge_id, "message": "Knowledge added successfully"}
            
            elif intent == TrainingIntent.ACTION_CREATE:
                # Create rule
                from ..models import RuleSaveRequest, RuleCondition, RuleAction
                
                conditions = [RuleCondition(**c) for c in config.get("conditions", [])]
                actions = [RuleAction(**a) for a in config.get("actions", [])]
                
                rule_request = RuleSaveRequest(
                    agent_id=agent_id,
                    name=config.get("name", ""),
                    conditions=conditions,
                    actions=actions,
                    match_type=config.get("match_type", "ANY")
                )
                
                rule = self.rules_service.save_rule(rule_request)
                result = {"success": True, "type": "action_create", "rule_id": rule.rule_id, "message": "Rule created successfully"}
            
            # Update pending change status
            self.pending_changes_collection.document(change_id).update({
                "status": "applied",
                "applied_at": datetime.now(timezone.utc)
            })
            
            return result
            
        except Exception as e:
            logger.error(f"Error applying change: {e}")
            return {"success": False, "error": str(e)}
    
    def reject_change(self, change_id: str) -> Dict[str, Any]:
        """Reject a pending change"""
        try:
            self.pending_changes_collection.document(change_id).update({
                "status": "rejected",
                "rejected_at": datetime.now(timezone.utc)
            })
            return {"success": True, "message": "Change rejected"}
        except Exception as e:
            logger.error(f"Error rejecting change: {e}")
            return {"success": False, "error": str(e)}
    
    def process_training_message(
        self,
        agent_id: str,
        session_id: str,
        message: str,
        context: List[Dict] = None
    ) -> Dict[str, Any]:
        """
        Main entry point for processing training messages.
        
        Returns:
        - response: Agent response text
        - intent: Detected intent
        - preview: Before/after preview (if applicable)
        - change_id: ID of pending change (if approval needed)
        - requires_approval: Whether user approval is needed
        """
        try:
            context = context or []
            
            # Step 1: Detect intent (pass agent_id to use correct model)
            intent_result = self.detect_intent(message, context, agent_id=agent_id)
            intent = intent_result["intent"]
            confidence = intent_result["confidence"]
            
            logger.info(f"Detected intent: {intent} (confidence: {confidence})")
            
            # Step 2: Handle based on intent
            if intent == TrainingIntent.CONFIRMATION:
                # User is confirming a previous proposal
                # Look for most recent pending change
                pending_changes = self.pending_changes_collection \
                    .where("agent_id", "==", agent_id) \
                    .where("session_id", "==", session_id) \
                    .where("status", "==", "pending") \
                    .order_by("created_at", direction=firestore.Query.DESCENDING) \
                    .limit(1) \
                    .stream()
                
                pending_list = list(pending_changes)
                if pending_list:
                    change_data = pending_list[0].to_dict()
                    change_id = change_data["change_id"]
                    result = self.apply_change(agent_id, change_id)
                    
                    return {
                        "response": f"✅ {result.get('message', 'Changes applied successfully!')}",
                        "intent": intent,
                        "applied_change": result,
                        "requires_approval": False
                    }
                else:
                    return {
                        "response": "I don't have any pending changes to confirm. Would you like to make some updates to your agent?",
                        "intent": intent,
                        "requires_approval": False
                    }
            
            elif intent == TrainingIntent.REJECTION:
                # User is rejecting a previous proposal
                pending_changes = self.pending_changes_collection \
                    .where("agent_id", "==", agent_id) \
                    .where("session_id", "==", session_id) \
                    .where("status", "==", "pending") \
                    .order_by("created_at", direction=firestore.Query.DESCENDING) \
                    .limit(1) \
                    .stream()
                
                pending_list = list(pending_changes)
                if pending_list:
                    change_data = pending_list[0].to_dict()
                    change_id = change_data["change_id"]
                    self.reject_change(change_id)
                    
                    return {
                        "response": "Got it, I've cancelled those changes. What would you like to do instead?",
                        "intent": intent,
                        "requires_approval": False
                    }
                else:
                    return {
                        "response": "No problem! What else would you like to do?",
                        "intent": intent,
                        "requires_approval": False
                    }
            
            elif intent == TrainingIntent.BEHAVIOR_TEST:
                # User wants to test agent behavior
                return {
                    "response": "To test your agent's behavior, try sending a message in the 'Use AI' mode. There you can interact with your trained agent and see how it responds.",
                    "intent": intent,
                    "requires_approval": False,
                    "suggestions": ["Switch to 'Use AI' mode", "View current persona settings", "Add more knowledge"]
                }
            
            elif intent in [TrainingIntent.PERSONA_UPDATE, TrainingIntent.KNOWLEDGE_ADD, TrainingIntent.ACTION_CREATE]:
                # Extract configuration
                config_result = self.extract_config(message, intent, context, agent_id=agent_id)
                
                if not config_result["success"]:
                    return {
                        "response": "I had trouble understanding your request. Could you please rephrase what you'd like to change?",
                        "intent": intent,
                        "error": config_result.get("error"),
                        "requires_approval": False
                    }
                
                extracted_config = config_result["config"]
                summary = config_result["summary"]
                
                # Generate preview
                preview = self.generate_preview(agent_id, intent, extracted_config)
                
                # Save as pending change
                change_data = {
                    "intent": intent,
                    "config": extracted_config,
                    "preview": preview,
                    "summary": summary
                }
                change_id = self.save_pending_change(agent_id, session_id, change_data)
                
                # Generate response based on intent
                if intent == TrainingIntent.PERSONA_UPDATE:
                    response = f"I have prepared to update my persona to {summary}. Are you sure you want me to make this change?"
                elif intent == TrainingIntent.KNOWLEDGE_ADD:
                    response = f"I have added the instruction to {summary}. Would you like to test this behavior now?"
                elif intent == TrainingIntent.ACTION_CREATE:
                    response = f"I have added the instruction to {summary}. Would you like to test this behavior now?"
                
                return {
                    "response": response,
                    "intent": intent,
                    "preview": preview,
                    "change_id": change_id,
                    "summary": summary,
                    "requires_approval": True,
                    "extracted_config": extracted_config
                }
            
            else:
                # General chat - provide helpful response
                config_result = self.extract_config(message, intent, context, agent_id=agent_id)
                
                return {
                    "response": config_result.get("response", "I'm here to help you train your AI agent! You can:\n\n• **Update Persona**: Tell me how you want your agent to behave\n• **Add Knowledge**: Share information you want your agent to know\n• **Create Actions**: Set up triggers and automated responses\n• **Test Behavior**: Check how your agent responds\n\nWhat would you like to do?"),
                    "intent": intent,
                    "suggestions": config_result.get("suggestions", [
                        "Update my agent's tone to be more friendly",
                        "Add FAQ about our business hours",
                        "Create a greeting message"
                    ]),
                    "requires_approval": False
                }
                
        except Exception as e:
            logger.error(f"Error processing training message: {e}")
            return {
                "response": "I encountered an error processing your request. Please try again.",
                "intent": "error",
                "error": str(e),
                "requires_approval": False
            }
    
    def save_training_message(
        self,
        agent_id: str,
        session_id: str,
        role: str,
        content: str,
        metadata: Dict = None
    ) -> str:
        """Save a training message to history"""
        try:
            message_id = f"MSG_{uuid.uuid4().hex[:12].upper()}"
            
            message_data = {
                "message_id": message_id,
                "agent_id": agent_id,
                "session_id": session_id,
                "role": role,
                "content": content,
                "metadata": metadata or {},
                "created_at": datetime.now(timezone.utc)
            }
            
            self.training_messages_collection.document(message_id).set(message_data)
            
            return message_id
            
        except Exception as e:
            logger.error(f"Error saving training message: {e}")
            raise
    
    def get_training_history(self, agent_id: str, session_id: str, limit: int = 50) -> List[Dict]:
        """Get training message history"""
        try:
            logger.info(f"🔍 Fetching messages for agent_id={agent_id}, session_id={session_id}")
            
            # Query messages for this session
            query = self.training_messages_collection \
                .where("agent_id", "==", agent_id) \
                .where("session_id", "==", session_id)
            
            # Try to order by created_at, but handle if index doesn't exist
            try:
                messages = query.order_by("created_at").limit(limit).stream()
                logger.info(f"✅ Query with ordering successful")
            except Exception as order_error:
                # If ordering fails (no index), just get messages without ordering
                logger.warning(f"⚠️ Could not order by created_at (index may not exist): {order_error}")
                messages = query.limit(limit).stream()
            
            result = []
            for msg in messages:
                msg_dict = msg.to_dict()
                # Ensure all required fields are present
                if msg_dict:
                    # Convert Firestore Timestamp to datetime/ISO string for JSON serialization
                    if 'created_at' in msg_dict and msg_dict['created_at']:
                        created_at = msg_dict['created_at']
                        # If it's a Firestore Timestamp, convert to datetime
                        if hasattr(created_at, 'timestamp'):
                            msg_dict['created_at'] = created_at
                        elif isinstance(created_at, datetime):
                            msg_dict['created_at'] = created_at
                        # Ensure message_id is present
                        if 'message_id' not in msg_dict:
                            msg_dict['message_id'] = msg.id
                    
                    # Log the message for debugging
                    logger.debug(f"📨 Found message: role={msg_dict.get('role')}, content={msg_dict.get('content', '')[:50]}...")
                    result.append(msg_dict)
            
            # Sort by created_at if we couldn't order in query
            if result:
                def get_sort_key(x):
                    created_at = x.get("created_at")
                    if created_at:
                        # If it's a timestamp, convert to datetime if needed
                        if isinstance(created_at, datetime):
                            return created_at
                        elif hasattr(created_at, 'timestamp'):
                            return created_at
                    return datetime.min.replace(tzinfo=timezone.utc)
                result.sort(key=get_sort_key)
            
            logger.info(f"✅ Retrieved {len(result)} messages for session {session_id} (agent_id={agent_id})")
            
            # If no messages found, log a warning
            if len(result) == 0:
                logger.warning(f"⚠️ No messages found for session_id={session_id}, agent_id={agent_id}. Checking if session exists...")
                # Check if any messages exist for this agent
                all_messages = self.training_messages_collection.where("agent_id", "==", agent_id).limit(5).stream()
                sample_sessions = set()
                for msg in all_messages:
                    msg_data = msg.to_dict()
                    if msg_data:
                        sample_sessions.add(msg_data.get("session_id", "unknown"))
                logger.info(f"📋 Sample session_ids for this agent: {list(sample_sessions)}")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Error getting training history: {e}", exc_info=True)
            return []
    
    def get_training_sessions(self, agent_id: str) -> List[Dict]:
        """Get all training chat sessions for an agent"""
        try:
            # Get all messages for this agent
            messages = self.training_messages_collection \
                .where("agent_id", "==", agent_id) \
                .stream()
            
            # Group by session_id and track latest message and count
            sessions_map = {}
            for msg in messages:
                msg_data = msg.to_dict()
                session_id = msg_data.get("session_id")
                if not session_id:
                    continue
                    
                created_at = msg_data.get("created_at")
                content = msg_data.get("content", "")
                
                if session_id not in sessions_map:
                    sessions_map[session_id] = {
                        "session_id": session_id,
                        "agent_id": agent_id,
                        "last_message_at": created_at,
                        "last_message": content[:100] if content else "",  # Preview
                        "message_count": 1
                    }
                else:
                    # Update if this message is newer
                    existing_time = sessions_map[session_id]["last_message_at"]
                    if created_at and (not existing_time or created_at > existing_time):
                        sessions_map[session_id]["last_message_at"] = created_at
                        sessions_map[session_id]["last_message"] = content[:100] if content else ""
                    sessions_map[session_id]["message_count"] += 1
            
            # Convert to list and sort by last message time (newest first)
            sessions = list(sessions_map.values())
            sessions.sort(
                key=lambda x: x.get("last_message_at") or datetime.min.replace(tzinfo=timezone.utc), 
                reverse=True
            )
            
            return sessions
            
        except Exception as e:
            logger.error(f"Error getting training sessions: {e}")
            return []
    
    def clear_training_history(self, agent_id: str, session_id: str) -> bool:
        """Clear training message history (restart conversation)"""
        try:
            # Delete messages
            messages = self.training_messages_collection \
                .where("agent_id", "==", agent_id) \
                .where("session_id", "==", session_id) \
                .stream()
            
            for msg in messages:
                msg.reference.delete()
            
            # Delete pending changes
            changes = self.pending_changes_collection \
                .where("agent_id", "==", agent_id) \
                .where("session_id", "==", session_id) \
                .where("status", "==", "pending") \
                .stream()
            
            for change in changes:
                change.reference.update({"status": "cancelled"})
            
            logger.info(f"✅ Cleared training history for agent {agent_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error clearing training history: {e}")
            return False
    
    def get_initial_greeting(self, agent_id: str) -> str:
        """Generate initial greeting for training session"""
        try:
            agent = self.agent_service.get_agent(agent_id)
            agent_name = agent.name if agent else "your agent"
            
            return """Hi😊 It's wonderful to connect with you again—imagine me offering a virtual cup of chai to brighten your day. I have a list of questions from previous users that I couldn't answer, and I'm ready to share it anytime; feel free to dive into any topic you like!"""
            
        except Exception as e:
            logger.error(f"Error generating greeting: {e}")
            return "Hi😊 It's wonderful to connect with you again—imagine me offering a virtual cup of chai to brighten your day. I have a list of questions from previous users that I couldn't answer, and I'm ready to share it anytime; feel free to dive into any topic you like!"
    
    def initialize_session(self, agent_id: str, session_id: str) -> str:
        """Initialize a new training session by saving the greeting message"""
        try:
            # Check if session already has messages
            existing_messages = self.training_messages_collection \
                .where("agent_id", "==", agent_id) \
                .where("session_id", "==", session_id) \
                .limit(1) \
                .stream()
            
            if list(existing_messages):
                # Session already exists, return existing greeting or generate new one
                greeting = self.get_initial_greeting(agent_id)
                return greeting
            
            # Save greeting message to create the session
            greeting = self.get_initial_greeting(agent_id)
            self.save_training_message(
                agent_id=agent_id,
                session_id=session_id,
                role="assistant",
                content=greeting
            )
            
            logger.info(f"✅ Initialized training session: {session_id} for agent {agent_id}")
            return greeting
            
        except Exception as e:
            logger.error(f"Error initializing session: {e}")
            return self.get_initial_greeting(agent_id)
    
    # ==================== Chat Management Methods (Playground AI-like) ====================
    
    def create_chat(self, agent_id: str, session_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Create a new chat session.
        If there's an active chat, archive it first.
        Always generates a new unique session_id for each chat to prevent message mixing.
        """
        try:
            # Always generate a new unique session_id for each chat
            # This ensures messages don't get mixed between chats
            session_id = f"SESSION_{uuid.uuid4().hex[:12].upper()}"
            
            # Archive any existing active chat for this agent
            active_chats = self.chats_collection \
                .where("agent_id", "==", agent_id) \
                .where("is_active", "==", True) \
                .stream()
            
            for chat_doc in active_chats:
                chat_doc.reference.update({
                    "is_active": False,
                    "updated_at": datetime.now(timezone.utc)
                })
                logger.info(f"📦 Archived previous active chat: {chat_doc.id}")
            
            # Create new chat document
            chat_id = f"CHAT_{uuid.uuid4().hex[:12].upper()}"
            now = datetime.now(timezone.utc)
            
            chat_data = {
                "chat_id": chat_id,
                "agent_id": agent_id,
                "session_id": session_id,
                "messages": [],
                "created_at": now,
                "updated_at": now,
                "is_active": True,
                "title": None,
                "message_count": 0
            }
            
            self.chats_collection.document(chat_id).set(chat_data)
            
            # Initialize with greeting message
            greeting = self.get_initial_greeting(agent_id)
            self.save_training_message(
                agent_id=agent_id,
                session_id=session_id,
                role="assistant",
                content=greeting
            )
            
            # Add greeting to chat messages
            greeting_msg = {
                "message_id": f"MSG_{uuid.uuid4().hex[:12].upper()}",
                "role": "assistant",
                "content": greeting,
                "created_at": now,
                "metadata": {}
            }
            
            chat_data["messages"] = [greeting_msg]
            chat_data["message_count"] = 1
            self.chats_collection.document(chat_id).update(chat_data)
            
            logger.info(f"✅ Created new chat: {chat_id} for agent {agent_id}")
            return chat_data
            
        except Exception as e:
            logger.error(f"❌ Error creating chat: {e}", exc_info=True)
            raise
    
    def get_chats(self, agent_id: str) -> Dict[str, Any]:
        """
        Get all chats for an agent, including the ongoing chat.
        Returns: {chats: List[Dict], ongoing_chat: Optional[Dict]}
        """
        try:
            # Get all chats for this agent
            all_chats = self.chats_collection \
                .where("agent_id", "==", agent_id) \
                .stream()
            
            chats = []
            ongoing_chat = None
            
            for chat_doc in all_chats:
                chat_data = chat_doc.to_dict()
                if chat_data:
                    # Use messages from chat document (already stored there)
                    # This prevents duplicates from training_messages collection
                    messages = chat_data.get("messages", [])
                    
                    # Ensure messages are properly formatted
                    formatted_messages = []
                    seen_message_ids = set()  # Deduplicate by message_id
                    
                    for msg in messages:
                        msg_id = msg.get("message_id") or msg.get("message_id", "")
                        if msg_id and msg_id not in seen_message_ids:
                            seen_message_ids.add(msg_id)
                            # Ensure created_at is a datetime
                            if isinstance(msg.get("created_at"), str):
                                try:
                                    msg["created_at"] = datetime.fromisoformat(msg["created_at"].replace('Z', '+00:00'))
                                except:
                                    msg["created_at"] = datetime.now(timezone.utc)
                            formatted_messages.append(msg)
                    
                    # Sort by created_at
                    formatted_messages.sort(
                        key=lambda x: x.get("created_at") or datetime.min.replace(tzinfo=timezone.utc)
                    )
                    
                    chat_data["messages"] = formatted_messages
                    chat_data["message_count"] = len(formatted_messages)
                    
                    if chat_data.get("is_active", False):
                        ongoing_chat = chat_data
                    else:
                        chats.append(chat_data)
            
            # Sort chats by updated_at (newest first)
            chats.sort(
                key=lambda x: x.get("updated_at") or datetime.min.replace(tzinfo=timezone.utc),
                reverse=True
            )
            
            # If no ongoing chat exists, create one
            if not ongoing_chat:
                ongoing_chat_data = self.create_chat(agent_id)
                ongoing_chat = ongoing_chat_data
            
            return {
                "chats": chats,
                "ongoing_chat": ongoing_chat
            }
            
        except Exception as e:
            logger.error(f"❌ Error getting chats: {e}", exc_info=True)
            return {"chats": [], "ongoing_chat": None}
    
    def get_chat_by_id(self, chat_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific chat by ID"""
        try:
            chat_doc = self.chats_collection.document(chat_id).get()
            if not chat_doc.exists:
                return None
            
            chat_data = chat_doc.to_dict()
            if chat_data:
                # Use messages from chat document (already stored there)
                messages = chat_data.get("messages", [])
                
                # Ensure messages are properly formatted and deduplicated
                formatted_messages = []
                seen_message_ids = set()
                
                for msg in messages:
                    msg_id = msg.get("message_id") or msg.get("message_id", "")
                    if msg_id and msg_id not in seen_message_ids:
                        seen_message_ids.add(msg_id)
                        # Ensure created_at is a datetime
                        if isinstance(msg.get("created_at"), str):
                            try:
                                msg["created_at"] = datetime.fromisoformat(msg["created_at"].replace('Z', '+00:00'))
                            except:
                                msg["created_at"] = datetime.now(timezone.utc)
                        formatted_messages.append(msg)
                
                # Sort by created_at
                formatted_messages.sort(
                    key=lambda x: x.get("created_at") or datetime.min.replace(tzinfo=timezone.utc)
                )
                
                chat_data["messages"] = formatted_messages
                chat_data["message_count"] = len(formatted_messages)
            
            return chat_data
            
        except Exception as e:
            logger.error(f"❌ Error getting chat by ID: {e}", exc_info=True)
            return None
    
    def archive_chat(self, chat_id: str) -> bool:
        """Archive a chat (mark as inactive)"""
        try:
            chat_ref = self.chats_collection.document(chat_id)
            chat_doc = chat_ref.get()
            
            if not chat_doc.exists:
                raise ValueError(f"Chat {chat_id} not found")
            
            chat_ref.update({
                "is_active": False,
                "updated_at": datetime.now(timezone.utc)
            })
            
            logger.info(f"📦 Archived chat: {chat_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error archiving chat: {e}", exc_info=True)
            raise
    
    def delete_chat(self, chat_id: str) -> bool:
        """Delete a chat and all its messages"""
        try:
            chat_ref = self.chats_collection.document(chat_id)
            chat_doc = chat_ref.get()
            
            if not chat_doc.exists:
                raise ValueError(f"Chat {chat_id} not found")
            
            chat_data = chat_doc.to_dict()
            if chat_data:
                # Delete all messages associated with this chat's session
                session_id = chat_data.get("session_id")
                agent_id = chat_data.get("agent_id")
                
                if session_id and agent_id:
                    messages = self.training_messages_collection \
                        .where("agent_id", "==", agent_id) \
                        .where("session_id", "==", session_id) \
                        .stream()
                    
                    for msg in messages:
                        msg.reference.delete()
            
            # Delete the chat document
            chat_ref.delete()
            
            logger.info(f"🗑️ Deleted chat: {chat_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error deleting chat: {e}", exc_info=True)
            raise
    
    def _load_chat_messages(self, agent_id: str, session_id: str) -> List[Dict[str, Any]]:
        """Load messages for a chat session"""
        try:
            messages = self.training_messages_collection \
                .where("agent_id", "==", agent_id) \
                .where("session_id", "==", session_id) \
                .stream()
            
            result = []
            for msg in messages:
                msg_dict = msg.to_dict()
                if msg_dict:
                    # Convert Firestore Timestamp to datetime if needed
                    if 'created_at' in msg_dict and msg_dict['created_at']:
                        created_at = msg_dict['created_at']
                        if hasattr(created_at, 'timestamp'):
                            msg_dict['created_at'] = created_at
                        elif isinstance(created_at, datetime):
                            msg_dict['created_at'] = created_at
                    
                    # Ensure message_id is present
                    if 'message_id' not in msg_dict:
                        msg_dict['message_id'] = msg.id
                    
                    result.append({
                        "message_id": msg_dict.get("message_id", msg.id),
                        "role": msg_dict.get("role", "assistant"),
                        "content": msg_dict.get("content", ""),
                        "created_at": msg_dict.get("created_at", datetime.now(timezone.utc)),
                        "metadata": msg_dict.get("metadata", {})
                    })
            
            # Sort by created_at
            result.sort(key=lambda x: x.get("created_at") or datetime.min.replace(tzinfo=timezone.utc))
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Error loading chat messages: {e}", exc_info=True)
            return []
    
    def add_message_to_chat(self, chat_id: str, role: str, content: str, metadata: Dict = None) -> str:
        """Add a message to a chat and update the chat document"""
        try:
            chat_ref = self.chats_collection.document(chat_id)
            chat_doc = chat_ref.get()
            
            if not chat_doc.exists:
                raise ValueError(f"Chat {chat_id} not found")
            
            chat_data = chat_doc.to_dict()
            session_id = chat_data.get("session_id")
            agent_id = chat_data.get("agent_id")
            
            # Save message to training_messages collection
            message_id = self.save_training_message(
                agent_id=agent_id,
                session_id=session_id,
                role=role,
                content=content,
                metadata=metadata or {}
            )
            
            # Create message object
            message_obj = {
                "message_id": message_id,
                "role": role,
                "content": content,
                "created_at": datetime.now(timezone.utc),
                "metadata": metadata or {}
            }
            
            # Update chat document
            current_messages = chat_data.get("messages", [])
            current_messages.append(message_obj)
            
            chat_ref.update({
                "messages": current_messages,
                "message_count": len(current_messages),
                "updated_at": datetime.now(timezone.utc)
            })
            
            logger.info(f"✅ Added message to chat {chat_id}")
            return message_id
            
        except Exception as e:
            logger.error(f"❌ Error adding message to chat: {e}", exc_info=True)
            raise
    
    def edit_training_message(self, message_id: str, new_content: str) -> bool:
        """Edit a training message by updating its content"""
        try:
            message_ref = self.training_messages_collection.document(message_id)
            message_doc = message_ref.get()
            
            if not message_doc.exists:
                logger.warning(f"⚠️ Message {message_id} not found")
                return False
            
            # Update the message content
            message_ref.update({
                "content": new_content,
                "updated_at": datetime.now(timezone.utc)
            })
            
            # Also update in chat documents if the message is part of a chat
            message_data = message_doc.to_dict()
            if message_data:
                agent_id = message_data.get("agent_id")
                session_id = message_data.get("session_id")
                
                if agent_id and session_id:
                    # Find all chats with this session_id and update the message
                    chats = self.chats_collection \
                        .where("agent_id", "==", agent_id) \
                        .where("session_id", "==", session_id) \
                        .stream()
                    
                    for chat_doc in chats:
                        chat_data = chat_doc.to_dict()
                        if chat_data:
                            messages = chat_data.get("messages", [])
                            updated = False
                            
                            for msg in messages:
                                if msg.get("message_id") == message_id:
                                    msg["content"] = new_content
                                    updated = True
                                    break
                            
                            if updated:
                                chat_doc.reference.update({
                                    "messages": messages,
                                    "updated_at": datetime.now(timezone.utc)
                                })
                                logger.info(f"✅ Updated message in chat {chat_doc.id}")
            
            logger.info(f"✅ Edited training message: {message_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error editing training message: {e}", exc_info=True)
            return False
    
    def delete_training_message(self, message_id: str) -> bool:
        """Delete a training message"""
        try:
            message_ref = self.training_messages_collection.document(message_id)
            message_doc = message_ref.get()
            
            if not message_doc.exists:
                logger.warning(f"⚠️ Message {message_id} not found")
                return False
            
            # Get message data before deleting
            message_data = message_doc.to_dict()
            agent_id = message_data.get("agent_id") if message_data else None
            session_id = message_data.get("session_id") if message_data else None
            
            # Delete from training_messages collection
            message_ref.delete()
            
            # Also remove from chat documents if the message is part of a chat
            if agent_id and session_id:
                # Find all chats with this session_id and remove the message
                chats = self.chats_collection \
                    .where("agent_id", "==", agent_id) \
                    .where("session_id", "==", session_id) \
                    .stream()
                
                for chat_doc in chats:
                    chat_data = chat_doc.to_dict()
                    if chat_data:
                        messages = chat_data.get("messages", [])
                        updated_messages = [msg for msg in messages if msg.get("message_id") != message_id]
                        
                        if len(updated_messages) < len(messages):
                            chat_doc.reference.update({
                                "messages": updated_messages,
                                "message_count": len(updated_messages),
                                "updated_at": datetime.now(timezone.utc)
                            })
                            logger.info(f"✅ Removed message from chat {chat_doc.id}")
            
            logger.info(f"✅ Deleted training message: {message_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error deleting training message: {e}", exc_info=True)
            return False

