// Configuration for the YaaraLabs Playground frontend
/**
 * Agent routes (/agent, /chat, /kb, /rules, /training) check that the agent belongs to the caller's
 * session, so every call says which session it acts for. Adds session_id from the stored guest session
 * unless the path already has one.
 */
export function withSession(path: string): string {
  if (/[?&]session_id=/.test(path)) return path;
  let sid = '';
  try {
    sid = typeof window !== 'undefined' ? localStorage.getItem('yaaralabs_playground_session_id') || '' : '';
  } catch {
    /* storage blocked: the server answers 400 */
  }
  return `${path}${path.includes('?') ? '&' : '?'}session_id=${encodeURIComponent(sid)}`;
}

export const config = {
  // Backend API base URL
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL || 'https://yaaralabs-playground-backend-uaaur7no2a-uc.a.run.app',
  
  // Scratch Editor URLs
  scratchEditor: {
    gui: process.env.NEXT_PUBLIC_SCRATCH_EDITOR_URL || 'https://scratch-editor-773717965404.us-central1.run.app',
    vm: process.env.NEXT_PUBLIC_SCRATCH_VM_URL || 'https://scratch-editor-773717965404.us-central1.run.app',
  },
  
  // API endpoints
  api: {
    guests: {
      session: '/api/guests/session',
      sessionById: (sessionId: string) => `/api/guests/session/${sessionId}`,
      deleteSession: (sessionId: string) => `/api/guests/session/${sessionId}`,
      projectById: (sessionId: string, projectId: string) => `/api/guests/session/${sessionId}/projects/${projectId}`,
      examples: (sessionId: string, projectId: string) => `/api/guests/session/${sessionId}/projects/${projectId}/examples`,
      images: (sessionId: string, projectId: string) => `/api/guests/session/${sessionId}/projects/${projectId}/images`,
      uploadImage: (sessionId: string, projectId: string) => `/api/guests/session/${sessionId}/projects/${projectId}/images`,
      trainModel: (sessionId: string, projectId: string) => `/api/guests/session/${sessionId}/projects/${projectId}/train`,
      trainingStatus: (sessionId: string, projectId: string) => `/api/guests/session/${sessionId}/projects/${projectId}/train`,
      predict: (sessionId: string, projectId: string) => `/api/guests/session/${sessionId}/projects/${projectId}/predict`,
      // Text Recognition "Export": the trained model's deployed URL (backend api/deployed.py)
      deploy: (sessionId: string, projectId: string) => `/api/guests/session/${sessionId}/projects/${projectId}/deploy`,
      deleteModel: (projectId: string) => `/api/guests/projects/${projectId}/model`,
      deleteExamplesByLabel: (sessionId: string, projectId: string, label: string) => `/api/guests/projects/${projectId}/examples/${encodeURIComponent(label)}`,
      deleteSpecificExample: (sessionId: string, projectId: string, label: string, exampleIndex: number) => `/api/guests/projects/${projectId}/examples/${encodeURIComponent(label)}/${exampleIndex}`,
      deleteLabel: (sessionId: string, projectId: string, label: string) => `/api/guests/projects/${projectId}/labels/${encodeURIComponent(label)}`,
      deleteEmptyLabel: (sessionId: string, projectId: string, label: string) => `/api/guests/projects/${projectId}/labels/${encodeURIComponent(label)}/empty`,
      // Image delete endpoints
      deleteImageExamplesByLabel: (sessionId: string, projectId: string, label: string) => `/api/guests/session/${sessionId}/projects/${projectId}/images/${encodeURIComponent(label)}`,
      deleteSpecificImageExample: (sessionId: string, projectId: string, label: string, exampleIndex: number) => `/api/guests/session/${sessionId}/projects/${projectId}/images/${encodeURIComponent(label)}/${exampleIndex}`,
      deleteImageLabel: (sessionId: string, projectId: string, label: string) => `/api/guests/session/${sessionId}/projects/${projectId}/images/labels/${encodeURIComponent(label)}`,
      deleteEmptyImageLabel: (sessionId: string, projectId: string, label: string) => `/api/guests/session/${sessionId}/projects/${projectId}/images/labels/${encodeURIComponent(label)}/empty`,
    },
    // Confusion Matrix projects (Exercise 3)
    confusionMatrix: {
      datasets: '/api/confusion-matrix/datasets',
      ex2Runs: (sessionId: string) => `/api/confusion-matrix/session/${sessionId}/ex2-runs`,
      project: (sessionId: string, projectId: string) =>
        `/api/confusion-matrix/session/${sessionId}/projects/${projectId}`,
    },
    // RAG Chatbot projects: documents → chunks → search → grounded answers
    copilotLab: {
      project: (sessionId: string, projectId: string) =>
        `/api/copilot-lab/session/${sessionId}/projects/${projectId}`,
    },
    ragChatbot: {
      library: '/api/rag-chatbot/library',
      libraryPdf: (docId: string) => `/api/rag-chatbot/library/${docId}/pdf`,
      models: '/api/rag-chatbot/models',
      testQuestions: '/api/rag-chatbot/test-questions',
      project: (sessionId: string, projectId: string) =>
        `/api/rag-chatbot/session/${sessionId}/projects/${projectId}`,
    },
    // AI Agent projects: instructions + tools + the agent loop
    aiAgent: {
      catalog: '/api/ai-agent/catalog',
      project: (sessionId: string, projectId: string) =>
        `/api/ai-agent/session/${sessionId}/projects/${projectId}`,
    },
    // Live Object Detection (custom mode): the project's model, saved after every training
    imageModels: {
      project: (sessionId: string, projectId: string) => `/api/image-models/session/${sessionId}/projects/${projectId}`,
    },
    // Rules Bot: the board used by Rule Based Process projects
    rulesBot: {
      samples: '/api/rules-bot/samples',
      board: (sessionId: string, projectId: string) =>
        `/api/rules-bot/session/${sessionId}/projects/${projectId}/board`,
      loadSample: (sessionId: string, projectId: string) =>
        `/api/rules-bot/session/${sessionId}/projects/${projectId}/board/load-sample`,
      resetBoard: (sessionId: string, projectId: string) =>
        `/api/rules-bot/session/${sessionId}/projects/${projectId}/board/reset`,
    },
    rbp: {
      workspace: (sessionId: string, projectId: string) =>
        `/api/rbp/session/${sessionId}/projects/${projectId}/workspace`,
      resetWorkspace: (sessionId: string, projectId: string) =>
        `/api/rbp/session/${sessionId}/projects/${projectId}/workspace/reset`,
      askModel: (sessionId: string, projectId: string) =>
        `/api/rbp/session/${sessionId}/projects/${projectId}/ask`,
      deleteWorkspace: (sessionId: string, projectId: string) =>
        `/api/rbp/session/${sessionId}/projects/${projectId}/workspace`,
    },
    lod: {
      detect: (sessionId: string, projectId: string) =>
        `/api/lod/session/${sessionId}/projects/${projectId}/detect`,
      caption: (sessionId: string, projectId: string) =>
        `/api/lod/session/${sessionId}/projects/${projectId}/caption`,
    },
    exercises: {
      workspace: (sessionId: string, projectId: string) =>
        `/api/exercises/session/${sessionId}/projects/${projectId}/workspace`,
      resetWorkspace: (sessionId: string, projectId: string) =>
        `/api/exercises/session/${sessionId}/projects/${projectId}/workspace/reset`,
      generate: (sessionId: string, projectId: string) =>
        `/api/exercises/session/${sessionId}/projects/${projectId}/generate`,
      embed: (sessionId: string, projectId: string) =>
        `/api/exercises/session/${sessionId}/projects/${projectId}/embed`,
      tfidfSample: (sessionId: string, projectId: string) =>
        `/api/exercises/session/${sessionId}/projects/${projectId}/tfidf/sample`,
      tfidfDatasets: (sessionId: string, projectId: string) =>
        `/api/exercises/session/${sessionId}/projects/${projectId}/tfidf/datasets`,
      tfidfDataset: (sessionId: string, projectId: string, datasetId: string) =>
        `/api/exercises/session/${sessionId}/projects/${projectId}/tfidf/datasets/${datasetId}`,
      tfidfTrain: (sessionId: string, projectId: string) =>
        `/api/exercises/session/${sessionId}/projects/${projectId}/tfidf/train`,
      tfidfPredict: (sessionId: string, projectId: string) =>
        `/api/exercises/session/${sessionId}/projects/${projectId}/tfidf/predict`,
    },
    agents: {
      get create() { return withSession('/agent/create'); },
      list: (sessionId: string) => withSession(`/agent?session_id=${sessionId}`),
      delete: (agentId: string, sessionId: string) => withSession(`/agent/${agentId}?session_id=${sessionId}`),
      get chat() { return withSession('/chat'); },
      get chatTeach() { return withSession('/chat/teach'); },
      chatHistory: (agentId: string, sessionId: string) => withSession(`/chat/history?agent_id=${agentId}&session_id=${sessionId}`),
      clearChatHistory: (agentId: string, sessionId: string) => withSession(`/chat/history?agent_id=${agentId}&session_id=${sessionId}`),
      persona: {
        get: (agentId: string) => withSession(`/agent/${agentId}/persona`),
        update: (agentId: string) => withSession(`/agent/${agentId}/persona`),
      },
      settings: {
        get: (agentId: string) => withSession(`/agent/${agentId}/settings`),
        update: (agentId: string) => withSession(`/agent/${agentId}/settings`),
      },
      guardrails: {
        get: (agentId: string) => withSession(`/agent/${agentId}/guardrails`),
        update: (agentId: string) => withSession(`/agent/${agentId}/guardrails`),
      },
      knowledge: {
        get text() { return withSession('/kb/text'); },
        get file() { return withSession('/kb/file'); },
        get link() { return withSession('/kb/link'); },
        get qna() { return withSession('/kb/qna'); },
        list: (agentId: string, kbType?: string) => withSession(`/kb/list?agent_id=${agentId}${kbType ? `&kb_type=${kbType}` : ''}`),
        get: (knowledgeId: string) => withSession(`/kb/${knowledgeId}`),
        update: (knowledgeId: string) => withSession(`/kb/${knowledgeId}`),
        delete: (knowledgeId: string) => withSession(`/kb/${knowledgeId}`),
        viewFile: (knowledgeId: string) => withSession(`/kb/file/view/${knowledgeId}`),
      },
      rules: {
        get save() { return withSession('/rules/save'); },
        list: (agentId: string) => withSession(`/rules?agent_id=${agentId}`),
      },
      training: {
        get message() { return withSession('/training/message'); },
        get apply() { return withSession('/training/apply'); },
        reject: (changeId: string) => withSession(`/training/reject/${changeId}`),
        sessions: (agentId: string) => withSession(`/training/sessions?agent_id=${agentId}`),
        history: (agentId: string, sessionId: string) => withSession(`/training/history?agent_id=${agentId}&session_id=${sessionId}`),
        restart: (agentId: string, sessionId: string) => withSession(`/training/restart?agent_id=${agentId}&session_id=${sessionId}`),
        greeting: (agentId: string) => withSession(`/training/greeting?agent_id=${agentId}`),
        initialize: (agentId: string, sessionId: string) => withSession(`/training/initialize?agent_id=${agentId}&session_id=${sessionId}`),
        pending: (agentId: string, sessionId: string) => withSession(`/training/pending/${agentId}?session_id=${sessionId}`),
        editMessage: (messageId: string) => withSession(`/training/message/${messageId}`),
        deleteMessage: (messageId: string) => withSession(`/training/message/${messageId}`),
        clearHistory: (agentId: string, sessionId: string) => withSession(`/training/history/clear?agent_id=${agentId}&session_id=${sessionId}`),
        // Chat management endpoints (Playground AI-like)
        get createChat() { return withSession('/training/chats'); },
        getChats: (agentId: string) => withSession(`/training/chats?agent_id=${agentId}`),
        getChat: (chatId: string) => withSession(`/training/chats/${chatId}`),
        archiveChat: (chatId: string) => withSession(`/training/chats/${chatId}/archive`),
        deleteChat: (chatId: string) => withSession(`/training/chats/${chatId}`),
      },
    },
  },
} as const;

export default config;
