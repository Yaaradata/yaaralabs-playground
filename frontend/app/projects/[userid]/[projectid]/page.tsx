'use client';

import React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import Header from '../../../../components/Header';
import config from '../../../../lib/config';
import { 
  getSessionIdFromMaskedId, 
  isMaskedId, 
  isSessionId, 
  getOrCreateMaskedId,
  getProjectIdFromMaskedId,
  isMaskedProjectId,
  isProjectId
} from '../../../../lib/session-utils';
import { cleanupSessionWithReason, SessionCleanupReason } from '../../../../lib/session-cleanup';
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TeachYourAgent } from '../../../../components/TeachYourAgent'
import RuleBasedProcessProject, { resolveRbpEditor } from '../../../../components/RuleBasedProcessProject'
import ConfusionMatrixLab from '../../../../components/ConfusionMatrix'
import RagChatbotLab from '../../../../components/RagChatbot'
import AiAgentLab from '../../../../components/AiAgent'
import AgentStudio from '../../../../components/AgentStudio'
import { isStage, stageToType, type Stage } from '../../../../components/AgentStudio/stages'
import LiveObjectDetectionProject from '../../../../components/VideoClassifier'
import Exercises from '../../../../components/Exercises'

interface GuestSession {
  session_id: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
  ip_address?: string;
  user_agent?: string;
  last_active?: string;
}

interface GuestSessionResponse {
  success: boolean;
  data: GuestSession;
}

interface Project {
  id: string;
  name: string;
  type: string;  // Changed from model_type to type
  createdAt: string;
  description?: string;
  status?: string;
  maskedId?: string;
  agent_id?: string;  // For Custom AI Agent projects
  stage?: Stage | null;  // Day 2 Agent Studio stage; missing on legacy agents
  copied_from?: { agent_id: string; name: string; stage: string } | null;
  rbpEditor?: 'blocks' | 'legacy' | 'scratch' | 'rules-bot' | null;  // Rule Based Process editor: see components/RuleBasedProcessProject/editors.ts
}

// Web source interface for citations
interface WebSource {
  title: string;
  uri: string;
}

// Image result from search
interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
  width?: number;
  height?: number;
  context_url?: string;
}

// Chat message interface
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  webSearchUsed?: boolean;
  webSources?: WebSource[];
  images?: ImageResult[];
}

// Rule condition interface for WHEN dropdown
interface RuleCondition {
  id: string;
  type: string;
  value: string;
  isDropdownOpen: boolean;
}

// Rule action interface for DO dropdown
interface RuleAction {
  id: string;
  type: string;
  value: string;
  isDropdownOpen: boolean;
  kbDropdownOpen?: boolean;
}

// Saved rule from backend
interface SavedRule {
  rule_id: string;
  agent_id: string;
  name: string;
  conditions: Array<{type: string; value: string}>;
  match_type: 'ANY' | 'ALL';
  actions: Array<{type: string; value: string}>;
  priority: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// Grouped file knowledge interface
interface GroupedFileKnowledge {
  fileName: string;
  fileType: string;
  fileUrl: string;
  fileSize: number;
  totalChunks: number;
  chunks: { knowledge_id: string; [key: string]: unknown }[];
  content: string;
}

// Grouped link knowledge interface
interface GroupedLinkKnowledge {
  url: string;
  pageTitle: string;
  totalChunks: number;
  extractedChars: number;
  scrapeMethod: string;
  chunks: { knowledge_id: string; [key: string]: unknown }[];
  content: string;
}

// Agent interface
interface Agent {
  agent_id: string;
  user_id: string;
  session_id: string;
  name: string;
  role: string;
  tone: string;
  language: string;
  description: string;
  created_at: string;
  updated_at: string;
  active: boolean;
  stage?: string | null;
  project_name?: string | null;
  copied_from?: { agent_id: string; name: string; stage: string } | null;
}

// Knowledge chunk interface
interface KnowledgeChunk {
  knowledge_id: string;
  content?: string;
  [key: string]: unknown;
}

// Knowledge item interface
interface KnowledgeItem {
  knowledge_id: string;
  agent_id: string;
  type: 'text' | 'file' | 'link' | 'qna';
  content: string;
  metadata?: Record<string, unknown>;
  priority?: number;
  created_at: string;
  [key: string]: unknown;
}

export default function ProjectDetailsPage() {
  const [guestSession, setGuestSession] = useState<GuestSession | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isValidSession, setIsValidSession] = useState(false);
  const [actualSessionId, setActualSessionId] = useState<string>('');
  const [actualProjectId, setActualProjectId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'train' | 'publish'>('train');
  const [exerciseOpen, setExerciseOpen] = useState(false);
  const [exerciseBackLabel, setExerciseBackLabel] = useState('All Exercise');
  const exerciseBackRef = useRef<(() => void) | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [trainSection, setTrainSection] = useState<'settings' | 'persona' | 'knowledge' | 'actions' | 'tools' | 'forms' | 'teach'>('settings');
  const contentAreaRef = useRef<HTMLDivElement>(null);
  
  // Project Settings state
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash-lite');
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState<string>('text-embedding-005');
  const [selectedSimilarity, setSelectedSimilarity] = useState<string>('Cosine similarity');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaveMessage, setSettingsSaveMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  
  // Chat state for USE AI tab
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isSearchingWeb, setIsSearchingWeb] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  
  // Persona state for AI PERSONA section
  const [personaName, setPersonaName] = useState('');
  const [personaRole, setPersonaRole] = useState('');
  const [personaTone, setPersonaTone] = useState('friendly');
  const [personaResponseLength, setPersonaResponseLength] = useState('short');
  const [personaGuidelines, setPersonaGuidelines] = useState('');
  const [isSavingPersona, setIsSavingPersona] = useState(false);
  const [personaSaveMessage, setPersonaSaveMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  // Knowledge Base state
  const [knowledgeView, setKnowledgeView] = useState<'list' | 'text' | 'file' | 'link' | 'qna'>('list');
  const [knowledgeText, setKnowledgeText] = useState('');
  const [isSavingKnowledge, setIsSavingKnowledge] = useState(false);
  const [knowledgeSaveMessage, setKnowledgeSaveMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeItem[]>([]);
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false);
  const [editingKnowledge, setEditingKnowledge] = useState<{id: string, content: string} | null>(null);
  const [isUpdatingKnowledge, setIsUpdatingKnowledge] = useState(false);
  const [deletingKnowledgeId, setDeletingKnowledgeId] = useState<string | null>(null);
  
  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileUploadMessage, setFileUploadMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [fileKnowledgeList, setFileKnowledgeList] = useState<KnowledgeItem[]>([]);
  const [isLoadingFileKnowledge, setIsLoadingFileKnowledge] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Link KB state
  const [linkUrl, setLinkUrl] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkMessage, setLinkMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [linkKnowledgeList, setLinkKnowledgeList] = useState<KnowledgeItem[]>([]);
  const [isLoadingLinkKnowledge, setIsLoadingLinkKnowledge] = useState(false);
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);
  const [viewingLink, setViewingLink] = useState<GroupedLinkKnowledge | null>(null);

