import uuid
import logging
import re
import json
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from google.cloud import firestore

from ..models import Rule, RuleSaveRequest, RuleCondition, RuleAction, RuleMatchType
from ..config import gcp_clients
from .agent_service import AgentService

logger = logging.getLogger(__name__)

# Import for LLM-based matching
try:
    from .vertex_ai_service import VertexAIService
    LLM_AVAILABLE = True
except ImportError:
    LLM_AVAILABLE = False
    logger.warning("⚠️ VertexAIService not available - LLM rule matching disabled")


class RulesService:
    """Service layer for rules management with multiple conditions and actions support"""
    
    # Valid condition types from frontend
    VALID_CONDITION_TYPES = [
        "Conversation starts",
        "User wants to",
        "User talks about",
        "User asks about",
        "User sentiment is",
        "User provides",
        "The sentence contains"
    ]
    
    # Valid action types from frontend
    VALID_ACTION_TYPES = [
        "Say exact message",
        "Always include",
        "Always talk about",
        "Talk about/mention",
        "Don't talk about/mention",
        "Ask for information",
        "Find in website",
        "Answer Using Knowledge Base"
    ]
    
    def __init__(self):
        self._firestore_client = None
        self._project_id = None
        self._rules_collection = None
        self._vertex_ai = None
        self._agent_service = None
        self._initialized = False
    
    def _ensure_initialized(self):
        """Lazy initialization - only initialize when first accessed"""
        if self._initialized:
            return
        
        try:
            self._firestore_client = gcp_clients.get_firestore_client()
            self._project_id = gcp_clients.get_project_id()
            
            # Initialize collections
            self._rules_collection = self._firestore_client.collection('rules')
            
            # Initialize LLM service for smart rule matching
            if LLM_AVAILABLE:
                try:
                    self._vertex_ai = VertexAIService(self._project_id)
                    logger.info("✅ RulesService initialized with LLM-based matching")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to initialize VertexAI for rules: {e}")
                    logger.info("✅ RulesService initialized with code-based matching only")
            else:
                logger.info("✅ RulesService initialized with code-based matching only")
            
            # Initialize Agent Service for loading settings
            self._agent_service = AgentService()
            
            self._initialized = True
        except Exception as e:
            logger.warning(f"⚠️ RulesService initialization deferred (will retry on first use): {e}")
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
    def rules_collection(self):
        self._ensure_initialized()
        return self._rules_collection
    
    @property
    def vertex_ai(self):
        self._ensure_initialized()
        return self._vertex_ai
    
    @property
    def agent_service(self):
        self._ensure_initialized()
        return self._agent_service
    
    def save_rule(self, request: RuleSaveRequest) -> Rule:
        """Create or update a rule with multiple conditions and actions"""
        try:
            logger.info(f"Saving rule for agent: {request.agent_id}")
            
            # Validate conditions
            for condition in request.conditions:
                if not self._validate_condition(condition):
                    raise ValueError(f"Invalid condition: {condition.type}")
            
            # Validate actions
            for action in request.actions:
                if not self._validate_action(action):
                    raise ValueError(f"Invalid action: {action.type}")
            
            # Use provided rule_id for updates, or generate new one
            is_update = request.rule_id is not None
            rule_id = request.rule_id if is_update else f"RULE_{uuid.uuid4().hex[:12].upper()}"
            
            # Get existing rule data if updating
            existing_created_at = None
            existing_active = True
            if is_update:
                existing_rule_ref = self.rules_collection.document(rule_id)
                existing_rule_doc = existing_rule_ref.get()
                if existing_rule_doc.exists:
                    existing_data = existing_rule_doc.to_dict()
                    existing_created_at = existing_data.get("created_at")
                    existing_active = existing_data.get("active", True)
            
            # Auto-generate name if empty
            name = request.name
            if not name:
                first_condition = request.conditions[0].type if request.conditions else "Rule"
                first_action = request.actions[0].type if request.actions else "Action"
                name = f"{first_condition} → {first_action}"
            
            # Create rule document
            rule_data = {
                "rule_id": rule_id,
                "agent_id": request.agent_id,
                "name": name,
                "conditions": [c.model_dump() for c in request.conditions],
                "match_type": request.match_type,
                "actions": [a.model_dump() for a in request.actions],
                "priority": request.priority,
                "active": existing_active if is_update else True,
                "updated_at": datetime.now(timezone.utc)
            }
            
            # Set created_at - use existing for updates, new timestamp for creates
            if is_update and existing_created_at:
                rule_data["created_at"] = existing_created_at
            else:
                rule_data["created_at"] = datetime.now(timezone.utc)
            
            # Save to Firestore (set with merge to preserve existing fields during update)
            rule_ref = self.rules_collection.document(rule_id)
            rule_ref.set(rule_data, merge=is_update)
            
            logger.info(f"✅ Rule saved: {rule_id} with {len(request.conditions)} conditions and {len(request.actions)} actions")
            
            # Convert back to Rule model
            return Rule(
                rule_id=rule_id,
                agent_id=request.agent_id,
                name=name,
                conditions=[RuleCondition(**c) for c in rule_data["conditions"]],
                match_type=RuleMatchType(request.match_type),
                actions=[RuleAction(**a) for a in rule_data["actions"]],
                priority=request.priority,
                active=rule_data["active"],
                created_at=rule_data["created_at"],
                updated_at=rule_data["updated_at"]
            )
            
        except Exception as e:
            logger.error(f"❌ Failed to save rule: {e}")
            raise Exception(f"Failed to save rule: {str(e)}")
    
    def _validate_condition(self, condition: RuleCondition) -> bool:
        """Validate WHEN condition"""
        try:
            if condition.type not in self.VALID_CONDITION_TYPES:
                logger.warning(f"Invalid condition type: {condition.type}")
                return False
            
            # "Conversation starts" doesn't need a value
            if condition.type == "Conversation starts":
                return True
            
            # All other conditions need a non-empty value
            if not condition.value or not condition.value.strip():
                logger.warning(f"Condition type '{condition.type}' requires a value")
                return False
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Condition validation failed: {e}")
            return False
    
    def _validate_action(self, action: RuleAction) -> bool:
        """Validate DO action"""
        try:
            if action.type not in self.VALID_ACTION_TYPES:
                logger.warning(f"Invalid action type: {action.type}")
                return False
            
            # All actions need a non-empty value
            if not action.value or not action.value.strip():
                logger.warning(f"Action type '{action.type}' requires a value")
                return False
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Action validation failed: {e}")
            return False
    
    def get_rules(self, agent_id: str) -> List[Rule]:
        """Get all rules for an agent (both active and inactive), sorted by priority"""
        try:
            # Get ALL rules for the agent (including disabled ones)
            rules_refs = self.rules_collection.where('agent_id', '==', agent_id).stream()
            
            rules = []
            for rule_doc in rules_refs:
                rule_data = rule_doc.to_dict()
                
                # Handle both old and new format
                if "conditions" in rule_data:
                    # New format with multiple conditions
                    rules.append(Rule(
                        rule_id=rule_data["rule_id"],
                        agent_id=rule_data["agent_id"],
                        name=rule_data.get("name", ""),
                        conditions=[RuleCondition(**c) for c in rule_data["conditions"]],
                        match_type=RuleMatchType(rule_data.get("match_type", "ANY")),
                        actions=[RuleAction(**a) for a in rule_data["actions"]],
                        priority=rule_data.get("priority", 1),
                        active=rule_data.get("active", True),
                        created_at=rule_data.get("created_at"),
                        updated_at=rule_data.get("updated_at")
                    ))
                elif "when" in rule_data:
                    # Old format - convert to new format
                    rules.append(Rule(
                        rule_id=rule_data["rule_id"],
                        agent_id=rule_data["agent_id"],
                        name=rule_data.get("name", ""),
                        conditions=[RuleCondition(**rule_data["when"])],
                        match_type=RuleMatchType.ANY,
                        actions=[RuleAction(**rule_data["do"])],
                        priority=rule_data.get("priority", 1),
                        active=rule_data.get("active", True),
                        created_at=rule_data.get("created_at"),
                        updated_at=rule_data.get("updated_at")
                    ))
            
            # Sort by priority (descending)
            rules.sort(key=lambda x: x.priority, reverse=True)
            
            return rules
            
        except Exception as e:
            logger.error(f"❌ Failed to get rules: {e}")
            return []
    
    def delete_rule(self, rule_id: str) -> bool:
        """Delete a rule"""
        try:
            rule_ref = self.rules_collection.document(rule_id)
            rule_ref.delete()
            
            logger.info(f"✅ Rule deleted: {rule_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to delete rule: {e}")
            raise Exception(f"Failed to delete rule: {str(e)}")
    
    def update_rule_status(self, rule_id: str, active: bool) -> bool:
        """Enable or disable a rule"""
        try:
            rule_ref = self.rules_collection.document(rule_id)
            rule_ref.update({
                "active": active,
                "updated_at": datetime.now(timezone.utc)
            })
            
            status = "enabled" if active else "disabled"
            logger.info(f"✅ Rule {rule_id} {status}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to update rule status: {e}")
            raise Exception(f"Failed to update rule status: {str(e)}")
    
    def evaluate_rules(self, agent_id: str, message: str, context: Dict[str, Any]) -> Optional[Rule]:
        """
        Evaluate rules against message and context using LLM-based matching.
        Falls back to code-based matching if LLM is unavailable.
        Returns the first matching rule (highest priority first).
        
        context should contain:
        - is_conversation_start: bool - True if this is the first message
        - intent: dict - detected intent
        - sentiment: dict - detected sentiment
        - entities: list - extracted entities
        """
        try:
            rules = self.get_rules(agent_id)
            
            if not rules:
                logger.info("📋 No rules configured for this agent")
                return None
            
            # Try LLM-based matching first (smarter, understands context)
            if self.vertex_ai:
                # Load agent settings to get model configuration
                settings = self.agent_service.get_settings(agent_id)
                model_name = settings.model if settings else None
                logger.info(f"📋 RulesService using model from settings: {model_name}")
                matched_rule = self._evaluate_rules_with_llm(rules, message, context, model_name=model_name)
                if matched_rule:
                    return matched_rule
                logger.info("🤖 LLM found no matching rules, trying code-based fallback...")
            
            # Fallback to code-based matching
            for rule in rules:
                if self._rule_matches(rule, message, context):
                    logger.info(f"✅ Rule matched (code-based): {rule.rule_id}")
                    return rule
            
            return None
            
        except Exception as e:
            logger.error(f"❌ Failed to evaluate rules: {e}")
            return None
    
    def _evaluate_rules_with_llm(self, rules: List[Rule], message: str, context: Dict[str, Any], model_name: Optional[str] = None) -> Optional[Rule]:
        """
        Use Gemini to intelligently match rules against the user's message.
        This understands context, synonyms, sentiment, and meaning - not just keywords.
        """
        try:
            # Build a description of all rules for Gemini
            rules_description = []
            for i, rule in enumerate(rules, 1):
                conditions_text = []
                for c in rule.conditions:
                    if c.type == "Conversation starts":
                        conditions_text.append("This is the first message in the conversation")
                    else:
                        conditions_text.append(f"{c.type}: '{c.value}'")
                
                match_logic = "ALL" if rule.match_type == RuleMatchType.ALL else "ANY"
                conditions_str = f" ({match_logic} of: " + ", ".join(conditions_text) + ")" if len(conditions_text) > 1 else conditions_text[0] if conditions_text else ""
                
                actions_text = [f"{a.type}: '{a.value[:50]}...'" if len(a.value) > 50 else f"{a.type}: '{a.value}'" for a in rule.actions]
                
                rules_description.append(f"Rule {i}: WHEN {conditions_str} → DO {', '.join(actions_text)}")
            
            # Check if this is conversation start
            is_first_message = context.get("is_conversation_start", False)
            
            # Build the prompt for Gemini
            prompt = f"""You are a rule matching assistant. Your job is to determine which rule(s) should be triggered based on the user's message.

Here are the rules configured for this AI agent:
{chr(10).join(rules_description)}

Context:
- Is this the first message in conversation? {is_first_message}
- Detected sentiment: {context.get('sentiment', {}).get('sentiment', 'unknown')}
- Detected intent: {context.get('intent', {}).get('intent', 'unknown')}

User's message: "{message}"

Instructions:
1. Analyze the user's message for meaning, intent, and emotion (not just keywords)
2. Determine if any rule should be triggered
3. Consider context, synonyms, paraphrasing, and implied meaning
4. For "Conversation starts" rules, only match if is_first_message is True
5. For sentiment rules, match based on the emotional tone (angry/frustrated = negative, happy/grateful = positive)
6. For topic rules, match if the user is discussing or asking about that topic in any way

Return ONLY a JSON object in this exact format:
{{
  "matched_rule": <rule number 1-{len(rules)} or 0 if no match>,
  "confidence": <0-100>,
  "reason": "brief explanation of why this rule matches or doesn't"
}}

Return 0 for matched_rule if no rule clearly applies. Be smart about matching - understand what the user MEANS, not just what words they use."""

            # Call Gemini for rule matching
            logger.info(f"🤖 Asking Gemini to match {len(rules)} rules against message: '{message[:50]}...'")
            
            # Use model from settings if available
            response = self.vertex_ai.generate_text(prompt, model_name=model_name)
            
            # Parse the response
            try:
                # Extract JSON from response (handle markdown code blocks)
                json_str = response
                if "```json" in response:
                    json_str = response.split("```json")[1].split("```")[0].strip()
                elif "```" in response:
                    json_str = response.split("```")[1].split("```")[0].strip()
                
                result = json.loads(json_str)
                matched_rule_num = int(result.get("matched_rule", 0))
                confidence = int(result.get("confidence", 0))
                reason = result.get("reason", "")
                
                logger.info(f"🤖 Gemini rule matching result: rule={matched_rule_num}, confidence={confidence}%, reason='{reason}'")
                
                # Return the matched rule if confidence is high enough
                if matched_rule_num > 0 and matched_rule_num <= len(rules) and confidence >= 60:
                    matched_rule = rules[matched_rule_num - 1]
                    logger.info(f"✅ Rule matched (LLM): {matched_rule.rule_id} - '{matched_rule.name}' (confidence: {confidence}%)")
                    return matched_rule
                else:
                    logger.info(f"🤖 No rule matched by LLM (rule={matched_rule_num}, confidence={confidence}%)")
                    return None
                    
            except (json.JSONDecodeError, ValueError, KeyError) as e:
                logger.warning(f"⚠️ Failed to parse LLM response: {e}, response: {response[:200]}")
                return None
                
        except Exception as e:
            logger.error(f"❌ LLM rule matching failed: {e}")
            return None
    
    def _rule_matches(self, rule: Rule, message: str, context: Dict[str, Any]) -> bool:
        """Check if a rule matches the message and context"""
        try:
            logger.info(f"🔎 Evaluating rule '{rule.name}' (ID: {rule.rule_id}) against message: '{message[:50]}...'")
            condition_results = []
            
            for condition in rule.conditions:
                matched = self._evaluate_condition(condition, message, context)
                condition_results.append(matched)
                logger.info(f"   └─ Condition '{condition.type}': '{condition.value}' → {'✓ MATCH' if matched else '✗ NO MATCH'}")
            
            # Apply match type logic
            if rule.match_type == RuleMatchType.ALL:
                # All conditions must match (AND logic)
                final_match = all(condition_results)
            else:
                # Any condition can match (OR logic)
                final_match = any(condition_results)
            
            logger.info(f"   └─ Match type: {rule.match_type}, Final result: {'✓ RULE MATCHES' if final_match else '✗ RULE DOES NOT MATCH'}")
            return final_match
            
        except Exception as e:
            logger.error(f"❌ Rule matching failed: {e}")
            return False

    def _evaluate_condition(self, condition: RuleCondition, message: str, context: Dict[str, Any]) -> bool:
        """Evaluate a single condition against the message and context"""
        try:
            condition_type = condition.type
            condition_value = condition.value.lower() if condition.value else ""
            message_lower = message.lower()
            
            if condition_type == "Conversation starts":
                # Check if this is the first message in the conversation
                return context.get("is_conversation_start", False)
            
            elif condition_type == "User wants to":
                # Check if user's intent matches
                # Extract key topic words from condition value (e.g., "talk about saree" → "saree")
                detected_intent = context.get("intent", {}).get("intent", "").lower()
                
                # Remove common filler words to get the key topic
                filler_words = {'talk', 'about', 'discuss', 'know', 'learn', 'get', 'find', 'see', 'buy', 'purchase', 'order'}
                condition_words = set(condition_value.split())
                key_words = condition_words - filler_words
                
                # Check if any key word is in message
                key_topic_match = any(word in message_lower for word in key_words) if key_words else False
                
                logger.info(f"🔍 'User wants to' check: condition='{condition_value}', key_words={key_words}, message contains key={key_topic_match}")
                
                return (
                    condition_value in detected_intent or
                    condition_value in message_lower or
                    key_topic_match or  # Match if key topic word is present
                    self._fuzzy_match(condition_value, message_lower)
                )
            
            elif condition_type == "User talks about":
                # Check if user mentions a topic - more flexible matching
                # Also extract key words from multi-word conditions
                condition_words = set(condition_value.split())
                filler_words = {'about', 'the', 'a', 'an', 'some', 'any'}
                key_words = condition_words - filler_words
                
                # Check direct match or key word match
                direct_match = condition_value in message_lower
                key_word_match = any(word in message_lower for word in key_words) if key_words else False
                topic_match = self._topic_match(condition_value, message_lower)
                
                result = direct_match or key_word_match or topic_match
                logger.info(f"🔍 'User talks about' check: topic='{condition_value}', key_words={key_words}, direct={direct_match}, key_word={key_word_match}, topic={topic_match}, result={result}")
                
                return result
            
            elif condition_type == "User asks about":
                # Check if user is asking about something
                is_question = any(q in message_lower for q in ['?', 'what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'could', 'would', 'should'])
                return is_question and condition_value in message_lower
            
            elif condition_type == "User sentiment is":
                # Check if sentiment matches - with flexible matching
                detected_sentiment = context.get("sentiment", {}).get("sentiment", "").lower()
                condition_lower = condition_value.lower()
                
                # Map various sentiment expressions to standard categories
                negative_words = {'negative', 'angry', 'anger', 'frustrated', 'frustrating', 'upset', 'mad', 'annoyed', 'irritated', 'sad', 'unhappy', 'disappointed', 'scolding', 'rude', 'hostile', 'aggressive', 'hate', 'stupid', 'bad', 'terrible', 'awful', 'worst'}
                positive_words = {'positive', 'happy', 'glad', 'pleased', 'satisfied', 'excited', 'joyful', 'grateful', 'thankful', 'love', 'great', 'wonderful', 'amazing', 'excellent', 'good', 'nice', 'fantastic', 'awesome'}
                neutral_words = {'neutral', 'okay', 'ok', 'fine', 'normal', 'indifferent'}
                
                # Check if condition contains negative/positive/neutral sentiment words
                condition_is_negative = any(word in condition_lower for word in negative_words)
                condition_is_positive = any(word in condition_lower for word in positive_words)
                condition_is_neutral = any(word in condition_lower for word in neutral_words)
                
                # Check detected sentiment category
                detected_is_negative = detected_sentiment in ['negative', 'angry', 'frustrated', 'sad', 'upset']
                detected_is_positive = detected_sentiment in ['positive', 'happy', 'satisfied', 'excited']
                detected_is_neutral = detected_sentiment in ['neutral', 'mixed']
                
                # Match if categories align
                category_match = (
                    (condition_is_negative and detected_is_negative) or
                    (condition_is_positive and detected_is_positive) or
                    (condition_is_neutral and detected_is_neutral)
                )
                
                # Also check direct match
                direct_match = condition_value in detected_sentiment or detected_sentiment == condition_value
                
                result = category_match or direct_match
                logger.info(f"🔍 'User sentiment is' check: condition='{condition_value}', detected='{detected_sentiment}', condition_negative={condition_is_negative}, detected_negative={detected_is_negative}, result={result}")
                
                return result
            
            elif condition_type == "User provides":
                # Check if user provides specific information (email, phone, name, etc.)
                return self._check_user_provides(condition_value, message)
            
            elif condition_type == "The sentence contains":
                # Simple keyword/phrase matching
                return condition_value in message_lower
            
            return False
            
        except Exception as e:
            logger.error(f"❌ Condition evaluation failed: {e}")
            return False
    
    def _fuzzy_match(self, target: str, text: str, threshold: float = 0.7) -> bool:
        """Simple fuzzy matching using word overlap"""
        target_words = set(target.split())
        text_words = set(text.split())
        
        if not target_words:
            return False
        
        overlap = len(target_words & text_words)
        return (overlap / len(target_words)) >= threshold
    
    def _topic_match(self, topic: str, text: str) -> bool:
        """Check if a topic is mentioned in text using various matching strategies"""
        # Direct match
        if topic in text:
            return True
        
        # Word boundary match
        pattern = r'\b' + re.escape(topic) + r'\b'
        if re.search(pattern, text, re.IGNORECASE):
            return True
        
        return False
    
    def _check_user_provides(self, info_type: str, message: str) -> bool:
        """Check if user provides specific type of information"""
        info_type_lower = info_type.lower()
        
        # Email detection
        if 'email' in info_type_lower:
            email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
            return bool(re.search(email_pattern, message))
        
        # Phone detection
        if 'phone' in info_type_lower or 'number' in info_type_lower:
            phone_pattern = r'[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}'
            return bool(re.search(phone_pattern, message))
        
        # Name detection (capitalized words)
        if 'name' in info_type_lower:
            # Look for "my name is X" or "I am X" patterns
            name_patterns = [
                r"my name is\s+([A-Z][a-z]+)",
                r"i am\s+([A-Z][a-z]+)",
                r"i'm\s+([A-Z][a-z]+)",
                r"call me\s+([A-Z][a-z]+)"
            ]
            for pattern in name_patterns:
                if re.search(pattern, message, re.IGNORECASE):
                    return True
        
        # Generic - check if the info_type keyword appears
        return info_type_lower in message.lower()
    
    def execute_actions(self, rule: Rule, message: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute all actions from a matched rule.
        Returns action results to be used in chat response.
        """
        results = {
            "exact_response": None,          # If set, use this exact response
            "include_always": [],             # Content to always include
            "talk_about": [],                 # Topics to focus on
            "dont_talk_about": [],            # Topics to avoid
            "ask_for": [],                    # Information to ask user for
            "search_website": None,           # Website to search
            "use_kb": False,                  # Whether to use knowledge base
            "kb_source": None                 # Specific KB source: None (all), "file:name", "link:url", "text:id"
        }
        
        logger.info(f"🎯 Executing {len(rule.actions)} actions for rule '{rule.name}'")
        
        try:
            for action in rule.actions:
                logger.info(f"   └─ Action: '{action.type}' → '{action.value[:50]}...' " if len(action.value) > 50 else f"   └─ Action: '{action.type}' → '{action.value}'")
                action_type = action.type
                action_value = action.value
                
                if action_type == "Say exact message":
                    results["exact_response"] = action_value
                
                elif action_type == "Always include":
                    results["include_always"].append(action_value)
                
                elif action_type == "Always talk about":
                    results["talk_about"].append(action_value)
                
                elif action_type == "Talk about/mention":
                    results["talk_about"].append(action_value)
                
                elif action_type == "Don't talk about/mention":
                    results["dont_talk_about"].append(action_value)
                
                elif action_type == "Ask for information":
                    results["ask_for"].append(action_value)
                
                elif action_type == "Find in website":
                    results["search_website"] = action_value
                
                elif action_type == "Answer Using Knowledge Base":
                    results["use_kb"] = True
                    # Parse specific KB source if provided
                    # Values can be: "All Knowledge Base", "File: filename.pdf", "Link: Page Title", "Text: content..."
                    if action_value and action_value != "All Knowledge Base":
                        if action_value.startswith("File: "):
                            results["kb_source"] = {"type": "file", "name": action_value[6:]}
                            logger.info(f"   📁 Filtering KB to file: {action_value[6:]}")
                        elif action_value.startswith("Link: "):
                            results["kb_source"] = {"type": "link", "name": action_value[6:]}
                            logger.info(f"   🔗 Filtering KB to link: {action_value[6:]}")
                        elif action_value.startswith("Text: "):
                            results["kb_source"] = {"type": "text", "content": action_value[6:]}
                            logger.info(f"   📝 Filtering KB to text: {action_value[6:50]}...")
                    else:
                        logger.info(f"   📚 Using all Knowledge Base")
            
            logger.info(f"✅ Executed {len(rule.actions)} actions for rule {rule.rule_id}")
            return results
            
        except Exception as e:
            logger.error(f"❌ Failed to execute actions: {e}")
            return results
