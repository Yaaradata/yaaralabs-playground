import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
from google.cloud import firestore

from ..models import ChatLog, ChatRequest, Persona, Knowledge
from ..config import gcp_clients
from .agent_service import AgentService
from .knowledge_service import KnowledgeService
from .rules_service import RulesService
from .vertex_ai_service import VertexAIService
from .image_search_service import get_image_search_service

logger = logging.getLogger(__name__)


class ChatService:
    """Service layer for chat operations with rule engine and KB retrieval"""
    
    def __init__(self):
        self._firestore_client = None
        self._project_id = None
        self._chat_logs_collection = None
        self._agent_service = None
        self._knowledge_service = None
        self._rules_service = None
        self._vertex_ai = None
        self._image_search = None
        self._initialized = False
    
    def _ensure_initialized(self):
        """Lazy initialization - only initialize when first accessed"""
        if self._initialized:
            return
        
        try:
            self._firestore_client = gcp_clients.get_firestore_client()
            self._project_id = gcp_clients.get_project_id()
            
            # Initialize collections
            self._chat_logs_collection = self._firestore_client.collection('chat_logs')
            
            # Initialize services
            self._agent_service = AgentService()
            self._knowledge_service = KnowledgeService()
            self._rules_service = RulesService()
            self._vertex_ai = VertexAIService(self._project_id)
            self._image_search = get_image_search_service()
            
            self._initialized = True
            logger.info("✅ ChatService initialized")
        except Exception as e:
            logger.warning(f"⚠️ ChatService initialization deferred (will retry on first use): {e}")
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
    def chat_logs_collection(self):
        self._ensure_initialized()
        return self._chat_logs_collection
    
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
    
    @property
    def vertex_ai(self):
        self._ensure_initialized()
        return self._vertex_ai
    
    @property
    def image_search(self):
        self._ensure_initialized()
        return self._image_search
    
    def chat(self, request: ChatRequest) -> Dict[str, Any]:
        """Process chat message with rule engine and KB retrieval"""
        try:
            # Use session_id as user_id if user_id is not provided
            user_id = request.user_id if request.user_id else request.session_id
            
            logger.info(f"Processing chat for agent: {request.agent_id}")
            
            # Initialize trace
            trace = {
                "agent_id": request.agent_id,
                "message": request.message,
                "conditions_detected": [],
                "rule_matched": None,
                "kb_used": [],
                "llm_used": False,
                "response": "",
                "images": []  # Relevant images for the response
            }
            
            # Load agent and persona
            agent = self.agent_service.get_agent(request.agent_id)
            if not agent:
                raise ValueError(f"Agent not found: {request.agent_id}")
            
            persona = self.agent_service.get_persona(request.agent_id)
            if not persona:
                raise ValueError(f"Persona not found for agent: {request.agent_id}")
            
            # Load agent settings to get model configuration
            settings = self.agent_service.get_settings(request.agent_id)
            model_name = settings.model if settings else None
            logger.info(f"📋 Using model from settings: {model_name}")
            
            # Step 1: Detect conditions and build context
            conditions = self._detect_conditions(request.message, model_name)
            
            # Check if this is the first message (conversation start)
            conversation_history = self._get_recent_conversation(
                request.agent_id, 
                request.session_id, 
                limit=1
            )
            is_conversation_start = len(conversation_history) == 0
            
            # Build context for rule evaluation
            rule_context = {
                "intent": conditions.get("intent", {}),
                "sentiment": conditions.get("sentiment", {}),
                "keywords": conditions.get("keywords", []),
                "is_conversation_start": is_conversation_start
            }
            
            # Convert conditions dict to list of dicts for ChatLog model
            trace["conditions_detected"] = [
                {"type": "intent", "data": conditions.get("intent", {})},
                {"type": "sentiment", "data": conditions.get("sentiment", {})},
                {"type": "keywords", "data": conditions.get("keywords", [])},
                {"type": "is_conversation_start", "data": is_conversation_start}
            ]
            
            # Step 2: Evaluate rules (pass context dict for rule evaluation)
            matched_rule = self.rules_service.evaluate_rules(
                request.agent_id,
                request.message,
                rule_context
            )
            
            response = ""
            llm_used = False
            rule_action_results = None
            
            if matched_rule:
                # Step 3: Rule matched - execute actions
                logger.info(f"✅ Rule matched: {matched_rule.rule_id} - '{matched_rule.name}'")
                trace["rule_matched"] = matched_rule.rule_id
                rule_action_results = self.rules_service.execute_actions(matched_rule, request.message, rule_context)
                
                logger.info(f"📋 Rule action results: {rule_action_results}")
                
                # Check if we have an exact response (skip LLM)
                if rule_action_results.get("exact_response"):
                    response = rule_action_results["exact_response"]
                    llm_used = False
                    logger.info(f"📢 Using exact response (skipping LLM)")
                else:
                    # Use LLM but with rule constraints
                    llm_used = True
                    logger.info(f"🤖 Using LLM with rule constraints: talk_about={rule_action_results.get('talk_about')}")
            
            if llm_used or not matched_rule:
                # Step 4: Use KB + LLM (with rule constraints if matched)
                llm_used = True
                
                # Get conversation history for context
                conversation_history = self._get_recent_conversation(
                    request.agent_id, 
                    request.session_id, 
                    limit=10  # Last 10 messages for context
                )
                
                # Embed message using embedding model from settings
                embedding_model_name = settings.embedding_model if settings else None
                logger.info(f"🔤 Using embedding model from settings: {embedding_model_name}")
                message_embedding = self.vertex_ai.generate_embedding(request.message, embedding_model_name=embedding_model_name)
                
                # Check if rule says to use KB
                force_kb = rule_action_results.get("use_kb", False) if rule_action_results else False
                kb_source = rule_action_results.get("kb_source") if rule_action_results else None
                
                # Retrieve relevant knowledge (threshold=0.5 for better recall)
                knowledge_items = self.knowledge_service.retrieve_knowledge(
                    request.agent_id,
                    message_embedding,
                    top_k=10 if kb_source else 5,  # Get more if filtering
                    similarity_threshold=0.3 if kb_source else 0.5  # Lower threshold if filtering
                )
                
                # Filter by specific KB source if provided
                if kb_source:
                    original_count = len(knowledge_items)
                    filtered_items = []
                    
                    for kb in knowledge_items:
                        metadata = kb.metadata or {}
                        
                        if kb_source["type"] == "file":
                            # Filter by file name
                            if metadata.get("file_name") == kb_source["name"]:
                                filtered_items.append(kb)
                        
                        elif kb_source["type"] == "link":
                            # Filter by page title or URL
                            page_title = metadata.get("page_title", "")
                            url = metadata.get("url", "")
                            if kb_source["name"] == page_title or kb_source["name"] in url:
                                filtered_items.append(kb)
                        
                        elif kb_source["type"] == "text":
                            # Filter by content match (for text KB)
                            if not metadata.get("file_name") and not metadata.get("url"):
                                # This is text knowledge (no file or link metadata)
                                if kb_source["content"] in kb.content[:60]:
                                    filtered_items.append(kb)
                    
                    knowledge_items = filtered_items[:5]  # Limit to top 5 after filtering
                    logger.info(f"📚 Filtered KB from {original_count} to {len(knowledge_items)} items (source: {kb_source['type']})")
                
                trace["kb_used"] = [kb.knowledge_id for kb in knowledge_items]
                trace["kb_source_filter"] = kb_source
                trace["conversation_context_used"] = len(conversation_history)
                
                # DYNAMIC GROUNDING: Enable web search if KB has no relevant results (unless rule says use KB or a rule matched)
                # If a rule matched, disable web search - rules should provide the response
                rule_matched = matched_rule is not None
                enable_web_search = len(knowledge_items) == 0 and not force_kb and not rule_matched
                if enable_web_search:
                    logger.info("🌐 No KB matches found - enabling Google Search Grounding for web search")
                elif rule_matched:
                    logger.info("🚫 Rule matched - disabling web search (rule should provide the response)")
                
                # Build prompt with persona, knowledge, conversation history, and rule constraints
                prompt = self._build_prompt_with_confidence(
                    persona, 
                    request.message, 
                    knowledge_items,
                    conversation_history,
                    enable_web_search=enable_web_search,
                    rule_constraints=rule_action_results  # Pass rule action results as constraints
                )
                
                # Generate response using Vertex AI (with optional web search)
                if enable_web_search:
                    # Use web search grounding
                    search_result = self.vertex_ai.generate_text_with_search(prompt, enable_search=True, model_name=model_name)
                    raw_response = search_result["response"]
                    
                    # Track grounding info in trace
                    trace["web_search_used"] = search_result["grounding_used"]
                    trace["web_sources"] = search_result["sources"]
                    
                    if search_result["grounding_used"]:
                        logger.info(f"🌐 Web search performed - {len(search_result['sources'])} sources used")
                else:
                    # Standard KB-based response
                    raw_response = self.vertex_ai.generate_text(prompt, model_name=model_name)
                    trace["web_search_used"] = False
                
                # Parse confidence and response (with follow-up questions and image requirements)
                response, confidence, follow_up_questions, image_info = self._parse_confidence_response_v2(raw_response, persona)
                trace["confidence"] = confidence
                trace["follow_up_questions"] = follow_up_questions
                trace["image_info"] = image_info
                
                # Handle citation markers [1, 2, 3...] in response
                # Keep them if we have sources (frontend will make them clickable)
                # Strip them only if we have NO sources (they'd be useless)
                if enable_web_search:
                    has_sources = trace.get("web_sources") and len(trace.get("web_sources", [])) > 0
                    if not has_sources:
                        import re
                        # Remove citation patterns only when we have no sources to link to
                        response = re.sub(r'\s*\[[\d,\s]+\]', '', response)
                    else:
                        # Keep citations - frontend will make [1], [2], [3] clickable
                        logger.info(f"📝 Keeping {len(trace.get('web_sources', []))} citation markers for frontend")
                
                # Append source citations if web search was used
                if enable_web_search and trace.get("web_search_used") and trace.get("web_sources"):
                    response = self._append_source_citations(response, trace["web_sources"])
                
                logger.info(f"📊 Response confidence: {confidence}%")
                if follow_up_questions:
                    logger.info(f"❓ Follow-up questions requested: {len(follow_up_questions)}")
            
            trace["llm_used"] = llm_used
            trace["response"] = response
            
            # Step 5: Fetch relevant images (only if Gemini says they're needed)
            trace["images"] = []
            try:
                if image_info.get("needed", False) and image_info.get("count", 0) > 0:
                    logger.info(f"🖼️ Gemini requested {image_info['count']} images for query: '{image_info['query']}'")
                    
                    # If web search was used, try to get images from those sources first
                    web_sources = trace.get("web_sources", [])
                    if web_sources and len(web_sources) > 0:
                        # Try to extract images from web source pages (placeholder for future enhancement)
                        # For now, use the source URLs as context for image search
                        logger.info(f"🌐 Web search was used with {len(web_sources)} sources - using context for image search")
                    
                    # Use Gemini's image search query and count
                    if self.image_search.is_enabled and image_info.get("query"):
                        images = self.image_search.search_images(
                            image_info["query"], 
                            num_images=image_info["count"]
                        )
                        trace["images"] = images
                        
                        if images:
                            logger.info(f"🖼️ Found {len(images)} relevant images for response")
                        else:
                            logger.info(f"🖼️ No images found for query: '{image_info['query']}'")
                    else:
                        # Provide specific reason why image search is not being used
                        if not self.image_search.is_enabled:
                            logger.warning(f"🖼️ Image search is DISABLED - missing GOOGLE_API_KEY or GOOGLE_CSE_ID environment variables")
                        if not image_info.get("query"):
                            logger.warning(f"🖼️ Image search query is missing from Gemini response")
                        if not self.image_search.is_enabled and not image_info.get("query"):
                            logger.warning(f"🖼️ Image search disabled AND no query provided")
                else:
                    logger.info(f"🖼️ Gemini determined images are not needed for this response")
            except Exception as img_error:
                logger.warning(f"⚠️ Image search failed (non-fatal): {img_error}")
                trace["images"] = []
            
            # Step 6: Log full trace
            chat_log = self._log_chat(request, response, trace)
            
            logger.info(f"✅ Chat processed: {chat_log.chat_id}")
            
            return {
                "response": response,
                "trace": trace,
                "chat_id": chat_log.chat_id,
                "images": trace.get("images", [])  # Include images at top level for easy frontend access
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to process chat: {e}")
            raise Exception(f"Failed to process chat: {str(e)}")
    
    def _get_recent_conversation(self, agent_id: str, session_id: str, limit: int = 10) -> List[Dict[str, str]]:
        """Get recent conversation history for context"""
        try:
            chat_logs = self.chat_logs_collection \
                .where('agent_id', '==', agent_id) \
                .where('session_id', '==', session_id) \
                .limit(limit * 2) \
                .stream()
            
            history = []
            for doc in chat_logs:
                data = doc.to_dict()
                history.append({
                    "role": "user",
                    "content": data.get("message", ""),
                    "timestamp": data.get("created_at")
                })
                history.append({
                    "role": "assistant", 
                    "content": data.get("response", ""),
                    "timestamp": data.get("created_at")
                })
            
            # Sort by timestamp and take last N messages
            history.sort(key=lambda x: x.get("timestamp") or "", reverse=False)
            
            # Return last 'limit' messages (pairs of user + assistant)
            return history[-limit:] if len(history) > limit else history
            
        except Exception as e:
            logger.warning(f"⚠️ Failed to get conversation history: {e}")
            return []
    
    def _detect_conditions(self, message: str, model_name: Optional[str] = None) -> Dict[str, Any]:
        """Detect conditions (keyword, intent, sentiment)"""
        conditions = {}
        
        # Detect intent
        try:
            intent_data = self.vertex_ai.detect_intent(message, model_name=model_name)
            conditions["intent"] = intent_data
            logger.info(f"🎯 Detected intent: {intent_data}")
        except Exception as e:
            logger.warning(f"Failed to detect intent: {e}")
            conditions["intent"] = {"intent": "unknown", "confidence": 0.0}
        
        # Detect sentiment
        try:
            sentiment_data = self.vertex_ai.detect_sentiment(message, model_name=model_name)
            conditions["sentiment"] = sentiment_data
            logger.info(f"😊 Detected sentiment: {sentiment_data}")
        except Exception as e:
            logger.warning(f"Failed to detect sentiment: {e}")
            conditions["sentiment"] = {"sentiment": "neutral", "score": 0.0}
        
        # Keyword detection (simple - just lowercase message)
        conditions["keywords"] = message.lower().split()
        
        return conditions
    
    def _execute_rule_action(self, rule, message: str) -> str:
        """Execute rule action"""
        action_type = rule.do.type
        action_value = rule.do.value
        
        if action_type == "respond":
            # Return predefined response
            if isinstance(action_value, str):
                return action_value
            elif isinstance(action_value, dict):
                return action_value.get("response", "Response executed")
        
        elif action_type == "redirect":
            # Redirect to another agent or endpoint
            return f"Redirecting to: {action_value}"
        
        elif action_type == "skip_llm":
            # Skip LLM and return simple response
            return "Rule executed - LLM skipped"
        
        return "Rule action executed"
    
    def _build_prompt(self, persona: Persona, message: str, knowledge_items: List[Knowledge]) -> str:
        """Build prompt with persona and knowledge"""
        
        # Map response_length to actual instructions
        response_length_instructions = {
            "minimal": "Keep your responses extremely brief - 1-2 sentences maximum. Be direct and to the point.",
            "short": "Keep your responses concise - 2-4 sentences. Be clear and helpful without unnecessary elaboration.",
            "long": "Provide detailed responses - 4-8 sentences. Include relevant context and thorough explanations.",
            "chatty": "Be conversational and engaging - feel free to write longer responses with personality, examples, and follow-up questions."
        }
        
        # Map tone to actual behavior instructions
        tone_instructions = {
            "friendly": "Be warm, approachable, and conversational. Use a positive and encouraging tone. Feel free to use casual language and show enthusiasm.",
            "professional": "Maintain a formal and business-like tone. Be precise, objective, and use professional language. Avoid casual expressions.",
            "casual": "Be relaxed and informal. Use everyday language, contractions, and a laid-back style. Be personable and easy-going."
        }
        
        # Get response length instruction
        response_length = getattr(persona, 'response_length', 'short') or 'short'
        length_instruction = response_length_instructions.get(response_length, response_length_instructions["short"])
        
        # Get tone instruction
        tone = persona.tone.lower() if persona.tone else 'friendly'
        tone_instruction = tone_instructions.get(tone, tone_instructions["friendly"])
        
        # Get custom guidelines
        guidelines = getattr(persona, 'guidelines', '') or ''
        
        prompt = f"""You are {persona.name}, a {persona.role}.

=== YOUR PERSONALITY & BEHAVIOR ===
TONE: {persona.tone}
{tone_instruction}

RESPONSE LENGTH: {response_length}
{length_instruction}

LANGUAGE: {persona.language}
Always respond in {persona.language}.

=== CRITICAL: HONESTY & ACCURACY RULES ===
You MUST follow these rules strictly to avoid giving wrong information:

1. **ONLY answer from Knowledge Base**: If knowledge base is provided, ONLY use that information to answer. Do NOT add information that is not in the KB.

2. **Admit uncertainty for UNKNOWABLE questions**: Some questions are impossible to answer accurately:
   - Personal details you don't have (e.g., "How many hairs does someone have?")
   - Future predictions (e.g., "What will happen in 2050?")
   - Private information (e.g., "What is someone's password?")
   - Random/arbitrary facts not in KB
   
   For these, ALWAYS say: "I don't have that information" or "That's not something I can answer accurately."

3. **NEVER hallucinate or guess**: Do NOT make up:
   - Numbers, statistics, or measurements
   - Names, dates, or specific facts
   - Personal details about people
   - Anything you're not 100% certain about
   
   If you're not sure, say: "I'm not certain about that. Could you provide more context?"

4. **Ask clarifying questions**: If the question is vague or ambiguous, ask the user to clarify before answering.

5. **Stay in your role**: Only answer questions related to your role as {persona.role}. For unrelated questions, politely redirect.

6. **When in doubt, be honest**: It's ALWAYS better to say "I don't know" than to give potentially wrong information.
"""
        
        # Add custom guidelines if provided
        if guidelines.strip():
            prompt += f"""
=== CUSTOM GUIDELINES ===
{guidelines}
"""
        
        # Add knowledge base context
        prompt += """
=== KNOWLEDGE BASE ===
"""
        
        # Add knowledge items
        if knowledge_items:
            prompt += "Use ONLY the following information to answer. Do NOT add information not present here:\n"
            for i, kb in enumerate(knowledge_items, 1):
                score = getattr(kb, 'similarity_score', 0)
                prompt += f"\n{i}. [Relevance: {score:.0%}] {kb.content}\n"
            prompt += "\nIMPORTANT: Stick to the information above. If the user asks something not covered, say you don't have that specific information.\n"
        else:
            prompt += """
(No relevant knowledge found in the knowledge base for this question)

⚠️ IMPORTANT - NO KB MATCH:
Since no relevant information was found in your knowledge base, you MUST:

1. DO NOT make up or guess any specific information
2. Politely acknowledge you don't have information about this specific topic
3. Ask the user for more context or clarification
4. Suggest what topics you CAN help with based on your role

Example responses:
- "I don't have specific information about that. Could you tell me more about what you're looking for?"
- "That's not something I have details about. Is there something else I can help you with?"
- "I'm not sure about that particular topic. Can you provide more context?"
"""
        
        prompt += f"""
=== USER MESSAGE ===
{message}

=== YOUR RESPONSE ===
Respond as {persona.name} following your personality, tone ({persona.tone}), and response length ({response_length}).

Remember:
- ONLY use information from the Knowledge Base above (if provided)
- If you don't know or aren't sure, SAY SO - don't make things up
- Ask for clarification if the question is unclear
- Stay helpful and on-topic for your role as {persona.role}
"""
        
        return prompt
    
    def _append_source_citations(self, response: str, sources: List[Dict[str, str]]) -> str:
        """
        Source citations are now handled by the frontend via structured data (web_sources).
        This method no longer appends text citations to avoid duplication.
        The frontend displays sources as interactive pills from the trace data.
        """
        # Don't append sources as text - frontend handles display via web_sources in trace
        return response
    
    def _build_prompt_with_confidence(self, persona: Persona, message: str, knowledge_items: List[Knowledge], conversation_history: List[Dict[str, str]] = None, enable_web_search: bool = False, rule_constraints: Dict[str, Any] = None) -> str:
        """Build prompt that asks LLM to provide confidence score with response and follow-up questions"""
        
        # Map response_length to actual instructions
        response_length_instructions = {
            "minimal": "Keep your responses extremely brief - 1-2 sentences maximum. BUT if user asks for a list/specific items, ALWAYS provide the complete list.",
            "short": "Keep your responses concise - 2-4 sentences for general questions. BUT if user asks for a list (e.g., '10 products', '5 examples'), ALWAYS provide ALL requested items with details.",
            "long": "Provide detailed responses - 4-8 sentences.",
            "chatty": "Be conversational and engaging with longer responses."
        }
        
        # Map tone to actual behavior instructions
        tone_instructions = {
            "friendly": "Be warm, approachable, and conversational.",
            "professional": "Maintain a formal and business-like tone.",
            "casual": "Be relaxed and informal."
        }
        
        response_length = getattr(persona, 'response_length', 'short') or 'short'
        length_instruction = response_length_instructions.get(response_length, response_length_instructions["short"])
        
        tone = persona.tone.lower() if persona.tone else 'friendly'
        tone_instruction = tone_instructions.get(tone, tone_instructions["friendly"])
        
        guidelines = getattr(persona, 'guidelines', '') or ''
        
        prompt = f"""You are {persona.name}, a {persona.role}.

=== YOUR PERSONALITY ===
TONE: {persona.tone} - {tone_instruction}
RESPONSE LENGTH: {response_length} - {length_instruction}
LANGUAGE: {persona.language}
"""
        
        if guidelines.strip():
            prompt += f"""
=== CUSTOM GUIDELINES ===
{guidelines}
"""
        
        # Add rule-based constraints if any
        if rule_constraints:
            prompt += """
=== RULE-BASED CONSTRAINTS (MUST FOLLOW) ===
A rule has been triggered. You MUST follow these constraints:
"""
            
            # Always include content
            if rule_constraints.get("include_always"):
                prompt += "\n🔒 ALWAYS INCLUDE in your response:\n"
                for content in rule_constraints["include_always"]:
                    prompt += f"- {content}\n"
            
            # Topics to talk about
            if rule_constraints.get("talk_about"):
                prompt += "\n🎯 CRITICAL - YOU MUST FOCUS ONLY ON these topics:\n"
                for topic in rule_constraints["talk_about"]:
                    prompt += f"- {topic}\n"
                prompt += "\n⚠️ IMPORTANT: You MUST talk ONLY about the topics above. Do NOT mention other related topics. Stay strictly focused on what's specified.\n"
            
            # Topics to avoid
            if rule_constraints.get("dont_talk_about"):
                prompt += "\n🚫 DO NOT mention or discuss these topics:\n"
                for topic in rule_constraints["dont_talk_about"]:
                    prompt += f"- {topic}\n"
            
            # Information to ask for
            if rule_constraints.get("ask_for"):
                prompt += "\n❓ ASK the user for this information:\n"
                for info in rule_constraints["ask_for"]:
                    prompt += f"- {info}\n"
            
            # Force KB usage
            if rule_constraints.get("use_kb"):
                prompt += "\n📚 You MUST answer using ONLY the Knowledge Base information provided below. Do NOT use general knowledge.\n"
        
        # Add conversation history for context
        if conversation_history and len(conversation_history) > 0:
            prompt += """
=== CONVERSATION HISTORY ===
Use this previous conversation to understand context:
"""
            for msg in conversation_history:
                role = "User" if msg.get("role") == "user" else "You"
                content = msg.get("content", "")[:500]  # Limit length
                prompt += f"\n{role}: {content}\n"
            prompt += "\n(Use this context to understand what the user is asking about)\n"
        
        # Add knowledge base context
        prompt += """
=== KNOWLEDGE BASE ===
"""
        if knowledge_items:
            prompt += "Available information:\n"
            for i, kb in enumerate(knowledge_items, 1):
                score = getattr(kb, 'similarity_score', 0)
                prompt += f"\n{i}. [Relevance: {score:.0%}] {kb.content}\n"
        elif enable_web_search:
            prompt += """(No relevant knowledge found in KB - WEB SEARCH IS ENABLED)

🌐 WEB SEARCH MODE ACTIVE:
You have access to Google Search to find real-time information.
- If the user's question requires current/real-time information, use web search
- Provide accurate information from web search results
- Your confidence should be HIGH (80-95) when using verified web sources

⚠️ CRITICAL - COMPLETE INFORMATION:
Even if your persona is "short" or "professional", you MUST provide COMPLETE requested information:
- If user asks for "10 products" → list ALL 10 products with URLs
- If user asks for "5 websites" → list ALL 5 websites
- Don't summarize lists - provide the actual items!

⚠️ IMPORTANT - INCLUDE ACTUAL URLS:
When you find a specific website, course, or resource, you MUST include the actual URL in your response.
Format URLs as markdown links: [Website Name](https://actual-url.com)

Examples for lists:
✅ CORRECT: 
1. **[Myntra](https://www.myntra.com)** - Great collection of ethnic wear
2. **[Flipkart](https://www.flipkart.com)** - Wide variety of options
(continue for ALL requested items)

❌ WRONG: "I have curated a selection of 10 products..." (without listing them!)
❌ WRONG: "You can find these on various websites" (without URLs!)
"""
        else:
            prompt += "(No relevant knowledge found for this question)\n"
        
        prompt += f"""
=== CURRENT USER MESSAGE ===
{message}

=== IMPORTANT: RESPONSE FORMAT ===
You MUST respond in this EXACT JSON format:

{{
  "answer": "Your actual response to the user here",
  "confidence": <number 0-100>,
  "reason": "Brief explanation of your confidence level",
  "needs_more_info": <true or false>,
  "questions_needed": ["Question 1?", "Question 2?"],
  "images_needed": <true or false>,
  "image_count": <number 0-5>,
  "image_search_query": "specific search terms for images"
}}

CONFIDENCE SCORING GUIDE:
- 90-100: Information is directly from Knowledge Base OR verified web sources
- 70-89: You're reasonably sure based on general knowledge or web search
- 50-69: You're somewhat uncertain but can provide a reasonable answer
- 0-49: You're guessing or it's unknowable without more details

📷 IMAGE REQUIREMENTS:
- Set "images_needed": true ONLY when visual content would genuinely enhance the response
- Examples where images ARE needed: fashion items, products, places, food, designs, visual concepts
- Examples where images are NOT needed: explanations, code, lists, advice, definitions, calculations
- "image_count": Number of images (1-5) based on how visual the topic is
- "image_search_query": Specific, descriptive search terms (e.g., "navy blue silk salwar suit" not "blue dress")

⚠️ CRITICAL: WHEN TO ASK FOLLOW-UP QUESTIONS:
- If confidence >= 70: JUST ANSWER. Do NOT ask follow-up questions. Set "needs_more_info": false
- If confidence < 70 AND you absolutely cannot answer: Ask ONE specific follow-up question

🚫 DO NOT ask follow-up questions like:
- "Could you tell me more about your background?"
- "What is your experience level?"
- "To help me suggest the best..."
These are ANNOYING when you already have enough info to answer!

✅ GOOD BEHAVIOR:
- User asks for "list of courses" → Just give the list. Don't ask about their background.
- User asks for "job recommendations" → Just give recommendations. Don't ask about experience.
- User asks a simple question → Answer it directly!

ONLY set "needs_more_info": true when:
- The question is genuinely ambiguous (e.g., "What should I do?" with no context)
- You literally cannot provide ANY useful answer without more info

CRITICAL RULES:
1. ANSWER FIRST, don't interrogate the user
2. If you can answer with 70%+ confidence, JUST ANSWER
3. Never ask unnecessary follow-up questions
4. Be helpful and direct

Return ONLY the JSON object, no other text.
"""
        
        return prompt
    
    def _parse_confidence_response(self, raw_response: str, persona: Persona, confidence_threshold: int = 70) -> tuple:
        """
        Parse the LLM response to extract answer and confidence.
        Returns (answer, confidence) tuple.
        If confidence < threshold, returns a fallback message.
        """
        import json
        import re
        
        try:
            # Try to extract JSON from response
            # Handle case where response might have markdown code blocks
            json_match = re.search(r'\{[^{}]*"answer"[^{}]*"confidence"[^{}]*\}', raw_response, re.DOTALL)
            
            if json_match:
                json_str = json_match.group(0)
                # Clean up the JSON string
                json_str = re.sub(r'[\n\r\t]', ' ', json_str)
                parsed = json.loads(json_str)
            else:
                # Try parsing the whole response as JSON
                parsed = json.loads(raw_response.strip())
            
            answer = parsed.get("answer", "")
            confidence = int(parsed.get("confidence", 0))
            reason = parsed.get("reason", "")
            
            logger.info(f"📊 Parsed confidence: {confidence}%, reason: {reason}")
            
            # Check confidence threshold
            if confidence >= confidence_threshold:
                return (answer, confidence)
            else:
                # Return fallback message for low confidence
                fallback = f"I'm not confident enough to answer that accurately (confidence: {confidence}%). "
                
                if confidence < 30:
                    fallback += "This seems to be information I don't have access to. Could you provide more details or ask something else?"
                elif confidence < 50:
                    fallback += "I have limited information about this. Could you provide more context?"
                else:
                    fallback += "I'm somewhat uncertain about this. Would you like me to try with more specific details?"
                
                return (fallback, confidence)
                
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            logger.warning(f"⚠️ Failed to parse confidence response: {e}")
            logger.warning(f"Raw response: {raw_response[:500]}")
            
            # If parsing fails, return the raw response with unknown confidence
            # This ensures the system still works even if JSON parsing fails
            return (raw_response, -1)
    
    def _parse_confidence_response_v2(self, raw_response: str, persona: Persona, confidence_threshold: int = 70) -> tuple:
        """
        Parse the LLM response to extract answer, confidence, follow-up questions, and image requirements.
        Returns (answer, confidence, follow_up_questions, image_info) tuple.
        
        image_info dict contains:
        - needed: bool - whether images would enhance the response
        - count: int - number of images to fetch (0-5)
        - query: str - specific search terms for images
        """
        import json
        import re
        
        logger.info(f"🔍 Raw LLM response: {raw_response[:800]}...")
        
        try:
            # Method 1: Try to find balanced JSON braces
            def extract_json(text):
                """Extract JSON by finding balanced braces"""
                start = text.find('{')
                if start == -1:
                    return None
                
                brace_count = 0
                for i, char in enumerate(text[start:], start):
                    if char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            return text[start:i+1]
                return None
            
            json_str = extract_json(raw_response)
            
            if json_str:
                # Clean up common issues
                json_str = json_str.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
                # Fix common JSON issues
                json_str = re.sub(r',\s*}', '}', json_str)  # Remove trailing commas
                json_str = re.sub(r',\s*]', ']', json_str)  # Remove trailing commas in arrays
                
                try:
                    parsed = json.loads(json_str)
                except json.JSONDecodeError as e:
                    logger.warning(f"⚠️ JSON parse error: {e}, trying to fix...")
                    # Try more aggressive cleaning
                    json_str = re.sub(r'"\s*,\s*"', '", "', json_str)
                    parsed = json.loads(json_str)
            else:
                # Try parsing the whole response as JSON
                parsed = json.loads(raw_response.strip())
            
            answer = parsed.get("answer", "")
            confidence = int(parsed.get("confidence", 0))
            reason = parsed.get("reason", "")
            needs_more_info = parsed.get("needs_more_info", False)
            questions_needed = parsed.get("questions_needed", [])
            
            # Image requirements from Gemini
            images_needed = parsed.get("images_needed", False)
            image_count = min(int(parsed.get("image_count", 0)), 5)  # Cap at 5
            image_search_query = parsed.get("image_search_query", "")
            
            logger.info(f"📊 Parsed successfully!")
            logger.info(f"📊 Confidence: {confidence}%, Reason: {reason}")
            logger.info(f"📊 Needs more info: {needs_more_info}")
            logger.info(f"📊 Questions needed: {questions_needed}")
            logger.info(f"🖼️ Images needed: {images_needed}, Count: {image_count}, Query: '{image_search_query}'")
            
            # Image info dict
            image_info = {
                "needed": images_needed,
                "count": image_count,
                "query": image_search_query
            }
            
            # Check confidence threshold
            if confidence >= confidence_threshold:
                # High confidence - return the answer directly
                logger.info(f"✅ High confidence ({confidence}%) - returning answer")
                return (answer, confidence, [], image_info)
            else:
                # Low confidence - check if LLM provided follow-up questions
                if needs_more_info and questions_needed and len(questions_needed) > 0:
                    # LLM is asking follow-up questions - append them to the answer for display
                    logger.info(f"❓ Low confidence ({confidence}%) but has follow-up questions - appending to answer")
                    
                    # Build a response that includes the follow-up questions as proper Markdown list
                    enhanced_answer = answer.strip()
                    if not enhanced_answer.endswith(('?', '.', '!')):
                        enhanced_answer += '.'
                    
                    # Use proper Markdown list format with blank line before list
                    enhanced_answer += "\n\n**To help you better, please tell me:**\n\n"
                    for question in questions_needed:
                        enhanced_answer += f"- {question}\n"
                    
                    logger.info(f"📝 Enhanced answer with {len(questions_needed)} follow-up questions")
                    return (enhanced_answer.strip(), confidence, questions_needed, image_info)
                elif answer and len(answer) > 50:
                    # LLM provided a substantial answer even with low confidence - use it
                    # The answer might already contain the follow-up questions in natural language
                    logger.info(f"📝 Low confidence ({confidence}%) but LLM provided detailed answer - using it")
                    return (answer, confidence, [], image_info)
                else:
                    # Low confidence and no useful response - create a fallback with specific questions
                    logger.info(f"⚠️ Low confidence ({confidence}%) with no follow-up - generating smart fallback")
                    
                    # Generate intelligent follow-up questions based on the context
                    fallback = "I'd like to help, but I need more information to give you an accurate answer. "
                    fallback += "Could you tell me:\n"
                    fallback += "• What specific context or details are you looking for?\n"
                    fallback += "• Is this about a specific person, topic, or situation?\n"
                    fallback += "• What would help me understand your question better?"
                    
                    # No images for fallback responses
                    return (fallback, confidence, ["What specific context?", "Is this about a specific person/topic?", "What details would help?"], {"needed": False, "count": 0, "query": ""})
                
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as e:
            logger.warning(f"⚠️ Failed to parse confidence response v2: {e}")
            logger.warning(f"Raw response: {raw_response[:500]}")
            
            # No images for failed parsing
            no_image_info = {"needed": False, "count": 0, "query": ""}
            
            # If parsing fails, return the raw response
            # Check if it looks like the LLM just gave a plain text response
            if raw_response and not raw_response.strip().startswith('{'):
                return (raw_response, 50, [], no_image_info)  # Assume medium confidence for plain text
            
            return (raw_response, -1, [], no_image_info)
    
    def _log_chat(self, request: ChatRequest, response: str, trace: Dict[str, Any]) -> ChatLog:
        """Log chat interaction"""
        try:
            chat_id = f"CHAT_{uuid.uuid4().hex[:12].upper()}"
            
            # Use session_id as user_id if user_id is not provided
            user_id = request.user_id if request.user_id else request.session_id
            
            chat_log_data = {
                "chat_id": chat_id,
                "agent_id": request.agent_id,
                "user_id": user_id,
                "session_id": request.session_id,
                "message": request.message,
                "response": response,
                "conditions_detected": trace.get("conditions_detected", []),
                "rule_matched": trace.get("rule_matched"),
                "kb_used": trace.get("kb_used", []),
                "llm_used": trace.get("llm_used", False),
                "trace": trace,
                "created_at": datetime.now(timezone.utc)
            }
            
            # Save to Firestore
            chat_ref = self.chat_logs_collection.document(chat_id)
            chat_ref.set(chat_log_data)
            
            return ChatLog(**chat_log_data)
            
        except Exception as e:
            logger.error(f"❌ Failed to log chat: {e}")
            # Return a minimal chat log if saving fails
            return ChatLog(
                chat_id=chat_id,
                agent_id=request.agent_id,
                user_id=user_id,
                session_id=request.session_id,
                message=request.message,
                response=response,
                conditions_detected=trace.get("conditions_detected", []),
                rule_matched=trace.get("rule_matched"),
                kb_used=trace.get("kb_used", []),
                llm_used=trace.get("llm_used", False),
                trace=trace
            )
    
    def teach_from_chat(self, agent_id: str, chat_id: str, approved_response: str) -> str:
        """Teach agent from approved chat response"""
        try:
            logger.info(f"Teaching agent from chat: {chat_id}")
            
            # Get chat log
            chat_ref = self.chat_logs_collection.document(chat_id)
            chat_doc = chat_ref.get()
            
            if not chat_doc.exists:
                raise ValueError(f"Chat log not found: {chat_id}")
            
            chat_data = chat_doc.to_dict()
            user_message = chat_data.get("message", "")
            
            # Create Q&A knowledge from chat
            from ..models import KnowledgeQnARequest
            qna_request = KnowledgeQnARequest(
                agent_id=agent_id,
                question=user_message,
                answer=approved_response
            )
            
            # Add as knowledge
            knowledge_id = self.knowledge_service.add_qna_knowledge(qna_request)
            
            logger.info(f"✅ Agent taught: {knowledge_id}")
            return knowledge_id
            
        except Exception as e:
            logger.error(f"❌ Failed to teach from chat: {e}")
            raise Exception(f"Failed to teach from chat: {str(e)}")
    
    def get_chat_history(self, agent_id: str, session_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get chat history for a specific agent and session"""
        try:
            logger.info(f"Getting chat history for agent: {agent_id}, session: {session_id}")
            
            # Query chat logs for this agent and session
            # Note: We don't use order_by to avoid requiring a composite index
            # Instead, we sort in Python after fetching
            query = (
                self.chat_logs_collection
                .where("agent_id", "==", agent_id)
                .where("session_id", "==", session_id)
            )
            
            docs = list(query.stream())
            
            # Sort by created_at in Python (ascending order)
            docs_sorted = sorted(
                docs, 
                key=lambda d: d.to_dict().get("created_at") or datetime.min.replace(tzinfo=timezone.utc)
            )
            
            # Apply limit after sorting
            docs_sorted = docs_sorted[:limit]
            
            messages = []
            for doc in docs_sorted:
                data = doc.to_dict()
                # Format for frontend consumption
                messages.append({
                    "id": data.get("chat_id"),
                    "role": "user",
                    "content": data.get("message", ""),
                    "timestamp": data.get("created_at").isoformat() if data.get("created_at") else None
                })
                messages.append({
                    "id": f"{data.get('chat_id')}_response",
                    "role": "assistant",
                    "content": data.get("response", ""),
                    "timestamp": data.get("created_at").isoformat() if data.get("created_at") else None
                })
            
            logger.info(f"✅ Retrieved {len(messages)} messages")
            return messages
            
        except Exception as e:
            logger.error(f"❌ Failed to get chat history: {e}")
            raise Exception(f"Failed to get chat history: {str(e)}")
    
    def clear_chat_history(self, agent_id: str, session_id: str) -> int:
        """Clear chat history for a specific agent and session"""
        try:
            logger.info(f"Clearing chat history for agent: {agent_id}, session: {session_id}")
            
            # Query chat logs for this agent and session
            query = (
                self.chat_logs_collection
                .where("agent_id", "==", agent_id)
                .where("session_id", "==", session_id)
            )
            
            docs = query.stream()
            
            # Delete each document
            deleted_count = 0
            batch = self.firestore_client.batch()
            
            for doc in docs:
                batch.delete(doc.reference)
                deleted_count += 1
                
                # Commit in batches of 500 (Firestore limit)
                if deleted_count % 500 == 0:
                    batch.commit()
                    batch = self.firestore_client.batch()
            
            # Commit remaining
            if deleted_count % 500 != 0:
                batch.commit()
            
            logger.info(f"✅ Cleared {deleted_count} chat messages")
            return deleted_count
            
        except Exception as e:
            logger.error(f"❌ Failed to clear chat history: {e}")
            raise Exception(f"Failed to clear chat history: {str(e)}")