  // Rules/Actions state
  const [whenConditions, setWhenConditions] = useState<RuleCondition[]>([
    { id: '1', type: '', value: '', isDropdownOpen: false }
  ]);
  const [doActions, setDoActions] = useState<RuleAction[]>([
    { id: '1', type: '', value: '', isDropdownOpen: false, kbDropdownOpen: false }
  ]);
  const [matchType, setMatchType] = useState<'ANY' | 'ALL'>('ANY');
  const [isMatchDropdownOpen, setIsMatchDropdownOpen] = useState(false);
  const [savedRules, setSavedRules] = useState<SavedRule[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [ruleSaveMessage, setRuleSaveMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [activeRuleMenu, setActiveRuleMenu] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<SavedRule | null>(null);
  const actionsContainerRef = useRef<HTMLDivElement>(null);

  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlUserId = params?.userid as string;
  const urlProjectId = params?.projectid as string;

  useEffect(() => {
    validateGuestSession();
    // Check if we're on a sub-route and set active tab accordingly
    if (pathname?.includes('/train')) {
      setActiveTab('train');
    } else if (pathname?.includes('/use-ai') || pathname?.includes('/publish')) {
      setActiveTab('publish');
    }
  }, [urlUserId, urlProjectId, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to top when switching train sections
  useEffect(() => {
    if (contentAreaRef.current) {
      contentAreaRef.current.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [trainSection]);

  // Scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Load chat history when project loads
  useEffect(() => {
    if (selectedProject && selectedProject.type === 'custom-ai-agent' && selectedProject.agent_id && !selectedProject.stage && actualSessionId) {
      loadChatHistory(selectedProject.agent_id, actualSessionId);
    }
  }, [selectedProject, actualSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load knowledge list when entering text knowledge view
  useEffect(() => {
    if (selectedProject?.agent_id && knowledgeView === 'text' && trainSection === 'knowledge') {
      loadKnowledgeList();
    }
  }, [selectedProject?.agent_id, knowledgeView, trainSection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load rules when entering actions section
  useEffect(() => {
    if (selectedProject?.agent_id && trainSection === 'actions') {
      loadRules();
    }
  }, [selectedProject?.agent_id, trainSection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load file knowledge list when entering file view
  useEffect(() => {
    if (selectedProject?.agent_id && knowledgeView === 'file' && trainSection === 'knowledge') {
      loadFileKnowledgeList();
    }
  }, [selectedProject?.agent_id, knowledgeView, trainSection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load link knowledge list when entering link view
  useEffect(() => {
    if (selectedProject?.agent_id && knowledgeView === 'link' && trainSection === 'knowledge') {
      loadLinkKnowledgeList();
    }
  }, [selectedProject?.agent_id, knowledgeView, trainSection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Parse sources from message content (for backward compatibility with old messages)
  const parseSourcesFromContent = (content: string): { cleanContent: string; sources: WebSource[] } => {
    const sources: WebSource[] = [];
    
    // Pattern to match Sources section: ---\n**Sources:**\n or just Sources:\n
    const sourcesPatterns = [
      /\n\n---\n\*\*Sources:\*\*\n([\s\S]*?)$/,  // Markdown bold with horizontal rule
      /\n\nSources:\n([\s\S]*?)$/,               // Plain text
      /\n\n\*\*Sources:\*\*\n([\s\S]*?)$/        // Markdown bold without rule
    ];
    
    let cleanContent = content;
    
    for (const pattern of sourcesPatterns) {
      const match = content.match(pattern);
      if (match) {
        cleanContent = content.replace(pattern, '').trim();
        
        // Parse individual source links: - [title](url) or - title\n  url
        const sourceLines = match[1].split('\n').filter(line => line.trim());
        for (const line of sourceLines) {
          // Match markdown link: - [title](url)
          const mdMatch = line.match(/[-•]\s*\[([^\]]+)\]\(([^)]+)\)/);
          if (mdMatch) {
            sources.push({ title: mdMatch[1], uri: mdMatch[2] });
            continue;
          }
          // Match plain link: - domain.com or • domain.com
          const plainMatch = line.match(/[-•]\s*(\S+)/);
          if (plainMatch && (plainMatch[1].includes('.') || plainMatch[1].startsWith('http'))) {
            const uri = plainMatch[1].startsWith('http') ? plainMatch[1] : `https://${plainMatch[1]}`;
            sources.push({ title: plainMatch[1], uri });
          }
        }
        break;
      }
    }
    
    return { cleanContent, sources };
  };

  // Load chat history from API
  const loadChatHistory = async (agentId: string, sessionId: string) => {
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.chatHistory(agentId, sessionId)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.messages && data.messages.length > 0) {
          // Convert API messages to ChatMessage format
          const loadedMessages: ChatMessage[] = data.messages.map((msg: { id: string; role: string; content: string; timestamp: string }) => {
            // Parse sources from content for backward compatibility
            const { cleanContent, sources } = parseSourcesFromContent(msg.content);
            
            return {
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
              content: cleanContent,
              timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
              webSearchUsed: sources.length > 0,
              webSources: sources.length > 0 ? sources : undefined
            };
          });
          setChatMessages(loadedMessages);
        } else {
          // No history, show welcome message
          setChatMessages([{
            id: 'welcome',
            role: 'assistant',
            content: `Hello! I'm ${selectedProject?.name || 'AI Agent'}, your friendly AI Agent. How can I help you today?`,
            timestamp: new Date()
          }]);
        }
      } else {
        // API error, show welcome message
        setChatMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `Hello! I'm ${selectedProject?.name || 'AI Agent'}, your friendly AI Agent. How can I help you today?`,
          timestamp: new Date()
        }]);
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
      // On error, show welcome message
      setChatMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `Hello! I'm ${selectedProject?.name || 'AI Agent'}, your friendly AI Agent. How can I help you today?`,
        timestamp: new Date()
      }]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Clear chat history
  const clearChatHistory = async () => {
    if (!selectedProject?.agent_id || !actualSessionId) return;

    setIsClearingChat(true);
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.clearChatHistory(selectedProject.agent_id, actualSessionId)}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Reset to welcome message
        setChatMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `Hello! I'm ${selectedProject.name}, your friendly AI Agent. How can I help you today?`,
          timestamp: new Date()
        }]);
      } else {
        console.error('Failed to clear chat history');
      }
    } catch (error) {
      console.error('Error clearing chat history:', error);
    } finally {
      setIsClearingChat(false);
    }
  };

  // Load persona when project loads
  useEffect(() => {
    if (selectedProject && selectedProject.type === 'custom-ai-agent' && selectedProject.agent_id && !selectedProject.stage) {
      loadPersona(selectedProject.agent_id);
      loadSettings(selectedProject.agent_id);
    }
  }, [selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh persona when switching to persona section (ensures data is fresh after Teach Your Agent changes)
  useEffect(() => {
    if (trainSection === 'persona' && selectedProject?.agent_id && activeTab === 'train') {
      loadPersona(selectedProject.agent_id);
    }
  }, [trainSection, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load settings when switching to settings section
  useEffect(() => {
    if (trainSection === 'settings' && selectedProject?.agent_id && activeTab === 'train') {
      loadSettings(selectedProject.agent_id);
    }
  }, [trainSection, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load persona from API
  const loadPersona = async (agentId: string) => {
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.persona.get(agentId)}`);
      if (response.ok) {
        const persona = await response.json();
        setPersonaName(persona.name || '');
        setPersonaRole(persona.role || '');
        setPersonaTone(persona.tone || 'friendly');
        setPersonaResponseLength(persona.response_length || 'short');
        setPersonaGuidelines(persona.guidelines || '');
      }
    } catch (error) {
      console.error('Error loading persona:', error);
    }
  };

  // Load settings from API
  const loadSettings = async (agentId: string) => {
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.settings.get(agentId)}`);
      if (response.ok) {
        const settings = await response.json();
        setSelectedModel(settings.model || 'gemini-2.5-flash-lite');
        setSelectedEmbeddingModel(settings.embedding_model || 'text-embedding-005');
        setSelectedSimilarity(settings.similarity || 'Cosine similarity');
        console.log('✅ Settings loaded:', settings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  // Save persona to API
  // Save project settings
  const saveSettings = async () => {
    if (!selectedProject?.agent_id) {
      console.warn('Cannot save settings: No agent_id found for project');
      setSettingsSaveMessage({ type: 'error', text: 'Cannot save settings: Project not found' });
      return;
    }

    setIsSavingSettings(true);
    setSettingsSaveMessage(null);

    try {
      // Log project settings to console/terminal
      const settingsData = {
        agent_id: selectedProject.agent_id,
        project_name: selectedProject.name,
        model: selectedModel,
        embedding_model: selectedEmbeddingModel,
        similarity: selectedSimilarity,
        timestamp: new Date().toISOString()
      };
      
      console.log('=== PROJECT SETTINGS SAVE ===');
      console.log('Agent ID:', settingsData.agent_id);
      console.log('Project Name:', settingsData.project_name);
      console.log('Model:', settingsData.model);
      console.log('Embedding Model:', settingsData.embedding_model);
      console.log('Similarity:', settingsData.similarity);
      console.log('Timestamp:', settingsData.timestamp);
      console.log('Full Settings Object:', JSON.stringify(settingsData, null, 2));
      console.log('============================');
      
      // Call the actual API endpoint
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.settings.update(selectedProject.agent_id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          embedding_model: selectedEmbeddingModel,
          similarity: selectedSimilarity,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Settings saved to backend:', data);
        setSettingsSaveMessage({ type: 'success', text: 'Settings saved successfully!' });
        setTimeout(() => setSettingsSaveMessage(null), 3000);
      } else {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to save settings' }));
        throw new Error(errorData.detail || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setSettingsSaveMessage({ type: 'error', text: 'Failed to save settings. Please try again.' });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const savePersona = async () => {
    if (!selectedProject?.agent_id) return;

    setIsSavingPersona(true);
    setPersonaSaveMessage(null);

    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.persona.update(selectedProject.agent_id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: personaName,
          role: personaRole,
          tone: personaTone,
          response_length: personaResponseLength,
          guidelines: personaGuidelines,
        }),
      });

      if (response.ok) {
        setPersonaSaveMessage({ type: 'success', text: 'Persona saved successfully!' });
        // Update the project name in state if it changed
        if (selectedProject && personaName !== selectedProject.name) {
          setSelectedProject({ ...selectedProject, name: personaName });
        }
        // Clear message after 3 seconds
        setTimeout(() => setPersonaSaveMessage(null), 3000);
      } else {
        throw new Error('Failed to save persona');
      }
    } catch (error) {
      console.error('Error saving persona:', error);
      setPersonaSaveMessage({ type: 'error', text: 'Failed to save persona. Please try again.' });
    } finally {
      setIsSavingPersona(false);
    }
  };

  // Save text knowledge to API
  const saveTextKnowledge = async () => {
    if (!selectedProject?.agent_id || !actualSessionId || !knowledgeText.trim()) return;

    setIsSavingKnowledge(true);
    setKnowledgeSaveMessage(null);

    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.text}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: selectedProject.agent_id,
          session_id: actualSessionId,
          content: knowledgeText.trim(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setKnowledgeSaveMessage({ 
          type: 'success', 
          text: `Knowledge saved successfully! ${data.chunks_added || 1} chunk(s) added.` 
        });
        setKnowledgeText(''); // Clear the textarea
        // Reload the knowledge list
        loadKnowledgeList();
        // Clear message after 3 seconds
        setTimeout(() => setKnowledgeSaveMessage(null), 3000);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to save knowledge');
      }
    } catch (error) {
      console.error('Error saving knowledge:', error);
      setKnowledgeSaveMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Failed to save knowledge. Please try again.' 
      });
    } finally {
      setIsSavingKnowledge(false);
    }
  };

  // Load knowledge list from API
  const loadKnowledgeList = async () => {
    if (!selectedProject?.agent_id) return;

    setIsLoadingKnowledge(true);
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.list(selectedProject.agent_id, 'TEXT')}`);
      if (response.ok) {
        const data = await response.json();
        setKnowledgeList(data.knowledge || []);
      } else {
        console.error('Failed to load knowledge list');
      }
    } catch (error) {
      console.error('Error loading knowledge list:', error);
    } finally {
      setIsLoadingKnowledge(false);
    }
  };

  // Delete knowledge entry
  const deleteKnowledge = async (knowledgeId: string) => {
    if (!confirm('Are you sure you want to delete this knowledge entry?')) return;

    setDeletingKnowledgeId(knowledgeId);
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.delete(knowledgeId)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setKnowledgeList(prev => prev.filter(k => k.knowledge_id !== knowledgeId));
        setKnowledgeSaveMessage({ type: 'success', text: 'Knowledge deleted successfully!' });
        setTimeout(() => setKnowledgeSaveMessage(null), 3000);
      } else {
        throw new Error('Failed to delete knowledge');
      }
    } catch (error) {
      console.error('Error deleting knowledge:', error);
      setKnowledgeSaveMessage({ type: 'error', text: 'Failed to delete knowledge. Please try again.' });
    } finally {
      setDeletingKnowledgeId(null);
    }
  };

  // Update knowledge entry
  const updateKnowledge = async () => {
    if (!editingKnowledge || !editingKnowledge.content.trim()) return;

    setIsUpdatingKnowledge(true);
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.update(editingKnowledge.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: editingKnowledge.content.trim() }),
      });
      if (response.ok) {
        // Update in the list
        setKnowledgeList(prev => prev.map(k => 
          k.knowledge_id === editingKnowledge.id 
            ? { ...k, content: editingKnowledge.content.trim() }
            : k
        ));
        setEditingKnowledge(null);
        setKnowledgeSaveMessage({ type: 'success', text: 'Knowledge updated successfully!' });
        setTimeout(() => setKnowledgeSaveMessage(null), 3000);
      } else {
        throw new Error('Failed to update knowledge');
      }
    } catch (error) {
      console.error('Error updating knowledge:', error);
      setKnowledgeSaveMessage({ type: 'error', text: 'Failed to update knowledge. Please try again.' });
    } finally {
      setIsUpdatingKnowledge(false);
    }
  };

  // Load file knowledge list
  const loadFileKnowledgeList = async () => {
    if (!selectedProject?.agent_id) return;

    setIsLoadingFileKnowledge(true);
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.list(selectedProject.agent_id, 'FILE')}`);
      if (response.ok) {
        const data = await response.json();
        setFileKnowledgeList(data.knowledge || []);
      } else {
        console.error('Failed to load file knowledge list');
      }
    } catch (error) {
      console.error('Error loading file knowledge list:', error);
    } finally {
      setIsLoadingFileKnowledge(false);
    }
  };

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv', 'text/plain', 'application/csv'];
      if (!allowedTypes.includes(file.type)) {
        setFileUploadMessage({ type: 'error', text: 'Unsupported file type. Please upload PDF, Excel, CSV, or TXT files.' });
        return;
      }
      
      // Validate file size
      const maxSize = file.type === 'application/pdf' ? 2 * 1024 * 1024 : 1 * 1024 * 1024;
      if (file.size > maxSize) {
        const limitMB = maxSize / (1024 * 1024);
        setFileUploadMessage({ type: 'error', text: `File too large. Maximum size is ${limitMB}MB.` });
        return;
      }
      
      setSelectedFile(file);
      setFileUploadMessage(null);
    }
  };

  // Upload file
  const uploadFile = async () => {
    if (!selectedFile || !selectedProject?.agent_id) return;

    setIsUploadingFile(true);
    setFileUploadMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('agent_id', selectedProject.agent_id);
      if (actualSessionId) {
        formData.append('session_id', actualSessionId);
      }

      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.file}`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setFileUploadMessage({ 
          type: 'success', 
          text: `File uploaded successfully! ${data.chunks_added} chunks created from ${data.extracted_chars.toLocaleString()} characters.` 
        });
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        // Reload file knowledge list
        loadFileKnowledgeList();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to upload file');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      setFileUploadMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to upload file. Please try again.' });
    } finally {
      setIsUploadingFile(false);
    }
  };

  // Group file knowledge entries by file name
  const groupedFileKnowledge = fileKnowledgeList.reduce((acc: Record<string, GroupedFileKnowledge>, item) => {
    const fileName = (item.metadata?.file_name as string) || 'Unknown File';
    if (!acc[fileName]) {
      acc[fileName] = {
        fileName,
        fileType: item.metadata?.file_type as string,
        fileUrl: item.metadata?.file_url as string,
        fileSize: item.metadata?.file_size as number,
        totalChunks: (item.metadata?.total_chunks as number) || 1,
        chunks: [],
        content: item.content // First chunk's content as preview
      };
    }
    acc[fileName].chunks.push(item);
    return acc;
  }, {} as Record<string, GroupedFileKnowledge>);

  const groupedFileList: GroupedFileKnowledge[] = Object.values(groupedFileKnowledge);

  // Delete all chunks for a file
  const deleteFileKnowledge = async (fileName: string, chunkIds: string[]) => {
    if (!confirm(`Are you sure you want to delete "${fileName}" and all its chunks?`)) return;

    setDeletingKnowledgeId(fileName); // Use filename as tracking ID
    try {
      // Delete all chunks for this file
      const deletePromises = chunkIds.map(id => 
        fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.delete(id)}`, {
          method: 'DELETE',
        })
      );
      
      await Promise.all(deletePromises);
      
      // Remove all chunks with this filename from state
      setFileKnowledgeList(prev => prev.filter(k => k.metadata?.file_name !== fileName));
      setFileUploadMessage({ type: 'success', text: `File "${fileName}" deleted successfully!` });
      setTimeout(() => setFileUploadMessage(null), 3000);
    } catch (error) {
      console.error('Error deleting file knowledge:', error);
      setFileUploadMessage({ type: 'error', text: 'Failed to delete file. Please try again.' });
    } finally {
      setDeletingKnowledgeId(null);
    }
  };

  // View file - open file directly in new tab
  const viewFile = (knowledgeId: string) => {
    const fileUrl = `${config.apiBaseUrl}${config.api.agents.knowledge.viewFile(knowledgeId)}`;
    window.open(fileUrl, '_blank');
  };

  // ============ LINK KNOWLEDGE FUNCTIONS ============
  
  // Load link knowledge list
  const loadLinkKnowledgeList = async () => {
    if (!selectedProject?.agent_id) return;

    setIsLoadingLinkKnowledge(true);
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.list(selectedProject.agent_id, 'LINK')}`);
      if (response.ok) {
        const data = await response.json();
        setLinkKnowledgeList(data.knowledge || []);
      } else {
        console.error('Failed to load link knowledge list');
      }
    } catch (error) {
      console.error('Error loading link knowledge list:', error);
    } finally {
      setIsLoadingLinkKnowledge(false);
    }
  };

  // Group link knowledge entries by URL
  const groupedLinkKnowledge = linkKnowledgeList.reduce((acc: Record<string, GroupedLinkKnowledge>, item) => {
    const url = (item.metadata?.url as string) || 'Unknown URL';
    if (!acc[url]) {
      acc[url] = {
        url,
        pageTitle: (item.metadata?.page_title as string) || url,
        totalChunks: (item.metadata?.total_chunks as number) || 1,
        extractedChars: item.metadata?.extracted_chars as number,
        scrapeMethod: (item.metadata?.scrape_method as string) || 'unknown',
        chunks: [],
        content: item.content
      };
    }
    acc[url].chunks.push(item);
    return acc;
  }, {} as Record<string, GroupedLinkKnowledge>);

  const groupedLinkList: GroupedLinkKnowledge[] = Object.values(groupedLinkKnowledge);

  // Add link knowledge
  const addLinkKnowledge = async () => {
    if (!linkUrl.trim() || !selectedProject?.agent_id) return;

    // Basic URL validation
    try {
      new URL(linkUrl);
    } catch {
      setLinkMessage({ type: 'error', text: 'Please enter a valid URL' });
      setTimeout(() => setLinkMessage(null), 3000);
      return;
    }

    setIsAddingLink(true);
    setLinkMessage(null);

    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.link}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: selectedProject.agent_id,
          session_id: actualSessionId,
          url: linkUrl.trim()
        })
      });

      if (response.ok) {
        const data = await response.json();
        setLinkMessage({ 
          type: 'success', 
          text: `URL added successfully! ${data.chunks_added} chunks created from ${data.extracted_chars?.toLocaleString()} characters.` 
        });
        setLinkUrl('');
        loadLinkKnowledgeList();
        setTimeout(() => setLinkMessage(null), 5000);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to add link');
      }
    } catch (error) {
      console.error('Error adding link:', error);
      setLinkMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to add link. Please try again.' });
    } finally {
      setIsAddingLink(false);
    }
  };

  // Delete link knowledge (all chunks for a URL)
  const deleteLinkKnowledge = async (url: string, chunkIds: string[]) => {
    if (!confirm(`Are you sure you want to delete knowledge from "${url}"?`)) return;

    setDeletingLinkId(url);
    try {
      const deletePromises = chunkIds.map(id =>
        fetch(`${config.apiBaseUrl}${config.api.agents.knowledge.delete(id)}`, {
          method: 'DELETE',
        })
      );

      await Promise.all(deletePromises);

      setLinkKnowledgeList(prev => prev.filter(k => k.metadata?.url !== url));
      setLinkMessage({ type: 'success', text: 'Link knowledge deleted successfully!' });
      setTimeout(() => setLinkMessage(null), 3000);
    } catch (error) {
      console.error('Error deleting link knowledge:', error);
      setLinkMessage({ type: 'error', text: 'Failed to delete link. Please try again.' });
    } finally {
      setDeletingLinkId(null);
    }
  };

  // ==================== RULES/ACTIONS FUNCTIONS ====================
  
  // Load rules from backend
  const loadRules = async () => {
    if (!selectedProject?.agent_id) return;

    setIsLoadingRules(true);
    try {
      const response = await fetch(`${config.apiBaseUrl}/rules?agent_id=${selectedProject.agent_id}`);
      if (response.ok) {
        const data = await response.json();
        setSavedRules(data.data || []);
      }
    } catch (error) {
      console.error('Error loading rules:', error);
    } finally {
      setIsLoadingRules(false);
    }
  };

  // Save a new rule
  const saveRule = async () => {
    if (!selectedProject?.agent_id) return;

    // Validate - at least one complete condition and one complete action
    const validConditions = whenConditions.filter(c => {
      if (c.type === 'Conversation starts') return true;
      return c.type && c.value.trim();
    });
    const validActions = doActions.filter(a => a.type && a.value.trim());

    if (validConditions.length === 0) {
      setRuleSaveMessage({ type: 'error', text: 'Please add at least one condition' });
      setTimeout(() => setRuleSaveMessage(null), 3000);
      return;
    }
    if (validActions.length === 0) {
      setRuleSaveMessage({ type: 'error', text: 'Please add at least one action' });
      setTimeout(() => setRuleSaveMessage(null), 3000);
      return;
    }

    setIsSavingRule(true);
    setRuleSaveMessage(null);

    try {
      const response = await fetch(`${config.apiBaseUrl}/rules/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: selectedProject.agent_id,
          rule_id: editingRule?.rule_id || undefined,  // Pass rule_id for updates
          name: '',  // Auto-generate name
          conditions: validConditions.map(c => ({ type: c.type, value: c.value })),
          match_type: matchType,
          actions: validActions.map(a => ({ type: a.type, value: a.value })),
          priority: 1
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setRuleSaveMessage({ type: 'success', text: editingRule ? 'Rule updated successfully!' : 'Rule saved successfully!' });
        
        // Reset form
        setWhenConditions([{ id: '1', type: '', value: '', isDropdownOpen: false }]);
        setDoActions([{ id: '1', type: '', value: '', isDropdownOpen: false, kbDropdownOpen: false }]);
        setMatchType('ANY');
        setIsCreatingRule(false);
        setEditingRule(null);
        
        // Reload rules
        loadRules();
        
        setTimeout(() => setRuleSaveMessage(null), 3000);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to save rule');
      }
    } catch (error) {
      console.error('Error saving rule:', error);
      setRuleSaveMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save rule' });
    } finally {
      setIsSavingRule(false);
    }
  };

  // Delete a rule
  const deleteRule = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;

    setDeletingRuleId(ruleId);
    setActiveRuleMenu(null);
    try {
      const response = await fetch(`${config.apiBaseUrl}/rules/${ruleId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setSavedRules(prev => prev.filter(r => r.rule_id !== ruleId));
        setRuleSaveMessage({ type: 'success', text: 'Rule deleted successfully!' });
        setTimeout(() => setRuleSaveMessage(null), 3000);
      } else {
        throw new Error('Failed to delete rule');
      }
    } catch (error) {
      console.error('Error deleting rule:', error);
      setRuleSaveMessage({ type: 'error', text: 'Failed to delete rule' });
    } finally {
      setDeletingRuleId(null);
    }
  };

  // Clone a rule
  const cloneRule = async (rule: SavedRule) => {
    setActiveRuleMenu(null);
    try {
      const clonedConditions = rule.conditions.map((c, i) => ({
        id: `${Date.now()}-${i}`,
        type: c.type,
        value: c.value || '',
        isDropdownOpen: false
      }));
      const clonedActions = rule.actions.map((a, i) => ({
        id: `${Date.now()}-${i}`,
        type: a.type,
        value: a.value,
        isDropdownOpen: false,
        kbDropdownOpen: false
      }));

      // Save cloned rule via API
      const response = await fetch(`${config.apiBaseUrl}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: selectedProject?.agent_id,
          name: `${rule.name} (Copy)`,
          conditions: clonedConditions.map(c => ({ type: c.type, value: c.value })),
          actions: clonedActions.map(a => ({ type: a.type, value: a.value })),
          match_type: rule.match_type
        }),
      });

      if (response.ok) {
        await loadRules();
        setRuleSaveMessage({ type: 'success', text: 'Rule cloned successfully!' });
        setTimeout(() => setRuleSaveMessage(null), 3000);
      }
    } catch (error) {
      console.error('Error cloning rule:', error);
      setRuleSaveMessage({ type: 'error', text: 'Failed to clone rule' });
    }
  };

  // Edit a rule - populate form with rule data
  const editRule = (rule: SavedRule) => {
    setActiveRuleMenu(null);
    setEditingRule(rule);
    setIsCreatingRule(true);
    
    // Populate conditions
    const editConditions = rule.conditions.map((c, i) => ({
      id: `edit-${i}`,
      type: c.type,
      value: c.value || '',
      isDropdownOpen: false
    }));
    setWhenConditions(editConditions.length > 0 ? editConditions : [{ id: '1', type: '', value: '', isDropdownOpen: false }]);
    
    // Populate actions
    const editActions = rule.actions.map((a, i) => ({
      id: `edit-${i}`,
      type: a.type,
      value: a.value,
      isDropdownOpen: false,
      kbDropdownOpen: false
    }));
    setDoActions(editActions.length > 0 ? editActions : [{ id: '1', type: '', value: '', isDropdownOpen: false, kbDropdownOpen: false }]);
    
    // Set match type
    setMatchType(rule.match_type || 'ANY');
    
    // Scroll to rule editor
    setTimeout(() => {
      actionsContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  };

  // Toggle rule enabled/disabled status
  const toggleRuleStatus = async (rule: SavedRule) => {
    setActiveRuleMenu(null);
    try {
      const newStatus = !rule.active;
      const response = await fetch(`${config.apiBaseUrl}/rules/${rule.rule_id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newStatus }),
      });

      if (response.ok) {
        setSavedRules(prev => prev.map(r => 
          r.rule_id === rule.rule_id ? { ...r, active: newStatus } : r
        ));
        setRuleSaveMessage({ 
          type: 'success', 
          text: newStatus ? 'Rule enabled!' : 'Rule disabled!' 
        });
        setTimeout(() => setRuleSaveMessage(null), 3000);
      }
    } catch (error) {
      console.error('Error toggling rule status:', error);
      setRuleSaveMessage({ type: 'error', text: 'Failed to update rule status' });
    }
  };

  // WHEN condition dropdown options
  const whenConditionOptions = [
    { value: 'Conversation starts', label: 'Conversation starts', icon: <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg> },
    { value: 'User wants to', label: 'User wants to', icon: <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg> },
    { value: 'User talks about', label: 'User talks about', icon: <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg> },
    { value: 'User asks about', label: 'User asks about', icon: <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
    { value: 'User sentiment is', label: 'User sentiment is', icon: <svg className="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
    { value: 'User provides', label: 'User provides', icon: <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
    { value: 'The sentence contains', label: 'The sentence contains', icon: <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" /></svg> },
  ];

  // DO action dropdown options
  const doActionOptions = [
    { value: 'Say exact message', label: 'Say exact message', icon: <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg> },
    { value: 'Always include', label: 'Always include', icon: <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg> },
    { value: 'Always talk about', label: 'Always talk about', icon: <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg> },
    { value: 'Talk about/mention', label: 'Talk about/mention', icon: <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg> },
    { value: "Don't talk about/mention", label: "Don't talk about/mention", icon: <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg> },
    { value: 'Ask for information', label: 'Ask for information', icon: <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
    { value: 'Answer Using Knowledge Base', label: 'Answer Using Knowledge Base', icon: <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg> },
  ];

  // Click outside handler for dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsContainerRef.current && !actionsContainerRef.current.contains(event.target as Node)) {
        setWhenConditions(whenConditions.map(c => ({...c, isDropdownOpen: false})));
        setDoActions(doActions.map(a => ({...a, isDropdownOpen: false, kbDropdownOpen: false})));
        setIsMatchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [whenConditions, doActions]);

  // Click outside handler for rule action menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (activeRuleMenu && !target.closest('[data-rule-menu]')) {
        setActiveRuleMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeRuleMenu]);

  // Open original URL in new tab
  const openLinkUrl = (url: string) => {
    window.open(url, '_blank');
  };

  // Send message to chat API
  const sendChatMessage = async () => {
    if (!chatInput.trim() || isSendingMessage || !selectedProject?.agent_id) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsSendingMessage(true);

    try {
      const response = await fetch(`${config.apiBaseUrl}${config.api.agents.chat}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: selectedProject.agent_id,
          session_id: actualSessionId,
          message: userMessage.content,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();
      
      // Check if web search was used (from trace)
      const webSearchUsed = data.trace?.web_search_used || false;
      const webSources: WebSource[] = data.trace?.web_sources || [];
      const images: ImageResult[] = data.images || [];
      
      // If web search was used, show the searching indicator briefly
      if (webSearchUsed) {
        setIsSearchingWeb(true);
        await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay to show search indicator
        setIsSearchingWeb(false);
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        webSearchUsed,
        webSources,
        images
      };

      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      // Add error message
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsSendingMessage(false);
      setIsSearchingWeb(false);
    }
  };
  
  // Toggle sources expansion for a message
  const toggleSources = (messageId: string) => {
    setExpandedSources(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };
  
  // Extract clean domain name from URL (handles vertexai redirect URLs)
  const getCleanDomain = (uri: string): string => {
    // If it's a vertexai redirect URL, use the title instead
    if (uri.includes('vertexaisearch.cloud.google.com')) {
      return ''; // Will use title instead
    }
    try {
      const url = new URL(uri);
      return url.hostname.replace('www.', '');
    } catch {
      return uri;
    }
  };
  
  // Get display URL - clean version without vertexai redirect
  const getDisplayUrl = (source: WebSource): string => {
    // If it's a vertexai redirect, just show the title/domain
    if (source.uri.includes('vertexaisearch.cloud.google.com')) {
      return source.title || 'Web Source';
    }
    try {
      const url = new URL(source.uri);
      return url.hostname.replace('www.', '');
    } catch {
      return source.uri;
    }
  };
  
  // Add inline citations to content (Perplexity style)
  const addInlineCitations = (content: string, sources: WebSource[]): string => {
    // Remove any existing source section that backend might have added (for backward compatibility)
    const { cleanContent } = parseSourcesFromContent(content);
    return cleanContent;
  };
  
  // Custom link renderer for external URLs (fixes typos and opens in new tab)
  const externalLinkRenderer = ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (!href) return <span>{children}</span>;
    
    // Fix common URL typos from LLM (httpss -> https, etc.)
    const fixedHref = href
      .replace(/^httpss:\/\//i, 'https://')
      .replace(/^httpp:\/\//i, 'http://')
      .replace(/^hhtps:\/\//i, 'https://')
      .replace(/^htps:\/\//i, 'https://');
    
    // Check if it's an external link
    const isExternal = fixedHref.startsWith('http://') || fixedHref.startsWith('https://');
    
    if (isExternal) {
      return (
        <a
          href={fixedHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-brand hover:text-[#d4a5e3] underline"
        >
          {children}
        </a>
      );
    }
    
    return <a href={fixedHref}>{children}</a>;
  };

  // Render content with clickable citation badges
  const renderContentWithCitations = (content: string, sources: WebSource[]) => {
    if (!sources || sources.length === 0) {
      // No sources - just render content (citations should already be stripped by backend)
      return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: externalLinkRenderer }}>{content}</ReactMarkdown>;
    }
    
    // Split content by citation patterns like [1], [2], [1, 2], [1, 2, 3]
    const citationPattern = /\[(\d+(?:,\s*\d+)*)\]/g;
    const parts: (string | React.ReactElement)[] = [];
    let lastIndex = 0;
    let match;
    let keyIndex = 0;
    
    // Clean content first (remove backend sources section)
    const { cleanContent } = parseSourcesFromContent(content);
    
    while ((match = citationPattern.exec(cleanContent)) !== null) {
      // Add text before citation
      if (match.index > lastIndex) {
        parts.push(cleanContent.slice(lastIndex, match.index));
      }
      
      // Parse citation numbers (handles [1], [1, 2], [1, 2, 3])
      const citationNums = match[1].split(',').map(n => parseInt(n.trim()));
      
      // Create clickable citation badges
      const badges = citationNums.map((num, idx) => {
        // Gemini uses 1-based indexing, but may use arbitrary numbers
        // Map to our sources array (0-indexed, capped at sources.length)
        const sourceIndex = Math.min(num - 1, sources.length - 1);
        const source = sources[Math.max(0, sourceIndex)];
        
        if (source) {
          return (
            <a
              key={`citation-${keyIndex}-${idx}`}
              href={source.uri}
              target="_blank"
              rel="noopener noreferrer"
              title={source.title || getDisplayUrl(source)}
              className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 mx-0.5 text-[10px] font-bold bg-purple-brand/30 text-purple-brand rounded hover:bg-purple-brand hover:text-white transition-all cursor-pointer align-super"
            >
              {sourceIndex + 1}
            </a>
          );
        }
        return null;
      }).filter(Boolean);
      
      if (badges.length > 0) {
        parts.push(<span key={`badges-${keyIndex}`} className="inline">{badges}</span>);
      }
      
      lastIndex = match.index + match[0].length;
      keyIndex++;
    }
    
    // Add remaining text
    if (lastIndex < cleanContent.length) {
      parts.push(cleanContent.slice(lastIndex));
    }

    // Render with mixed content (text + badges)
    return (
      <div className="citation-content">
        {parts.map((part, index) => 
          typeof part === 'string' ? (
            <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} components={{
              p: ({children}) => <span>{children} </span>, // Inline rendering
              a: externalLinkRenderer
            }}>{part}</ReactMarkdown>
          ) : part
        )}
      </div>
    );
  };

  // Handle Enter key press in chat input
  const handleChatKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  const validateGuestSession = async () => {
    if (!urlUserId || !urlProjectId) {
      setIsLoading(false);
      return;
    }

    try {
      let sessionId: string;
      let projectId: string;

      // Check if URL param is a masked ID or full session ID
      if (isMaskedId(urlUserId)) {
        const realSessionId = getSessionIdFromMaskedId(urlUserId);
        if (!realSessionId) {
          window.location.href = '/projects';
          return;
        }
        sessionId = realSessionId;
      } else if (isSessionId(urlUserId)) {
        const maskedId = getOrCreateMaskedId(urlUserId);
        window.location.href = `/projects/${maskedId}/${urlProjectId}`;
        return;
      } else {
        window.location.href = '/projects';
        return;
      }

      // Check if project ID is masked
      if (isMaskedProjectId(urlProjectId)) {
        const realProjectId = getProjectIdFromMaskedId(urlProjectId);
        if (!realProjectId) {
          window.location.href = `/projects/${urlUserId}`;
          return;
        }
        projectId = realProjectId;
      } else if (isProjectId(urlProjectId)) {
        projectId = urlProjectId;
      } else {
        window.location.href = `/projects/${urlUserId}`;
        return;
      }

      // Check if session exists in localStorage
      const storedSessionId = localStorage.getItem('yaaralabs_playground_session_id');
      
      if (!storedSessionId) {
        window.location.href = '/projects';
        return;
      }

      if (storedSessionId !== sessionId) {
        const correctMaskedId = getOrCreateMaskedId(storedSessionId);
        window.location.href = `/projects/${correctMaskedId}`;
        return;
      }

      // Validate session with backend API
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.sessionById(sessionId)}`);
      
      if (response.ok) {
        const sessionResponse: GuestSessionResponse = await response.json();
        if (sessionResponse.success && sessionResponse.data.active) {
          const now = new Date();
          const expiresAt = new Date(sessionResponse.data.expiresAt);
          
          if (now < expiresAt) {
            setActualSessionId(sessionId);
            setActualProjectId(projectId);
            setGuestSession(sessionResponse.data);
            setIsValidSession(true);
            
            // Load project after setting session as valid
            await loadProject(sessionId, projectId);
          } else {
            console.error('Session expired');
                        await cleanupSessionWithReason(SessionCleanupReason.EXPIRED_BACKEND);
            window.location.href = '/projects';
            return;
          }
        } else {
          console.error('Session inactive');
                      await cleanupSessionWithReason(SessionCleanupReason.INACTIVE_BACKEND);
          window.location.href = '/projects';
          return;
        }
      } else {
        console.error('Session validation failed:', response.status);
                    await cleanupSessionWithReason(SessionCleanupReason.NOT_FOUND_BACKEND);
        window.location.href = '/projects';
        return;
      }
    } catch (error) {
      console.error('Error validating session:', error);
                  await cleanupSessionWithReason(SessionCleanupReason.EXPIRED_BACKEND);
      window.location.href = '/projects';
      return;
    }
    setIsLoading(false);
  };

  const loadProject = async (sessionId: string, projectId: string) => {
    try {
      console.log('Loading project:', projectId, 'for session:', sessionId);
      
      // Load both projects and agents for the session
      const [projectsResponse, agentsResponse] = await Promise.all([
        fetch(`${config.apiBaseUrl}/api/guests/session/${sessionId}/projects`),
        fetch(`${config.apiBaseUrl}${config.api.agents.list(sessionId)}`).catch(() => null) // Optional, don't fail if endpoint doesn't exist
      ]);
      
      const allProjects: Project[] = [];
      
      // Load regular projects
      if (projectsResponse.ok) {
        const projectsData = await projectsResponse.json();
        if (projectsData.success && projectsData.data) {
          allProjects.push(...projectsData.data);
        }
      }
      
      // Load agents (if endpoint exists)
      if (agentsResponse && agentsResponse.ok) {
        const agentsData = await agentsResponse.json();
        if (agentsData && Array.isArray(agentsData) && agentsData.length > 0) {
          const agentsAsProjects = agentsData.map((agent: Agent) => ({
            id: agent.agent_id,
            name: agent.project_name || agent.name,
            // Day 2 stages show as their exercise's type; legacy agents (no stage) stay Custom AI Agents
            type: stageToType(agent.stage),
            description: agent.description,
            status: agent.active ? 'draft' : 'failed',
            createdAt: agent.created_at,
            updatedAt: agent.updated_at,
            agent_id: agent.agent_id,
            stage: isStage(agent.stage) ? agent.stage : null,
            copied_from: agent.copied_from || null,
          } as Project));
          allProjects.push(...agentsAsProjects);
        }
      }
      
      console.log('Available projects:', allProjects.map((p: Project) => ({ id: p.id, name: p.name, type: p.type })));
          
          // Find the specific project by ID
      const project = allProjects.find((p: Project) => p.id === projectId);
          
          if (project) {
            console.log('Found project:', project);
            setSelectedProject(project);
          } else {
            // Project not found in the session's projects
            console.error('Project not found in session projects. Looking for:', projectId);
        console.error('Available project IDs:', allProjects.map((p: Project) => p.id));
        window.location.href = `/projects/${urlUserId}`;
        return;
      }
    } catch (error) {
      console.error('Error loading session projects:', error);
      window.location.href = `/projects/${urlUserId}`;
      return;
    }
  };



  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas text-fg">
        <Header />
        <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-fg text-xl">Loading...</div>
          </div>
        </main>
      </div>
    );
  }

  if (!isValidSession) {
    return (
      <div className="min-h-screen bg-canvas text-fg">
        <Header />
        <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-3xl md:text-4xl font-semibold text-fg mb-4">
              Session Expired
            </h1>
            <p className="text-lg text-fg mb-8">
              Your session has expired. Please start a new session.
            </p>
            <Link 
              href="/projects"
              className="bg-purple-brand text-white px-8 py-4 rounded-lg text-lg font-medium hover:scale-105 transition-all duration-300 inline-block"
            >
              Start New Session
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (!selectedProject) {
    return (
      <div className="min-h-screen bg-canvas text-fg">
        <Header />
        <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-3xl md:text-4xl font-semibold text-fg mb-4">
              Project Not Found
            </h1>
            <p className="text-lg text-fg mb-8">
              The project you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
            </p>
            <Link 
              href={`/projects/${urlUserId}`}
              className="bg-purple-brand text-white px-8 py-4 rounded-lg text-lg font-medium hover:scale-105 transition-all duration-300 inline-block"
            >
              Back to Projects
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const isRbp = selectedProject.type === 'rule-based-process';
  const isExercises = selectedProject.type === 'exercises';
  const isConfusionMatrix = selectedProject.type === 'confusion-matrix';
  // Day 2 Agent Studio: agents with a stage. Guest projects of type rag-chatbot / ai-agent keep their old Labs.
  const isAgentStudio = Boolean(selectedProject.agent_id && selectedProject.stage);
  const isRagChatbot = selectedProject.type === 'rag-chatbot' && !selectedProject.agent_id;
  const isAiAgent = selectedProject.type === 'ai-agent' && !selectedProject.agent_id;
  // 'live-video-classification' is the name this type had briefly; those projects open the same way
  const isLiveObjectDetection = selectedProject.type === 'live-object-detection' || selectedProject.type === 'live-video-classification';
  const studioHeader = isRbp || isExercises || isConfusionMatrix || isRagChatbot || isAiAgent || isLiveObjectDetection;
  // These have their own back button in their header row (like "Use the AI"), so no back bar here
  const ownBackButton = (isRbp && resolveRbpEditor(selectedProject.rbpEditor) === 'blocks') || isLiveObjectDetection;

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-canvas text-fg">
      {/* Same header as the projects list; studio pages get their back link in a bar below it */}
      <Header
        {...(studioHeader
          ? {
              fixed: false,
              showMobileMenu: false,
              className: 'flex-shrink-0',
            }
          : {})}
      />

      {studioHeader && !ownBackButton && (
        <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 py-2.5 border-b border-fg/10 bg-canvas">
          {isExercises && exerciseOpen ? (
            <button
              type="button"
              onClick={() => exerciseBackRef.current?.()}
              className="inline-flex items-center gap-2 text-pink-brand hover:text-fg transition-colors whitespace-nowrap text-sm font-semibold"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>{exerciseBackLabel}</span>
            </button>
          ) : (
            <Link
              href={`/projects/${urlUserId}`}
              className="inline-flex items-center gap-2 text-fg/70 hover:text-fg transition-colors whitespace-nowrap text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to Projects</span>
            </Link>
          )}
        </div>
      )}

      <main
        className={`flex-1 overflow-hidden min-h-0 ${
          studioHeader ? 'pt-0' : 'pt-20'
        }`}
      >
          {isAgentStudio && selectedProject.agent_id && selectedProject.stage ? (
            <AgentStudio
              agentId={selectedProject.agent_id}
              sessionId={actualSessionId}
              stage={selectedProject.stage}
              projectName={selectedProject.name}
              copiedFrom={selectedProject.copied_from || null}
              backHref={`/projects/${urlUserId}`}
            />
          ) : /* Tabbed Interface for legacy Custom AI Agents (no stage) */
          selectedProject.type === 'custom-ai-agent' ? (
            <div className="h-full flex flex-col min-h-0">
              {/* Top Navigation Bar with Back Button and Tabs */}
              <div className="bg-canvas py-4 flex-shrink-0 border-b border-magenta-brand/20">
                <div className="px-6 flex items-center justify-between relative">
                  <Link
                    href={`/projects/${urlUserId}`}
                    className="inline-flex items-center gap-2 text-fg/70 hover:text-fg transition-colors"
                  >
                    <svg 
                      className="w-5 h-5" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M15 19l-7-7 7-7" 
                      />
                    </svg>
                    <span>Back to Projects</span>
              </Link>
                  
                  <div className="flex items-center gap-2 absolute left-1/2 transform -translate-x-1/2 bg-canvas rounded-lg p-1 border border-magenta-brand/10">
                    <button
                      onClick={() => {
                        setActiveTab('train');
                        setTrainSection('settings');
                      }}
                      className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-md ${
                        activeTab === 'train'
                          ? 'bg-purple-brand text-white shadow-lg shadow-purple-brand/20'
                          : 'text-fg/70 hover:text-fg hover:bg-raised'
                      }`}
                    >
                      TRAIN
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('publish');
                      }}
                      className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-md ${
                        activeTab === 'publish'
                          ? 'bg-purple-brand text-white shadow-lg shadow-purple-brand/20'
                          : 'text-fg/70 hover:text-fg hover:bg-raised'
                      }`}
                    >
                      USE AI
                    </button>
                  </div>

                </div>
              </div>

                {activeTab === 'publish' ? (
                <div className="px-6 flex-1 overflow-hidden py-4">
                  {/* Chat Interface for USE AI tab */}
                  <div className="h-full flex flex-col">
                    {/* Chatbot Container */}
                    <div className="flex-1 border-2 border-magenta-brand/30 rounded-xl bg-canvas overflow-hidden flex flex-col min-h-0">
                      {/* Chatbot Header */}
                      <div className="flex items-center justify-between p-6 border-b border-magenta-brand/20 bg-gradient-to-r from-purple-brand/10 to-transparent">
                        <div className="flex items-center gap-4">
                          <div className="w-14 h-14 rounded-full bg-purple-brand flex items-center justify-center text-white font-bold text-xl shadow-lg">
                            {selectedProject.name.charAt(0)}
                          </div>
                          <div>
                            <h4 className="font-bold text-xl text-fg">{selectedProject.name}</h4>
                            <p className="text-sm text-fg/60">AI Agent • Online</p>
                          </div>
                        </div>
                        <button
                          onClick={clearChatHistory}
                          disabled={isClearingChat}
                          className="flex items-center gap-2 px-4 py-2 bg-card border border-magenta-brand/20 text-fg rounded-lg hover:bg-raised transition-colors disabled:opacity-50"
                          title="Clear chat history"
                        >
                          {isClearingChat ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          )}
                          <span className="text-sm">Reset Chat</span>
                        </button>
                      </div>

                      {/* Chat Messages */}
                      <div ref={chatMessagesRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-canvas dark-scrollbar">
                        {isLoadingHistory ? (
                          <div className="flex items-center justify-center h-full">
                            <div className="flex flex-col items-center gap-3">
                              <svg className="w-8 h-8 animate-spin text-purple-brand" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <p className="text-fg/60 text-sm">Loading chat history...</p>
                            </div>
                          </div>
                        ) : chatMessages.map((message) => (
                          message.role === 'assistant' ? (
                            <div key={message.id} className="flex gap-3">
                              <div className="w-10 h-10 rounded-full bg-purple-brand flex-shrink-0 flex items-center justify-center text-white font-semibold text-sm">
                                {selectedProject.name.charAt(0)}
                              </div>
                              <div className="bg-card rounded-2xl rounded-tl-sm p-4 max-w-[80%] border border-magenta-brand/10">
                                {/* Web Search Badge */}
                                {message.webSearchUsed && message.webSources && message.webSources.length > 0 && (
                                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-magenta-brand/20">
                                    <svg className="w-4 h-4 text-purple-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    <span className="text-xs text-purple-brand font-medium">Searched from web</span>
                                    <div className="flex gap-1">
                                      {message.webSources.slice(0, 3).map((source, idx) => (
                                        <a
                                          key={idx}
                                          href={source.uri}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title={source.title || getDisplayUrl(source)}
                                          className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-purple-brand/20 text-purple-brand rounded-full hover:bg-purple-brand hover:text-white transition-all cursor-pointer"
                                        >
                                          {idx + 1}
                                        </a>
                                      ))}
                                      {message.webSources.length > 3 && (
                                        <span className="text-xs text-fg/60">+{message.webSources.length - 3}</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                                
                                {/* Message Content with Clickable Citations */}
                                <div className="markdown-content">
                                  {message.webSources && message.webSources.length > 0 
                                    ? renderContentWithCitations(message.content, message.webSources)
                                    : <ReactMarkdown remarkPlugins={[remarkGfm]}>{addInlineCitations(message.content, [])}</ReactMarkdown>
                                  }
                                </div>
                                
                                {/* Image Gallery */}
                                {message.images && message.images.length > 0 && (
                                  <div className="mt-4 pt-3 border-t border-magenta-brand/20">
                                    <div className="flex items-center gap-2 mb-3">
                                      <svg className="w-4 h-4 text-purple-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                      <span className="text-xs text-purple-brand font-medium">Related Images</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                      {message.images.map((img, idx) => (
                                        <a
                                          key={idx}
                                          href={img.context_url || img.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title={`View on ${img.source}`}
                                          className="group relative aspect-[4/3] rounded-xl overflow-hidden bg-canvas border border-magenta-brand/20 hover:border-magenta-brand hover:shadow-lg hover:shadow-purple-brand/20 transition-all"
                                        >
                                          <img
                                            src={img.url}
                                            alt={img.title}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                            loading="lazy"
                                            onError={(e) => {
                                              // Fallback to thumbnail if main image fails
                                              const target = e.target as HTMLImageElement;
                                              if (img.thumbnail && target.src !== img.thumbnail) {
                                                target.src = img.thumbnail;
                                              } else {
                                                target.style.display = 'none';
                                              }
                                            }}
                                          />
                                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                            <div className="absolute bottom-0 left-0 right-0 p-3">
                                              <p className="text-xs text-fg font-medium line-clamp-2">{img.title}</p>
                                              <p className="text-[10px] text-fg/80 mt-1 flex items-center gap-1">
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                </svg>
                                                {img.source}
                                              </p>
                                            </div>
                                          </div>
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                
                                {/* Sources Section (Perplexity Style) */}
                                {message.webSearchUsed && message.webSources && message.webSources.length > 0 && (
                                  <div className="mt-4 pt-3 border-t border-magenta-brand/20">
                                    <button
                                      onClick={() => toggleSources(message.id)}
                                      className="flex items-center gap-2 text-sm text-purple-brand hover:text-[#d896e8] transition-colors"
                                    >
                                      <svg className={`w-4 h-4 transition-transform ${expandedSources.has(message.id) ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                      <span className="font-medium">Sources ({message.webSources.length})</span>
                                    </button>
                                    
                                    {expandedSources.has(message.id) && (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {message.webSources.map((source, idx) => (
                                          <a
                                            key={idx}
                                            href={source.uri}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-canvas border border-magenta-brand/30 rounded-full hover:bg-purple-brand/20 hover:border-magenta-brand transition-all group"
                                          >
                                            <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-purple-brand text-white rounded-full">
                                              {idx + 1}
                                            </span>
                                            <span className="text-sm text-fg/80 group-hover:text-fg max-w-[150px] truncate">
                                              {source.title || getDisplayUrl(source)}
                                            </span>
                                            <svg className="w-3 h-3 text-fg/50 group-hover:text-purple-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div key={message.id} className="flex gap-3 justify-end">
                              <div className="bg-purple-brand text-white rounded-2xl rounded-tr-sm p-4 max-w-[70%]">
                                <p className="whitespace-pre-wrap">{message.content}</p>
                              </div>
                            </div>
                          )
                        ))}
                        {!isLoadingHistory && isSendingMessage && (
                          <div className="flex gap-3">
                            <div className="w-10 h-10 rounded-full bg-purple-brand flex-shrink-0 flex items-center justify-center text-white font-semibold text-sm">
                              {selectedProject.name.charAt(0)}
                            </div>
                            <div className="bg-card rounded-2xl rounded-tl-sm p-4 border border-magenta-brand/10">
                              {isSearchingWeb ? (
                                <div className="flex items-center gap-3">
                                  <svg className="w-5 h-5 text-purple-brand animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  <span className="text-purple-brand text-sm font-medium">Searching from resources...</span>
                                </div>
                              ) : (
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-purple-brand rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 bg-purple-brand rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 bg-purple-brand rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                              </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Input Area */}
                      <div className="p-4 border-t border-magenta-brand/20 bg-canvas">
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyPress={handleChatKeyPress}
                            placeholder="Type your message..."
                            disabled={isSendingMessage}
                            className="flex-1 px-5 py-4 bg-card border border-magenta-brand/20 rounded-xl text-fg placeholder-fg/40 focus:outline-none focus:ring-2 focus:ring-pink-brand text-base disabled:opacity-50"
                          />
                          <button 
                            onClick={sendChatMessage}
                            disabled={isSendingMessage || !chatInput.trim()}
                            className="w-12 h-12 rounded-xl bg-purple-brand flex items-center justify-center hover:bg-[#a855c7] transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSendingMessage ? (
                              <svg className="w-6 h-6 text-fg animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            ) : (
                              <svg className="w-6 h-6 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                              </svg>
                            )}
                          </button>
                        </div>
                       
                      </div>
                    </div>
                  </div>
                </div>
                ) : (
                <div className="flex-1 overflow-hidden">
                  <div className="flex h-full gap-0">
                    {/* Left Sidebar - Only for TRAIN tab */}
                    {sidebarOpen && activeTab === 'train' && (
                      <div className="w-80 flex-shrink-0 bg-canvas border-r border-magenta-brand/20 p-6 overflow-y-auto dark-scrollbar">
                    <div className="mb-6 pb-4 border-b border-magenta-brand/20">
                      <h3 className="text-lg font-semibold text-fg/60">TRAIN</h3>
                    </div>

                    {activeTab === 'train' ? (
                      /* TRAIN Tab - Training Sections */
                      <div className="space-y-2">
                        <button
                          onClick={() => setTrainSection('settings')}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                            trainSection === 'settings'
                              ? 'bg-purple-brand/20 text-white'
                              : 'text-fg/60 hover:bg-raised/30 hover:text-fg'
                          }`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <div className="flex-1 text-left">
                            <div className="font-medium text-sm">PROJECT SETTINGS</div>
                            <div className="text-xs text-fg/50">Manage project configuration</div>
                          </div>
                        </button>

                        <button
                          onClick={() => setTrainSection('persona')}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                            trainSection === 'persona'
                              ? 'bg-purple-brand/20 text-white'
                              : 'text-fg/60 hover:bg-raised/30 hover:text-fg'
                          }`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <div className="flex-1 text-left">
                            <div className="font-medium text-sm">AI PERSONA</div>
                            <div className="text-xs text-fg/50">How the Agent talks and acts</div>
                          </div>
                        </button>

                        <button
                          onClick={() => {
                            setTrainSection('knowledge');
                            setKnowledgeView('list');
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                            trainSection === 'knowledge'
                              ? 'bg-purple-brand/20 text-white'
                              : 'text-fg/60 hover:bg-raised/30 hover:text-fg'
                          }`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <div className="flex-1 text-left">
                            <div className="font-medium text-sm">KNOWLEDGE BASE</div>
                            <div className="text-xs text-fg/50">Train Agent for context aware replies</div>
                          </div>
                        </button>

                        <button
                          onClick={() => setTrainSection('actions')}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                            trainSection === 'actions'
                              ? 'bg-purple-brand/20 text-white'
                              : 'text-fg/60 hover:bg-raised/30 hover:text-fg'
                          }`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                          </svg>
                          <div className="flex-1 text-left">
                            <div className="font-medium text-sm">ACTIONS</div>
                            <div className="text-xs text-fg/50">Set conditions for replies and tasks</div>
                          </div>
                        </button>

                        <button
                          onClick={() => setTrainSection('teach')}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                            trainSection === 'teach'
                              ? 'bg-purple-brand/20 text-white'
                              : 'text-fg/60 hover:bg-raised/30 hover:text-fg'
                          }`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          <div className="flex-1 text-left">
                            <div className="font-medium text-sm">TEACH YOUR AGENT</div>
                            <div className="text-xs text-fg/50">Train your Agent with chat</div>
                          </div>
                        </button>
                      </div>
                    ) : null}
                      </div>
                    )}

                    {/* Main Content Area */}
                    <div ref={contentAreaRef} className="flex-1 min-w-0 overflow-y-auto relative bg-canvas dark-scrollbar">
                      <div className="py-8 px-6">
                        {trainSection === 'settings' ? (
                          /* PROJECT SETTINGS Section */
                          <div>
                            <div className="mb-6">
                              <h2 className="text-2xl font-bold text-fg mb-2">PROJECT SETTINGS</h2>
                              <p className="text-sm text-fg/60">Manage your project configuration and preferences</p>
                            </div>

                            <div className="space-y-6">
                              {/* Model Selection */}
                              <div className="bg-canvas border border-magenta-brand/20 rounded-xl p-6">
                                <h3 className="text-lg font-semibold text-fg mb-4">Model Configuration</h3>
                                <div className="space-y-4">
                                  <div>
                                    <label className="block text-sm font-medium text-fg/80 mb-2">Model</label>
                                    <select
                                      value={selectedModel}
                                      onChange={(e) => setSelectedModel(e.target.value)}
                                      className="w-full px-4 py-3 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent"
                                    >
                                      <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                                      <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-sm font-medium text-fg/80 mb-2">Embedding Model</label>
                                    <select
                                      value={selectedEmbeddingModel}
                                      onChange={(e) => setSelectedEmbeddingModel(e.target.value)}
                                      className="w-full px-4 py-3 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent"
                                    >
                                      <option value="text-embedding-005">text-embedding-005</option>
                                      <option value="gemini-embedding-001">gemini-embedding-001</option>
                                      <option value="text-multilingual-embedding-002">text-multilingual-embedding-002</option>
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-sm font-medium text-fg/80 mb-2">Similarity</label>
                                    <select
                                      value={selectedSimilarity}
                                      onChange={(e) => setSelectedSimilarity(e.target.value)}
                                      className="w-full px-4 py-3 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent"
                                    >
                                      <option value="Cosine similarity">Cosine similarity</option>
                                      <option value="Euclidean Distance">Euclidean Distance</option>
                                      <option value="Jaccard Similarity">Jaccard Similarity</option>
                                    </select>
                                  </div>
                                </div>
                              </div>

                              {/* Save Button */}
                              <div className="mt-6 flex justify-end">
                                <button
                                  onClick={saveSettings}
                                  disabled={isSavingSettings}
                                  className="px-6 py-2.5 bg-purple-brand text-white rounded-lg font-medium hover:bg-[#a855c7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                  {isSavingSettings ? (
                                    <>
                                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                      <span>Saving...</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span>Save Settings</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              
                              {/* Success/Error Message */}
                              {settingsSaveMessage && (
                                <div className={`mt-4 px-4 py-3 rounded-lg ${
                                  settingsSaveMessage.type === 'success' 
                                    ? 'bg-green-500/20 border border-green-500/50 text-green-400' 
                                    : 'bg-red-500/20 border border-red-500/50 text-red-400'
                                }`}>
                                  {settingsSaveMessage.text}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : trainSection === 'persona' ? (
                          /* AI PERSONA Section */
                          <div>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <svg className="w-6 h-6 text-purple-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              <div>
                                <h2 className="text-2xl font-bold text-fg">AI PERSONA</h2>
                                <p className="text-sm text-fg/60">Write and customize how the AI talks and acts</p>
                              </div>
                            </div>
                            <button
                              onClick={savePersona}
                              disabled={isSavingPersona}
                              className="px-6 py-2.5 bg-purple-brand text-white rounded-lg font-medium hover:bg-[#a855c7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                              {isSavingPersona ? (
                                <>
                                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  Saving...
                                </>
                              ) : (
                                'Save Persona'
                              )}
                            </button>
                          </div>

                          {/* Save Message */}
                          {personaSaveMessage && (
                            <div className={`mb-4 px-4 py-3 rounded-lg ${personaSaveMessage.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                              {personaSaveMessage.text}
                            </div>
                          )}

                          <div className="space-y-6">
                            {/* Agent Name */}
                            <div>
                              <label className="block text-sm font-semibold text-fg mb-2">Agent Name</label>
                              <p className="text-sm text-fg/60 mb-3">Give a name to your Agent that will be displayed in the conversation</p>
                              <input
                                type="text"
                                value={personaName}
                                onChange={(e) => setPersonaName(e.target.value)}
                                className="w-full px-4 py-3 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent"
                                placeholder="Ella"
                              />
                            </div>

                            {/* Agent Role */}
                            <div>
                              <label className="block text-sm font-semibold text-fg mb-2">Agent Role</label>
                              <p className="text-sm text-fg/60 mb-3">Describe your Agent&apos;s job title</p>
                              <input
                                type="text"
                                value={personaRole}
                                onChange={(e) => setPersonaRole(e.target.value)}
                                className="w-full px-4 py-3 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent"
                                placeholder="Patient Coordinator"
                              />
                            </div>

                            {/* Tone of Voice */}
                            <div>
                              <label className="block text-sm font-semibold text-fg mb-2">Tone of Voice</label>
                              <p className="text-sm text-fg/60 mb-3">Select how you would like the AI to communicate</p>
                              <div className="flex gap-3">
                                <button 
                                  onClick={() => setPersonaTone('friendly')}
                                  className={`px-4 py-3 rounded-lg text-center transition-all ${personaTone === 'friendly' ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
                                >
                                  <span className="text-2xl mb-2 block">😊</span>
                                  <span className="text-sm font-medium text-fg">Friendly</span>
                                </button>
                                <button 
                                  onClick={() => setPersonaTone('professional')}
                                  className={`px-4 py-3 rounded-lg text-center transition-all ${personaTone === 'professional' ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
                                >
                                  <span className="text-2xl mb-2 block">😐</span>
                                  <span className="text-sm font-medium text-fg">Professional</span>
                                </button>
                                <button 
                                  onClick={() => setPersonaTone('casual')}
                                  className={`px-4 py-3 rounded-lg text-center transition-all ${personaTone === 'casual' ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
                                >
                                  <span className="text-2xl mb-2 block">🤝</span>
                                  <span className="text-sm font-medium text-fg">Casual</span>
                                </button>
                              </div>
                            </div>

                            {/* Chat Response Length */}
                            <div>
                              <label className="block text-sm font-semibold text-fg mb-2">Chat Response Length</label>
                              <div className="flex gap-3">
                                <button 
                                  onClick={() => setPersonaResponseLength('minimal')}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium text-fg transition-all ${personaResponseLength === 'minimal' ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
                                >
                                  Minimal
                                </button>
                                <button 
                                  onClick={() => setPersonaResponseLength('short')}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium text-fg transition-all ${personaResponseLength === 'short' ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
                                >
                                  Short
                                </button>
                                <button 
                                  onClick={() => setPersonaResponseLength('long')}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium text-fg transition-all ${personaResponseLength === 'long' ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
                                >
                                  Long
                                </button>
                                <button 
                                  onClick={() => setPersonaResponseLength('chatty')}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium text-fg transition-all ${personaResponseLength === 'chatty' ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
                                >
                                  Chatty
                                </button>
                              </div>
                            </div>

                            {/* Chat Guidelines */}
                            <div>
                              <label className="block text-sm font-semibold text-fg mb-2">Chat Guidelines</label>
                              <p className="text-sm text-fg/60 mb-3">Set clear rules for how your agent should respond in chat channels</p>
                              <div className="space-y-2">
                                {personaGuidelines.split('\n').filter(g => g.trim()).map((guideline, index) => (
                                  <div key={index} className="flex items-center gap-2 group">
                                    <input
                                      type="text"
                                      value={guideline}
                                      onChange={(e) => {
                                        const guidelines = personaGuidelines.split('\n').filter(g => g.trim());
                                        guidelines[index] = e.target.value;
                                        setPersonaGuidelines(guidelines.join('\n'));
                                      }}
                                      className="flex-1 px-4 py-3 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent"
                                    />
                                    <button
                                      onClick={() => {
                                        const guidelines = personaGuidelines.split('\n').filter(g => g.trim());
                                        guidelines.splice(index, 1);
                                        setPersonaGuidelines(guidelines.join('\n'));
                                      }}
                                      className="p-2 text-fg/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Delete guideline"
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                            </div>
                                ))}
                                {/* Add new guideline input */}
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    placeholder="Add a new guideline..."
                                    className="flex-1 px-4 py-3 bg-[#1a1a1a] border border-dashed border-magenta-brand/30 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent placeholder-fg/50"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                        const newGuideline = e.currentTarget.value.trim();
                                        setPersonaGuidelines(prev => 
                                          prev.trim() ? `${prev}\n${newGuideline}` : newGuideline
                                        );
                                        e.currentTarget.value = '';
                                      }
                                    }}
                                  />
                                </div>
                                {/* Add new button */}
                                <button
                                  onClick={() => {
                                    const input = document.querySelector('input[placeholder="Add a new guideline..."]') as HTMLInputElement;
                                    if (input && input.value.trim()) {
                                      setPersonaGuidelines(prev => 
                                        prev.trim() ? `${prev}\n${input.value.trim()}` : input.value.trim()
                                      );
                                      input.value = '';
                                    }
                                  }}
                                  className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  Add new
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : trainSection === 'knowledge' ? (
                        /* KNOWLEDGE BASE Section */
                        <div>
                          {knowledgeView === 'list' ? (
                            <>
                              <div className="mb-6">
                                <h2 className="text-2xl font-bold text-fg mb-2">KNOWLEDGE BASE</h2>
                                <p className="text-sm text-fg/60">Train your Agent for context-aware responses to ensure accurate replies</p>
                              </div>

                              {/* Knowledge Cards */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <button 
                                  onClick={() => setKnowledgeView('text')}
                                  className="bg-green-500/10 border-2 border-green-500/30 rounded-lg p-6 text-left hover:border-green-500/50 hover:bg-green-500/15 transition-all group"
                                >
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="w-12 h-12 bg-green-500 rounded-lg flex items-center justify-center">
                                      <svg className="w-6 h-6 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                      </svg>
                                    </div>
                                    <svg className="w-5 h-5 text-fg/60 group-hover:text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                  </div>
                                  <h3 className="font-semibold text-fg mb-2">KNOWLEDGE</h3>
                                  <p className="text-sm text-fg/60">Add text-based information to train your Agent</p>
                                </button>

                                <button 
                                  onClick={() => setKnowledgeView('file')}
                                  className="bg-blue-500/10 border-2 border-blue-500/30 rounded-lg p-6 text-left hover:border-blue-500/50 hover:bg-blue-500/15 transition-all group"
                                >
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center">
                                      <svg className="w-6 h-6 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                      </svg>
                                    </div>
                                    <svg className="w-5 h-5 text-fg/60 group-hover:text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                  </div>
                                  <h3 className="font-semibold text-fg mb-2">FILE</h3>
                                  <p className="text-sm text-fg/60">Upload PDF, Excel, CSV or Text files</p>
                                </button>

                                <button 
                                  onClick={() => setKnowledgeView('link')}
                                  className="bg-orange-500/10 border-2 border-orange-500/30 rounded-lg p-6 text-left hover:border-orange-500/50 hover:bg-orange-500/15 transition-all group"
                                >
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="w-12 h-12 bg-orange-500 rounded-lg flex items-center justify-center">
                                      <svg className="w-6 h-6 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                      </svg>
                                    </div>
                                    <svg className="w-5 h-5 text-fg/60 group-hover:text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                  </div>
                                  <h3 className="font-semibold text-fg mb-2">LINK</h3>
                                  <p className="text-sm text-fg/60">Scrape website content to train your Agent</p>
                                </button>
                              </div>
                            </>
                          ) : knowledgeView === 'text' ? (
                            /* TEXT KNOWLEDGE INPUT VIEW */
                            <div className="flex gap-6">
                              {/* Left side - Input Form */}
                              <div className="flex-1">
                                {/* Header with back button */}
                                <div className="flex items-center gap-4 mb-6">
                                  <button 
                                    onClick={() => setKnowledgeView('list')}
                                    className="p-2 hover:bg-card rounded-lg transition-colors"
                                  >
                                    <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                  </button>
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                                      <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                      </svg>
                                    </div>
                                    <div>
                                      <h2 className="text-xl font-bold text-fg">KNOWLEDGE</h2>
                                      <p className="text-sm text-fg/60">Add text-based information to train your Agent</p>
                                    </div>
                                  </div>
                                </div>

                                {/* Save Message */}
                                {knowledgeSaveMessage && (
                                  <div className={`mb-4 px-4 py-3 rounded-lg ${knowledgeSaveMessage.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                                    {knowledgeSaveMessage.text}
                                  </div>
                                )}

                                {/* Text Input Card */}
                                <div className="bg-card border border-magenta-brand/20 rounded-xl p-6">
                                  <div className="mb-4">
                                    <h3 className="font-semibold text-fg mb-1">Information for Your Agent</h3>
                                    <p className="text-sm text-fg/60">Enter accurate info your AI can use as answers</p>
                                  </div>

                                  <textarea
                                    value={knowledgeText}
                                    onChange={(e) => setKnowledgeText(e.target.value)}
                                    maxLength={10000}
                                    rows={12}
                                    placeholder="Company overview, product features, customer FAQs, service guidelines..."
                                    className="w-full px-4 py-3 bg-canvas border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent resize-none placeholder-fg/50"
                                  />

                                  <div className="flex items-center justify-between mt-3">
                                    <span className="text-sm text-fg/50">{knowledgeText.length}/10000</span>
                                    <button
                                      onClick={saveTextKnowledge}
                                      disabled={isSavingKnowledge || !knowledgeText.trim()}
                                      className="px-6 py-2.5 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                      {isSavingKnowledge ? (
                                        <>
                                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                          </svg>
                                          Saving...
                                        </>
                                      ) : (
                                        'Save'
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Right side - Knowledge List */}
                              <div className="w-80 flex-shrink-0">
                                <div className="bg-card border border-magenta-brand/20 rounded-xl h-full">
                                  <div className="p-4 border-b border-magenta-brand/20">
                                    <h3 className="font-semibold text-fg">Saved Knowledge</h3>
                                    <p className="text-xs text-fg/60 mt-1">{knowledgeList.length} entries</p>
                                  </div>
                                  
                                  <div className="overflow-y-auto max-h-[500px] p-3 space-y-3">
                                    {isLoadingKnowledge ? (
                                      <div className="flex items-center justify-center py-8">
                                        <svg className="w-6 h-6 animate-spin text-fg/60" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                      </div>
                                    ) : knowledgeList.length === 0 ? (
                                      <div className="text-center py-8 text-fg/50">
                                        <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <p className="text-sm">No knowledge added yet</p>
                                      </div>
                                    ) : (
                                      knowledgeList.map((kb) => (
                                        <div key={kb.knowledge_id} className="bg-canvas rounded-lg p-3 border border-magenta-brand/10">
                                          {/* View Mode */}
                                          <div>
                                            <p className="text-sm text-fg/80 line-clamp-3">{kb.content}</p>
                                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-magenta-brand/10">
                                              <span className="text-xs text-fg/50">
                                                  {kb.created_at ? new Date(kb.created_at).toLocaleDateString() : 'Unknown date'}
                                                </span>
                                                <div className="flex gap-1">
                                                  <button
                                                    onClick={() => setEditingKnowledge({ id: kb.knowledge_id, content: kb.content })}
                                                    className="p-1.5 text-fg/60 hover:text-purple-brand hover:bg-purple-brand/10 rounded transition-colors"
                                                    title="Edit"
                                                  >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                  </button>
                                                  <button
                                                    onClick={() => deleteKnowledge(kb.knowledge_id)}
                                                    disabled={deletingKnowledgeId === kb.knowledge_id}
                                                    className="p-1.5 text-fg/60 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                                                    title="Delete"
                                                  >
                                                    {deletingKnowledgeId === kb.knowledge_id ? (
                                                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                      </svg>
                                                    ) : (
                                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                      </svg>
                                                    )}
                                                  </button>
                                                </div>
                                              </div>
                                            </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Edit Knowledge Modal */}
                              {editingKnowledge && (
                                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                                  <div className="bg-canvas border border-magenta-brand/30 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                                    {/* Modal Header */}
                                    <div className="flex items-center justify-between p-4 border-b border-magenta-brand/20">
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                                          <svg className="w-4 h-4 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                          </svg>
                                        </div>
                                        <h3 className="text-lg font-semibold text-fg">Edit Knowledge</h3>
                                      </div>
                                      <button
                                        onClick={() => setEditingKnowledge(null)}
                                        className="p-2 text-fg/60 hover:text-fg hover:bg-card rounded-lg transition-colors"
                                      >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    </div>
                                    
                                    {/* Modal Body */}
                                    <div className="p-4 flex-1 overflow-y-auto">
                                      <label className="block text-sm font-medium text-fg/80 mb-2">Knowledge Content</label>
                                      <textarea
                                        value={editingKnowledge.content}
                                        onChange={(e) => setEditingKnowledge({ ...editingKnowledge, content: e.target.value })}
                                        rows={12}
                                        className="w-full px-4 py-3 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent resize-none placeholder-fg/50"
                                        placeholder="Enter knowledge content..."
                                      />
                                      <p className="text-xs text-fg/50 mt-2">
                                        Note: Updating content will regenerate the embedding for better search accuracy.
                                      </p>
                                    </div>
                                    
                                    {/* Modal Footer */}
                                    <div className="flex items-center justify-end gap-3 p-4 border-t border-magenta-brand/20">
                                      <button
                                        onClick={() => setEditingKnowledge(null)}
                                        className="px-4 py-2 text-fg/80 hover:text-fg hover:bg-card rounded-lg transition-colors"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={updateKnowledge}
                                        disabled={isUpdatingKnowledge || !editingKnowledge.content.trim()}
                                        className="px-6 py-2 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                      >
                                        {isUpdatingKnowledge ? (
                                          <>
                                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Saving...
                                          </>
                                        ) : (
                                          <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            Save Changes
                                          </>
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : knowledgeView === 'file' ? (
                            /* FILE UPLOAD VIEW */
                            <div className="flex gap-6">
                              {/* Left side - Upload Form */}
                              <div className="flex-1">
                                {/* Header with back button */}
                                <div className="flex items-center gap-4 mb-6">
                                  <button 
                                    onClick={() => setKnowledgeView('list')}
                                    className="p-2 hover:bg-card rounded-lg transition-colors"
                                  >
                                    <svg className="w-5 h-5 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                  </button>
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                                      <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                      </svg>
                                    </div>
                                    <div>
                                      <h2 className="text-xl font-bold text-fg">FILE UPLOAD</h2>
                                      <p className="text-sm text-fg/60">Upload files to train your Agent</p>
                                    </div>
                                  </div>
                                </div>

                                {/* File Upload Area */}
                                <div className="bg-card border border-magenta-brand/20 rounded-xl p-6">
                                  <div className="mb-4">
                                    <h3 className="font-semibold text-fg mb-1">Upload Document</h3>
                                    <p className="text-sm text-fg/60">Supported formats: PDF (2MB), Excel, CSV, TXT (1MB each)</p>
                                  </div>
                                  
                                  {/* Hidden file input */}
                                  <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileSelect}
                                    accept=".pdf,.xlsx,.xls,.csv,.txt"
                                    className="hidden"
                                  />
                                  
                                  {/* Drop zone / File selector */}
                                  <div 
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
                                      selectedFile 
                                        ? 'border-blue-500 bg-blue-500/10' 
                                        : 'border-raised-2 hover:border-blue-500/50 hover:bg-canvas'
                                    }`}
                                  >
                                    {selectedFile ? (
                                      <div className="flex flex-col items-center gap-3">
                                        <div className="w-16 h-16 bg-blue-500/20 rounded-xl flex items-center justify-center">
                                          <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                          </svg>
                                        </div>
                                        <div>
                                          <p className="font-medium text-fg">{selectedFile.name}</p>
                                          <p className="text-sm text-fg/60">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedFile(null);
                                            if (fileInputRef.current) fileInputRef.current.value = '';
                                          }}
                                          className="text-sm text-red-400 hover:text-red-300"
                                        >
                                          Remove file
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col items-center gap-3">
                                        <div className="w-16 h-16 bg-raised rounded-xl flex items-center justify-center">
                                          <svg className="w-8 h-8 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                          </svg>
                                        </div>
                                        <div>
                                          <p className="text-fg font-medium">Click to upload</p>
                                          <p className="text-sm text-fg/60">or drag and drop</p>
                                        </div>
                                        <p className="text-xs text-fg/50">PDF, XLSX, CSV, TXT</p>
                                      </div>
                                    )}
                                  </div>

                                  {/* Upload Button */}
                                  <div className="flex items-center justify-between mt-4">
                                    {fileUploadMessage && (
                                      <p className={`text-sm ${fileUploadMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                        {fileUploadMessage.text}
                                      </p>
                                    )}
                                    <div className="flex-1" />
                                    <button
                                      onClick={uploadFile}
                                      disabled={!selectedFile || isUploadingFile}
                                      className="px-6 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                      {isUploadingFile ? (
                                        <>
                                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                          </svg>
                                          Uploading...
                                        </>
                                      ) : (
                                        <>
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                          </svg>
                                          Upload File
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Right side - Uploaded Files List */}
                              <div className="w-80 bg-card border border-magenta-brand/20 rounded-xl p-4 h-fit max-h-[500px] overflow-y-auto">
                                <div className="flex items-center justify-between mb-4">
                                  <h3 className="font-semibold text-fg">Uploaded Files</h3>
                                  <span className="text-sm text-purple-brand">{groupedFileList.length} {groupedFileList.length === 1 ? 'file' : 'files'}</span>
                                </div>
                                
                                {isLoadingFileKnowledge ? (
                                  <div className="flex items-center justify-center py-8">
                                    <svg className="w-6 h-6 animate-spin text-purple-brand" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                  </div>
                                ) : groupedFileList.length === 0 ? (
                                  <div className="text-center py-8 text-fg/50">
                                    <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <p className="text-sm">No files uploaded yet</p>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    {groupedFileList.map((file) => (
                                      <div key={file.fileName} className="bg-canvas rounded-lg p-3 border border-raised">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <div className="w-8 h-8 bg-blue-500/20 rounded flex items-center justify-center flex-shrink-0">
                                              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                              </svg>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <p className="text-sm font-medium text-fg truncate">{file.fileName}</p>
                                              <p className="text-xs text-fg/50">
                                                {file.fileType?.toUpperCase()} • {file.totalChunks} {file.totalChunks === 1 ? 'chunk' : 'chunks'} • {file.fileSize ? `${(file.fileSize / 1024).toFixed(1)} KB` : ''}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-1 flex-shrink-0">
                                            {/* View File Button */}
                                            <button
                                              onClick={() => viewFile(file.chunks[0]?.knowledge_id)}
                                              className="p-1.5 text-fg/60 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                                              title="View file"
                                            >
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                              </svg>
                                            </button>
                                            {/* Delete Button */}
                                            <button
                                              onClick={() => deleteFileKnowledge(file.fileName, file.chunks.map((c: KnowledgeChunk) => c.knowledge_id))}
                                              disabled={deletingKnowledgeId === file.fileName}
                                              className="p-1.5 text-fg/60 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                              title="Delete file"
                                            >
                                              {deletingKnowledgeId === file.fileName ? (
                                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                              ) : (
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                              )}
                                            </button>
                                          </div>
                                        </div>
                                        <p className="text-xs text-fg/60 mt-2 line-clamp-2">{file.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : knowledgeView === 'link' ? (
                            /* LINK KB VIEW */
                            <div className="flex gap-6">
                              {/* Left side - Add Link Form */}
                              <div className="flex-1">
                                {/* Header with back button */}
                                <div className="flex items-center gap-4 mb-6">
                                  <button 
                                    onClick={() => setKnowledgeView('list')}
                                    className="p-2 hover:bg-card rounded-lg transition-colors"
                                  >
                                    <svg className="w-5 h-5 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                  </button>
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                                      <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                      </svg>
                                    </div>
                                    <div>
                                      <h2 className="text-xl font-bold text-fg">ADD LINK</h2>
                                      <p className="text-sm text-fg/60">Scrape website content to train your Agent</p>
                                    </div>
                                  </div>
                                </div>

                                {/* Link Input Area */}
                                <div className="bg-card border border-magenta-brand/20 rounded-xl p-6">
                                  <h3 className="font-medium text-fg mb-2">Enter URL</h3>
                                  <p className="text-sm text-fg/60 mb-4">
                                    We&apos;ll scrape the webpage content, clean the HTML, and add it to your knowledge base.
                                  </p>
                                  
                                  <div className="flex gap-3">
                                    <div className="flex-1 relative">
                                      <div className="absolute left-3 top-1/2 -translate-y-1/2">
                                        <svg className="w-5 h-5 text-fg/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                                        </svg>
                                      </div>
                                      <input
                                        type="url"
                                        value={linkUrl}
                                        onChange={(e) => setLinkUrl(e.target.value)}
                                        placeholder="https://example.com/page"
                                        className="w-full pl-10 pr-4 py-3 bg-canvas border border-raised rounded-lg text-fg placeholder-fg/50 focus:outline-none focus:border-magenta-brand transition-colors"
                                        onKeyDown={(e) => e.key === 'Enter' && addLinkKnowledge()}
                                      />
                                    </div>
                                    <button
                                      onClick={addLinkKnowledge}
                                      disabled={!linkUrl.trim() || isAddingLink}
                                      className="px-6 py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                      {isAddingLink ? (
                                        <>
                                          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                          </svg>
                                          <span>Scraping...</span>
                                        </>
                                      ) : (
                                        <>
                                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                          </svg>
                                          <span>Add Link</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                  
                                  {linkMessage && (
                                    <p className={`mt-4 text-sm ${linkMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                      {linkMessage.text}
                                    </p>
                                  )}
                                </div>
                              </div>

                              {/* Right side - Added Links List */}
                              <div className="w-80 bg-card border border-magenta-brand/20 rounded-xl p-4 h-fit max-h-[500px] overflow-y-auto">
                                <div className="flex items-center justify-between mb-4">
                                  <h3 className="font-semibold text-fg">Added Links</h3>
                                  <span className="text-sm text-purple-brand">{groupedLinkList.length} {groupedLinkList.length === 1 ? 'link' : 'links'}</span>
                                </div>
                                
                                {isLoadingLinkKnowledge ? (
                                  <div className="flex items-center justify-center py-8">
                                    <svg className="w-6 h-6 animate-spin text-purple-brand" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                  </div>
                                ) : groupedLinkList.length === 0 ? (
                                  <div className="text-center py-8 text-fg/50">
                                    <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                    </svg>
                                    <p className="text-sm">No links added yet</p>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    {groupedLinkList.map((link) => (
                                      <div key={link.url} className="bg-canvas rounded-lg p-3 border border-raised">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <div className="w-8 h-8 bg-green-500/20 rounded flex items-center justify-center flex-shrink-0">
                                              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                              </svg>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <p className="text-sm font-medium text-fg truncate" title={link.pageTitle}>{link.pageTitle}</p>
                                              <p className="text-xs text-fg/50 truncate" title={link.url}>
                                                {link.totalChunks} {link.totalChunks === 1 ? 'chunk' : 'chunks'} • {link.extractedChars ? `${(link.extractedChars / 1000).toFixed(1)}k chars` : ''}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-1 flex-shrink-0">
                                            {/* View Content Button */}
                                            <button
                                              onClick={() => setViewingLink(link)}
                                              className="p-1.5 text-fg/60 hover:text-purple-brand hover:bg-purple-brand/10 rounded transition-colors"
                                              title="View scraped content"
                                            >
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                              </svg>
                                            </button>
                                            {/* Open URL Button */}
                                            <button
                                              onClick={() => openLinkUrl(link.url)}
                                              className="p-1.5 text-fg/60 hover:text-green-400 hover:bg-green-500/10 rounded transition-colors"
                                              title="Open URL"
                                            >
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                              </svg>
                                            </button>
                                            {/* Delete Button */}
                                            <button
                                              onClick={() => deleteLinkKnowledge(link.url, link.chunks.map((c: KnowledgeChunk) => c.knowledge_id))}
                                              disabled={deletingLinkId === link.url}
                                              className="p-1.5 text-fg/60 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                              title="Delete link"
                                            >
                                              {deletingLinkId === link.url ? (
                                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                              ) : (
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                              )}
                                            </button>
                                          </div>
                                        </div>
                                        <p 
                                          className="text-xs text-fg/60 mt-2 line-clamp-2 cursor-pointer hover:text-fg/80 transition-colors"
                                          onClick={() => setViewingLink(link)}
                                          title="Click to view full content"
                                        >{link.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : trainSection === 'actions' ? (
                        /* ACTIONS Section */
                        <div ref={actionsContainerRef}>
                          <div className="flex items-center gap-3 mb-6">
                            <svg className="w-6 h-6 text-purple-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                            </svg>
                            <div>
                              <h2 className="text-2xl font-bold text-fg">ACTIONS</h2>
                              <p className="text-sm text-fg/60">Set conditions for replies and tasks</p>
                            </div>
                          </div>

                          {/* Rule Save Message */}
                          {ruleSaveMessage && (
                            <div className={`mb-4 p-3 rounded-lg ${ruleSaveMessage.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                              {ruleSaveMessage.text}
                            </div>
                          )}

                          {/* Create New Rule Button */}
                          {!isCreatingRule && (
                            <button 
                              onClick={() => setIsCreatingRule(true)}
                              className="w-full bg-purple-brand/10 border-2 border-dashed border-magenta-brand/40 rounded-lg p-6 text-center hover:border-magenta-brand hover:bg-purple-brand/20 transition-all mb-6 group"
                            >
                              <div className="flex items-center justify-center gap-3">
                                <div className="w-10 h-10 bg-purple-brand rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                                  <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                </div>
                                <span className="text-lg font-semibold text-purple-brand">Create New Rule</span>
                              </div>
                            </button>
                          )}

                          {/* Rule Builder Form */}
                          {isCreatingRule && (
                            <div className="bg-card rounded-xl p-6 border border-magenta-brand/20 mb-6">
                              <div className="flex items-center justify-between mb-6">
                                <h3 className="text-lg font-semibold text-fg">{editingRule ? 'Edit Rule' : 'New Rule'}</h3>
                                <button
                                  onClick={() => {
                                    setIsCreatingRule(false);
                                    setEditingRule(null);
                                    setWhenConditions([{ id: '1', type: '', value: '', isDropdownOpen: false }]);
                                    setDoActions([{ id: '1', type: '', value: '', isDropdownOpen: false, kbDropdownOpen: false }]);
                                    setMatchType('ANY');
                                  }}
                                  className="text-fg/60 hover:text-fg transition-colors"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>

                              {/* WHEN Conditions */}
                              <div className="mb-6">
                                <h4 className="text-sm font-medium text-fg/60 uppercase tracking-wider mb-3">WHEN (Conditions)</h4>
                                {whenConditions.map((condition, index) => (
                                  <div key={condition.id} className="mb-4">
                                    <div className="flex items-center gap-3">
                                      <span className="text-fg font-medium w-16">WHEN</span>
                                      <div className="flex-1 relative">
                                        <button
                                          onClick={() => {
                                            setWhenConditions(whenConditions.map(c =>
                                              c.id === condition.id
                                                ? {...c, isDropdownOpen: !c.isDropdownOpen}
                                                : {...c, isDropdownOpen: false}
                                            ));
                                            setDoActions(doActions.map(a => ({...a, isDropdownOpen: false})));
                                            setIsMatchDropdownOpen(false);
                                          }}
                                          className="w-full flex items-center justify-between px-4 py-3 bg-canvas border border-magenta-brand/20 rounded-lg text-left hover:border-magenta-brand/40 transition-colors"
                                        >
                                          <span className={condition.type ? 'text-fg' : 'text-fg/50'}>
                                            {condition.type || 'Select a condition...'}
                                          </span>
                                          <svg className={`w-5 h-5 text-fg/60 transition-transform ${condition.isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                        {condition.isDropdownOpen && (
                                          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-80 overflow-y-auto">
                                            {whenConditionOptions.map(option => (
                                              <button
                                                key={option.value}
                                                onClick={() => {
                                                  setWhenConditions(whenConditions.map(c =>
                                                    c.id === condition.id
                                                      ? {...c, type: option.value, isDropdownOpen: false}
                                                      : c
                                                  ));
                                                }}
                                                className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-gray-50 transition-colors"
                                              >
                                                {option.icon}
                                                <span className="text-sm font-medium">{option.label}</span>
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex gap-1">
                                        {(() => {
                                          const isComplete = condition.type === 'Conversation starts' || (condition.type && condition.value.trim());
                                          const isLastCondition = index === whenConditions.length - 1;
                                          return (
                                            <button
                                              onClick={() => {
                                                if (isComplete && isLastCondition) {
                                                  setWhenConditions([...whenConditions, { id: Date.now().toString(), type: '', value: '', isDropdownOpen: false }]);
                                                }
                                              }}
                                              disabled={!isComplete || !isLastCondition}
                                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                                isComplete && isLastCondition
                                                  ? 'bg-[#10b981] hover:bg-[#059669] cursor-pointer'
                                                  : 'bg-raised-2 cursor-not-allowed opacity-50'
                                              }`}
                                            >
                                              <svg className="w-4 h-4 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                              </svg>
                                            </button>
                                          );
                                        })()}
                                        {whenConditions.length > 1 && (
                                          <button
                                            onClick={() => setWhenConditions(whenConditions.filter(c => c.id !== condition.id))}
                                            className="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center hover:bg-red-500/40 transition-colors"
                                          >
                                            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                            </svg>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {condition.type && condition.type !== 'Conversation starts' && (
                                      <div className="ml-19 mt-2">
                                        <input
                                          type="text"
                                          placeholder={`Enter ${condition.type.toLowerCase().replace('user ', '')}...`}
                                          value={condition.value}
                                          onChange={(e) => {
                                            setWhenConditions(whenConditions.map(c =>
                                              c.id === condition.id ? {...c, value: e.target.value} : c
                                            ));
                                          }}
                                          className="w-full px-4 py-2 bg-canvas border border-magenta-brand/20 rounded-lg text-fg placeholder-fg/50 focus:outline-none focus:border-magenta-brand/60 text-sm"
                                        />
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>

                              {/* Match Type (ANY/ALL) - shown when multiple conditions */}
                              {whenConditions.length > 1 && (
                                <div className="mb-6 bg-[#374151] rounded-lg px-4 py-3 flex items-center justify-center gap-2">
                                  <span className="text-fg font-medium">IF</span>
                                  <div className="relative">
                                    <button
                                      onClick={() => {
                                        setIsMatchDropdownOpen(!isMatchDropdownOpen);
                                        setWhenConditions(whenConditions.map(c => ({...c, isDropdownOpen: false})));
                                        setDoActions(doActions.map(a => ({...a, isDropdownOpen: false})));
                                      }}
                                      className="flex items-center gap-2 px-3 py-1 bg-purple-brand rounded-md text-white font-medium"
                                    >
                                      {matchType}
                                      <svg className={`w-4 h-4 transition-transform ${isMatchDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                    {isMatchDropdownOpen && (
                                      <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                                        <button
                                          onClick={() => { setMatchType('ANY'); setIsMatchDropdownOpen(false); }}
                                          className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 text-sm font-medium"
                                        >
                                          ANY (OR)
                                        </button>
                                        <button
                                          onClick={() => { setMatchType('ALL'); setIsMatchDropdownOpen(false); }}
                                          className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 text-sm font-medium"
                                        >
                                          ALL (AND)
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-fg font-medium">of the conditions match</span>
                                </div>
                              )}

                              {/* DO Actions */}
                              <div className="mb-6">
                                <h4 className="text-sm font-medium text-fg/60 uppercase tracking-wider mb-3">DO (Actions)</h4>
                                {doActions.map((action, index) => (
                                  <div key={action.id} className="mb-4">
                                    <div className="flex items-center gap-3">
                                      <span className="text-fg font-medium w-16">DO</span>
                                      <div className="flex-1 relative">
                                        <button
                                          onClick={() => {
                                            setDoActions(doActions.map(a =>
                                              a.id === action.id
                                                ? {...a, isDropdownOpen: !a.isDropdownOpen}
                                                : {...a, isDropdownOpen: false}
                                            ));
                                            setWhenConditions(whenConditions.map(c => ({...c, isDropdownOpen: false})));
                                            setIsMatchDropdownOpen(false);
                                          }}
                                          className="w-full flex items-center justify-between px-4 py-3 bg-canvas border border-magenta-brand/20 rounded-lg text-left hover:border-magenta-brand/40 transition-colors"
                                        >
                                          <span className={action.type ? 'text-fg' : 'text-fg/50'}>
                                            {action.type || 'Select an action...'}
                                          </span>
                                          <svg className={`w-5 h-5 text-fg/60 transition-transform ${action.isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                        {action.isDropdownOpen && (
                                          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-80 overflow-y-auto">
                                            {doActionOptions.map(option => (
                                              <button
                                                key={option.value}
                                                onClick={() => {
                                                  setDoActions(doActions.map(a =>
                                                    a.id === action.id
                                                      ? {...a, type: option.value, isDropdownOpen: false}
                                                      : a
                                                  ));
                                                }}
                                                className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-gray-50 transition-colors"
                                              >
                                                {option.icon}
                                                <span className="text-sm font-medium">{option.label}</span>
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex gap-1">
                                        {(() => {
                                          const isComplete = action.type && action.value.trim();
                                          const isLastAction = index === doActions.length - 1;
                                          return (
                                            <button
                                              onClick={() => {
                                                if (isComplete && isLastAction) {
                                                  setDoActions([...doActions, { id: Date.now().toString(), type: '', value: '', isDropdownOpen: false, kbDropdownOpen: false }]);
                                                }
                                              }}
                                              disabled={!isComplete || !isLastAction}
                                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                                isComplete && isLastAction
                                                  ? 'bg-[#10b981] hover:bg-[#059669] cursor-pointer'
                                                  : 'bg-raised-2 cursor-not-allowed opacity-50'
                                              }`}
                                            >
                                              <svg className="w-4 h-4 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                              </svg>
                                            </button>
                                          );
                                        })()}
                                        {doActions.length > 1 && (
                                          <button
                                            onClick={() => setDoActions(doActions.filter(a => a.id !== action.id))}
                                            className="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center hover:bg-red-500/40 transition-colors"
                                          >
                                            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                            </svg>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {action.type && (
                                      <div className="ml-19 mt-2">
                                        {action.type === 'Answer Using Knowledge Base' ? (
                                          /* KB Selection Dropdown */
                                          <div className="relative">
                                            <button
                                              onClick={() => {
                                                setDoActions(doActions.map(a =>
                                                  a.id === action.id ? {...a, kbDropdownOpen: !a.kbDropdownOpen} : {...a, kbDropdownOpen: false}
                                                ));
                                              }}
                                              className="w-full px-4 py-2.5 bg-canvas border border-magenta-brand/20 rounded-lg text-left flex items-center justify-between hover:border-magenta-brand/40 transition-colors"
                                            >
                                              <span className={action.value ? 'text-fg' : 'text-fg/50'}>
                                                {action.value || 'Select knowledge base...'}
                                              </span>
                                              <svg className={`w-4 h-4 text-fg/60 transition-transform ${action.kbDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                              </svg>
                                            </button>
                                            
                                            {action.kbDropdownOpen && (
                                              <div className="absolute z-50 w-full mt-1 bg-canvas border border-magenta-brand/30 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                                                {/* All KB Option */}
                                                <button
                                                  onClick={() => {
                                                    setDoActions(doActions.map(a =>
                                                      a.id === action.id ? {...a, value: 'All Knowledge Base', kbDropdownOpen: false} : a
                                                    ));
                                                  }}
                                                  className="w-full px-4 py-2.5 text-left hover:bg-purple-brand/20 flex items-center gap-3 border-b border-raised"
                                                >
                                                  <div className="w-6 h-6 bg-emerald-500/20 rounded flex items-center justify-center">
                                                    <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                                    </svg>
                                                  </div>
                                                  <span className="text-fg font-medium">All Knowledge Base</span>
                                                </button>

                                                {/* Text KB Section */}
                                                {knowledgeList.length > 0 && (
                                                  <>
                                                    <div className="px-4 py-2 bg-card text-xs font-semibold text-fg/60 uppercase">Text Knowledge</div>
                                                    {knowledgeList.map((kb, i) => (
                                                      <button
                                                        key={kb.knowledge_id}
                                                        onClick={() => {
                                                          setDoActions(doActions.map(a =>
                                                            a.id === action.id ? {...a, value: `Text: ${kb.content.substring(0, 50)}...`, kbDropdownOpen: false} : a
                                                          ));
                                                        }}
                                                        className="w-full px-4 py-2.5 text-left hover:bg-purple-brand/20 flex items-center gap-3"
                                                      >
                                                        <div className="w-6 h-6 bg-purple-500/20 rounded flex items-center justify-center">
                                                          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                          </svg>
                                                        </div>
                                                        <span className="text-fg/80 text-sm truncate">{kb.content.substring(0, 60)}...</span>
                                                      </button>
                                                    ))}
                                                  </>
                                                )}

                                                {/* Files Section */}
                                                {groupedFileList.length > 0 && (
                                                  <>
                                                    <div className="px-4 py-2 bg-card text-xs font-semibold text-fg/60 uppercase">Files</div>
                                                    {groupedFileList.map((file) => (
                                                      <button
                                                        key={file.fileName}
                                                        onClick={() => {
                                                          setDoActions(doActions.map(a =>
                                                            a.id === action.id ? {...a, value: `File: ${file.fileName}`, kbDropdownOpen: false} : a
                                                          ));
                                                        }}
                                                        className="w-full px-4 py-2.5 text-left hover:bg-purple-brand/20 flex items-center gap-3"
                                                      >
                                                        <div className="w-6 h-6 bg-blue-500/20 rounded flex items-center justify-center">
                                                          <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                          </svg>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                          <span className="text-fg/80 text-sm truncate block">{file.fileName}</span>
                                                          <span className="text-fg/50 text-xs">{file.totalChunks} chunks</span>
                                                        </div>
                                                      </button>
                                                    ))}
                                                  </>
                                                )}

                                                {/* Links Section */}
                                                {groupedLinkList.length > 0 && (
                                                  <>
                                                    <div className="px-4 py-2 bg-card text-xs font-semibold text-fg/60 uppercase">Links</div>
                                                    {groupedLinkList.map((link) => (
                                                      <button
                                                        key={link.url}
                                                        onClick={() => {
                                                          setDoActions(doActions.map(a =>
                                                            a.id === action.id ? {...a, value: `Link: ${link.pageTitle || link.url}`, kbDropdownOpen: false} : a
                                                          ));
                                                        }}
                                                        className="w-full px-4 py-2.5 text-left hover:bg-purple-brand/20 flex items-center gap-3"
                                                      >
                                                        <div className="w-6 h-6 bg-indigo-500/20 rounded flex items-center justify-center">
                                                          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                                          </svg>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                          <span className="text-fg/80 text-sm truncate block">{link.pageTitle || 'Untitled'}</span>
                                                          <span className="text-fg/50 text-xs truncate block">{link.url}</span>
                                                        </div>
                                                      </button>
                                                    ))}
                                                  </>
                                                )}

                                                {/* Empty State */}
                                                {knowledgeList.length === 0 && groupedFileList.length === 0 && groupedLinkList.length === 0 && (
                                                  <div className="px-4 py-6 text-center text-fg/50">
                                                    <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                                    </svg>
                                                    <p className="text-sm">No knowledge base items yet</p>
                                                    <p className="text-xs mt-1">Add text, files, or links first</p>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        ) : (
                                          <textarea
                                            placeholder={action.type === 'Say exact message' ? 'Enter the exact message...' : `Enter ${action.type.toLowerCase()} value...`}
                                            value={action.value}
                                            onChange={(e) => {
                                              setDoActions(doActions.map(a =>
                                                a.id === action.id ? {...a, value: e.target.value} : a
                                              ));
                                            }}
                                            rows={action.type === 'Say exact message' ? 3 : 1}
                                            className="w-full px-4 py-2 bg-canvas border border-magenta-brand/20 rounded-lg text-fg placeholder-fg/50 focus:outline-none focus:border-magenta-brand/60 text-sm resize-none"
                                          />
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>

                              {/* Save Button */}
                              <div className="flex justify-end">
                                <button
                                  onClick={saveRule}
                                  disabled={isSavingRule}
                                  className="px-6 py-2.5 bg-purple-brand text-white rounded-lg font-medium hover:bg-[#a855c7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                  {isSavingRule ? (
                                    <>
                                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                      Saving...
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      Save Rule
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Rules Section Header */}
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-fg">Your Rules</h3>
                            <span className="text-sm text-fg/60">{savedRules.length} rule{savedRules.length !== 1 ? 's' : ''}</span>
                          </div>

                          {/* Loading State */}
                          {isLoadingRules && (
                            <div className="bg-card rounded-lg p-8 text-center border border-magenta-brand/10">
                              <svg className="w-8 h-8 animate-spin mx-auto text-purple-brand" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <p className="text-fg/60 mt-3">Loading rules...</p>
                            </div>
                          )}

                          {/* Empty State */}
                          {!isLoadingRules && savedRules.length === 0 && (
                            <div className="bg-card rounded-lg p-8 text-center border border-magenta-brand/10">
                              <div className="w-16 h-16 bg-purple-brand/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg className="w-8 h-8 text-purple-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                </svg>
                              </div>
                              <h4 className="text-fg font-semibold mb-2">No rules yet</h4>
                              <p className="text-fg/60 text-sm mb-4">Create rules to automate responses based on conditions</p>
                            </div>
                          )}

                          {/* Saved Rules List */}
                          {!isLoadingRules && savedRules.length > 0 && (
                            <div className="space-y-3">
                              {savedRules.map((rule) => (
                                <div 
                                  key={rule.rule_id} 
                                  className={`bg-card rounded-lg p-4 border transition-colors ${
                                    rule.active === false 
                                      ? 'border-raised-2 opacity-60' 
                                      : 'border-magenta-brand/10 hover:border-magenta-brand/30'
                                  }`}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-2">
                                        <h4 className="text-fg font-medium">{rule.name}</h4>
                                        {rule.active === false && (
                                          <span className="px-2 py-0.5 bg-raised-2 text-fg/80 text-xs rounded-full">Disabled</span>
                                        )}
                                      </div>
                                      <div className="space-y-2">
                                        {/* Conditions */}
                                        <div className="flex flex-wrap gap-2">
                                          <span className="text-xs font-medium text-blue-400 uppercase">WHEN:</span>
                                          {rule.conditions.map((c, i) => (
                                            <span key={i} className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-md">
                                              {c.type}{c.value ? `: ${c.value}` : ''}
                                            </span>
                                          ))}
                                          {rule.conditions.length > 1 && (
                                            <span className="px-2 py-1 bg-gray-500/20 text-fg/80 text-xs rounded-md">
                                              ({rule.match_type})
                                            </span>
                                          )}
                                        </div>
                                        {/* Actions */}
                                        <div className="flex flex-wrap gap-2">
                                          <span className="text-xs font-medium text-green-400 uppercase">DO:</span>
                                          {rule.actions.map((a, i) => (
                                            <span key={i} className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded-md">
                                              {a.type}: {a.value.substring(0, 30)}{a.value.length > 30 ? '...' : ''}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                    
                                    {/* Actions Menu */}
                                    <div className="relative ml-4" data-rule-menu>
                                    <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveRuleMenu(activeRuleMenu === rule.rule_id ? null : rule.rule_id);
                                        }}
                                        className="p-2 text-fg/60 hover:text-fg transition-colors rounded-lg hover:bg-raised"
                                      >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                                        </svg>
                                      </button>
                                      
                                      {/* Dropdown Menu */}
                                      {activeRuleMenu === rule.rule_id && (
                                        <div className="absolute right-0 top-full mt-1 w-40 bg-[#1e2a3a] rounded-lg shadow-xl border border-[#2a4a6a] z-50 overflow-hidden" data-rule-menu>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              editRule(rule);
                                            }}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-fg hover:bg-[#2a4a6a] transition-colors text-left"
                                          >
                                            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                            Edit
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleRuleStatus(rule);
                                            }}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-fg hover:bg-[#2a4a6a] transition-colors text-left"
                                          >
                                            <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              {rule.active === false ? (
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                              ) : (
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                              )}
                                            </svg>
                                            {rule.active === false ? 'Enable' : 'Disable'}
                                          </button>
                                          <div className="border-t border-[#2a4a6a]"></div>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              deleteRule(rule.rule_id);
                                            }}
                                      disabled={deletingRuleId === rule.rule_id}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-red-400 hover:bg-red-500/10 transition-colors text-left disabled:opacity-50"
                                    >
                                      {deletingRuleId === rule.rule_id ? (
                                              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                      ) : (
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                      )}
                                            Delete
                                    </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* How Rules Work */}
                          <div className="mt-8">
                            <h3 className="text-lg font-semibold text-fg mb-4">How Rules Work</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="bg-card rounded-lg p-4 border border-magenta-brand/10">
                                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center mb-3">
                                  <span className="text-blue-400 font-bold">WHEN</span>
                                </div>
                                <h4 className="text-fg font-medium mb-1">Condition</h4>
                                <p className="text-fg/60 text-sm">Set triggers like keywords, intents, or sentiment</p>
                              </div>
                              <div className="bg-card rounded-lg p-4 border border-magenta-brand/10">
                                <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center mb-3">
                                  <span className="text-green-400 font-bold">DO</span>
                                </div>
                                <h4 className="text-fg font-medium mb-1">Action</h4>
                                <p className="text-fg/60 text-sm">Define responses or behaviors to execute</p>
                              </div>
                              <div className="bg-card rounded-lg p-4 border border-magenta-brand/10">
                                <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center mb-3">
                                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                </div>
                                <h4 className="text-fg font-medium mb-1">Result</h4>
                                <p className="text-fg/60 text-sm">Your agent responds intelligently and automatically</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : trainSection === 'teach' ? (
                        /* TEACH YOUR AGENT Section */
                        <div className="h-full min-h-[600px]">
                          {selectedProject?.agent_id ? (
                            <TeachYourAgent
                              agentId={selectedProject.agent_id}
                              sessionId={actualSessionId}
                              agentName={personaName || selectedProject.name}
                              onPersonaUpdated={() => {
                                // Refresh persona data
                                if (selectedProject?.agent_id) {
                                  loadPersona(selectedProject.agent_id);
                                }
                              }}
                              onKnowledgeAdded={() => {
                                // Refresh knowledge list
                                loadKnowledgeList();
                              }}
                              onActionCreated={() => {
                                // Refresh rules list
                                loadRules();
                              }}
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full">
                              <div className="text-center">
                                <svg className="w-16 h-16 text-fg/20 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                  </svg>
                                <p className="text-fg/40">Agent not initialized</p>
                                <p className="text-fg/30 text-sm mt-1">Please wait while your agent is being set up...</p>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                          <div className="text-center py-12">
                            <p className="text-fg/60">Section coming soon...</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sidebar Toggle Button (when closed) */}
              {!sidebarOpen && activeTab === 'train' && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="fixed left-0 top-32 bottom-0 w-8 bg-card border-r border-magenta-brand/20 hover:bg-raised transition-colors flex items-center justify-center"
                >
                  <svg className="w-5 h-5 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          ) : selectedProject.type === 'rule-based-process' ? (
            // Block editor (see components/RuleBasedProcessProject/editors.ts for which editor opens)
            <RuleBasedProcessProject
              projectName={selectedProject.name}
              sessionId={actualSessionId}
              projectId={selectedProject.id}
              editor={selectedProject.rbpEditor}
              backHref={`/projects/${urlUserId}`}
            />
          ) : isLiveObjectDetection ? (
            <LiveObjectDetectionProject
              projectName={selectedProject.name}
              sessionId={actualSessionId}
              projectId={selectedProject.id}
              backHref={`/projects/${urlUserId}`}
              useHref={`/projects/${urlUserId}/${urlProjectId}/make`}
            />
          ) : isAiAgent ? (
            <AiAgentLab
              projectName={selectedProject.name}
              sessionId={actualSessionId}
              projectId={selectedProject.id}
            />
          ) : isRagChatbot ? (
            <RagChatbotLab
              projectName={selectedProject.name}
              sessionId={actualSessionId}
              projectId={selectedProject.id}
            />
          ) : selectedProject.type === 'confusion-matrix' ? (
            <ConfusionMatrixLab
              projectName={selectedProject.name}
              sessionId={actualSessionId}
              projectId={selectedProject.id}
            />
          ) : selectedProject.type === 'exercises' ? (
            <div className="h-full flex flex-col min-h-0">
              <div className="flex-1 min-h-0">
                <Exercises
                  projectName={selectedProject.name}
                  sessionId={actualSessionId}
                  projectId={selectedProject.id}
                  onOpenChange={setExerciseOpen}
                  onBackLabelChange={(label) => setExerciseBackLabel(label ?? 'All Exercise')}
                  backToListRef={exerciseBackRef}
                />
              </div>
            </div>
          ) : (
            /* Regular ML Project Cards */
            <div className="pt-6 pb-20 px-6">
              <div>
                {/* Back Button */}
                <div className="mb-4">
            <Link
              href={`/projects/${urlUserId}`}
                    className="inline-flex items-center gap-2 text-fg/70 hover:text-fg transition-colors"
            >
              <svg 
                      className="w-5 h-5" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M15 19l-7-7 7-7" 
                />
              </svg>
                    <span>Back to Projects</span>
            </Link>
                </div>
                {/* Project Title */}
                <div className="mb-8 text-center">
                  <h1 className="text-3xl md:text-4xl font-bold text-fg">
                    <span className="text-pink-brand">
                      {selectedProject.type === 'text-recognition' ? 'Text Recognition' : 
                       selectedProject.type === 'image-recognition' ? 'Image Recognition' : 
                       selectedProject.type === 'image-recognition-teachable-machine' ? 'Image Recognition' : 
                       selectedProject.type}
                    </span>
                    <span className="text-fg/50 mx-3">:</span>
                    <span>{selectedProject.name}</span>
            </h1>
          </div>
                <div className={`grid grid-cols-1 gap-8 mx-auto ${
                  ['text-recognition', 'image-recognition'].includes(selectedProject.type) ? 'md:grid-cols-2 xl:grid-cols-4 max-w-7xl' : 'md:grid-cols-2 max-w-4xl'}`}>
            {/* Train Card */}
            <div className="bg-canvas border border-magenta-brand/20 rounded-xl p-8 text-center hover:bg-purple-brand/5 transition-all duration-300 flex flex-col">
              <h2 className="text-2xl md:text-3xl font-bold text-blue-400 mb-6">
                1. Collect Data
              </h2>
              <p className="text-fg mb-8 text-sm md:text-base leading-relaxed flex-grow">
                Collect examples of what you want the AI to recognize
              </p>
              <button 
                onClick={() => {
                  window.location.href = `/projects/${urlUserId}/${urlProjectId}/train`;
                }}
                className="w-full bg-purple-brand hover:bg-purple-brand/90 text-white py-3 px-6 rounded-lg font-medium transition-all duration-300"
              >
                Collect Data
              </button>
            </div>

            {/* Learn & Test Card */}
            <div className="bg-canvas border border-magenta-brand/20 rounded-xl p-8 text-center hover:bg-purple-brand/5 transition-all duration-300 flex flex-col">
              <h2 className="text-2xl md:text-3xl font-bold text-purple-400 mb-6">
                2. Train the AI
              </h2>
              <p className="text-fg mb-8 text-sm md:text-base leading-relaxed flex-grow">
                Use the examples from step 1 to train a model
              </p>
              <button 
                onClick={() => {
                  window.location.href = `/projects/${urlUserId}/${urlProjectId}/learn`;
                }}
                className="w-full bg-purple-brand hover:bg-purple-brand/90 text-white py-3 px-6 rounded-lg font-medium transition-all duration-300"
              >
                Train the AI
              </button>
            </div>

            {/* Use the AI Card (Text and Image Recognition): block editor with ML Model blocks */}
            {['text-recognition', 'image-recognition'].includes(selectedProject.type) && (
              <div className="bg-canvas border border-magenta-brand/20 rounded-xl p-8 text-center hover:bg-purple-brand/5 transition-all duration-300 flex flex-col">
                <h2 className="text-2xl md:text-3xl font-bold text-orange-400 mb-6">
                  3. Use the AI
                </h2>
                <p className="text-fg mb-8 text-sm md:text-base leading-relaxed flex-grow">
                  Put your trained model to work in a prototype built with blocks
                </p>
                {/* Opens in a new tab, like a separate app that uses the deployed model */}
                <button
                  onClick={() => window.open(`/projects/${urlUserId}/${urlProjectId}/make`, '_blank', 'noopener')}
                  className="w-full bg-purple-brand hover:bg-purple-brand/90 text-white py-3 px-6 rounded-lg font-medium transition-all duration-300"
                >
                  Use the AI
                </button>
              </div>
            )}

            {/* Evaluate Card (Text and Image Recognition): the trained model on sample data it has never seen */}
            {['text-recognition', 'image-recognition'].includes(selectedProject.type) && (
              <div className="bg-canvas border border-magenta-brand/20 rounded-xl p-8 text-center hover:bg-purple-brand/5 transition-all duration-300 flex flex-col">
                <h2 className="text-2xl md:text-3xl font-bold text-pink-brand mb-6">
                  4. Evaluate
                </h2>
                <p className="text-fg mb-8 text-sm md:text-base leading-relaxed flex-grow">
                  Check your trained model on sample {selectedProject.type === 'image-recognition' ? 'images' : 'messages'} it has never seen
                </p>
                <button
                  onClick={() => {
                    window.location.href = `/projects/${urlUserId}/${urlProjectId}/evaluate`;
                  }}
                  className="w-full bg-purple-brand hover:bg-purple-brand/90 text-white py-3 px-6 rounded-lg font-medium transition-all duration-300"
                >
                  Evaluate
                </button>
              </div>
            )}

          </div>
        </div>
            </div>
          )}

      {/* View Scraped Content Modal */}
      {viewingLink && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-canvas border border-magenta-brand/30 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="bg-card px-6 py-4 rounded-t-xl border-b border-magenta-brand/20 flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-fg truncate">{viewingLink.pageTitle}</h3>
                  <p className="text-xs text-fg/60 truncate">{viewingLink.url}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingLink(null)}
                className="p-2 text-fg/60 hover:text-fg hover:bg-raised rounded-lg transition-colors ml-4"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Stats Bar */}
            <div className="px-6 py-3 bg-card border-b border-magenta-brand/10 flex items-center gap-4 text-sm">
              <span className="text-fg/60">
                <span className="text-pink-brand font-medium">{viewingLink.extractedChars ? (viewingLink.extractedChars / 1000).toFixed(1) : '?'}k</span> characters extracted
              </span>
            </div>

            {/* Content Area - Single Text Box */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-card rounded-lg p-4 border border-raised">
                <p className="text-sm text-fg/80 whitespace-pre-wrap leading-relaxed">
                  {viewingLink.chunks && viewingLink.chunks.length > 0 
                    ? viewingLink.chunks.map((chunk: KnowledgeChunk) => chunk.content).join('\n\n')
                    : viewingLink.content
                  }
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-card rounded-b-xl border-t border-magenta-brand/20 flex items-center justify-between">
              <button
                onClick={() => openLinkUrl(viewingLink.url)}
                className="px-4 py-2 text-sm text-fg/60 hover:text-green-400 flex items-center gap-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open Original URL
              </button>
              <button
                onClick={() => setViewingLink(null)}
                className="px-6 py-2 bg-purple-brand text-white rounded-lg hover:bg-purple-brand/80 transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
