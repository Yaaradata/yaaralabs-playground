'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '../../../../../components/Header';
import config from '../../../../../lib/config';
import { 
  getSessionIdFromMaskedId, 
  isMaskedId, 
  isSessionId, 
  getProjectIdFromMaskedId,
  isMaskedProjectId,
  isProjectId
} from '../../../../../lib/session-utils';
import Link from 'next/link';

interface GuestSession {
  session_id: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
}

interface Project {
  id: string;
  name: string;
  type: string;
  description?: string;
  agent_id?: string;
}

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
}

export default function BuildPage() {
  const [, setGuestSession] = useState<GuestSession | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isValidSession, setIsValidSession] = useState(false);
  const [, setActualSessionId] = useState<string>('');
  const [, setActualProjectId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'build' | 'train' | 'publish'>('build');
  const [showPreview, setShowPreview] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const params = useParams();
  const router = useRouter();
  const urlUserId = params?.userid as string;
  const urlProjectId = params?.projectid as string;

  useEffect(() => {
    validateGuestSession();
  }, [urlUserId, urlProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          router.push('/projects');
          return;
        }
        sessionId = realSessionId;
      } else if (isSessionId(urlUserId)) {
        router.push(`/projects/${urlUserId}/${urlProjectId}`);
        return;
      } else {
        router.push('/projects');
        return;
      }

      // Check if project ID is masked
      if (isMaskedProjectId(urlProjectId)) {
        const realProjectId = getProjectIdFromMaskedId(urlProjectId);
        if (!realProjectId) {
          router.push(`/projects/${urlUserId}`);
          return;
        }
        projectId = realProjectId;
      } else if (isProjectId(urlProjectId)) {
        projectId = urlProjectId;
      } else {
        router.push(`/projects/${urlUserId}`);
        return;
      }

      // Check if session exists in localStorage
      const storedSessionId = localStorage.getItem('yaaralabs_playground_session_id');
      
      if (!storedSessionId || storedSessionId !== sessionId) {
        router.push('/projects');
        return;
      }

      // Validate session with backend API
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.sessionById(sessionId)}`);
      
      if (response.ok) {
        const sessionResponse = await response.json();
        if (sessionResponse.success && sessionResponse.data.active) {
          setActualSessionId(sessionId);
          setActualProjectId(projectId);
          setGuestSession(sessionResponse.data);
          setIsValidSession(true);
          
          // Load project
          await loadProject(sessionId, projectId);
        } else {
          router.push('/projects');
          return;
        }
      } else {
        router.push('/projects');
        return;
      }
    } catch (error) {
      console.error('Error validating session:', error);
      router.push('/projects');
      return;
    }
    setIsLoading(false);
  };

  const loadProject = async (sessionId: string, projectId: string) => {
    try {
      // Load both projects and agents for the session
      const [projectsResponse, agentsResponse] = await Promise.all([
        fetch(`${config.apiBaseUrl}/api/guests/session/${sessionId}/projects`),
        fetch(`${config.apiBaseUrl}${config.api.agents.list(sessionId)}`).catch(() => null)
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
            name: agent.name,
            type: 'custom-ai-agent',
            description: agent.description,
            agent_id: agent.agent_id
          } as Project));
          allProjects.push(...agentsAsProjects);
        }
      }
      
      // Find the specific project by ID
      const project = allProjects.find((p: Project) => p.id === projectId);
      
      if (project) {
        setSelectedProject(project);
      } else {
        router.push(`/projects/${urlUserId}`);
        return;
      }
    } catch (error) {
      console.error('Error loading project:', error);
      router.push(`/projects/${urlUserId}`);
      return;
    }
  };

  const handleTabClick = (tab: 'build' | 'train' | 'publish') => {
    setActiveTab(tab);
    if (tab === 'train') {
      router.push(`/projects/${urlUserId}/${urlProjectId}/train`);
    } else if (tab === 'publish') {
      router.push(`/projects/${urlUserId}/${urlProjectId}/use-ai`);
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

  if (!isValidSession || !selectedProject) {
    return (
      <div className="min-h-screen bg-canvas text-fg">
        <Header />
        <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-3xl md:text-4xl font-semibold text-fg mb-4">
              Project Not Found
            </h1>
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

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <Header />

      <main className="pt-20">
        {/* Top Navigation Bar with Tabs */}
        <div className="bg-card border-b border-magenta-brand/20 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleTabClick('build')}
              className={`px-6 py-3 font-semibold text-sm transition-colors ${
                activeTab === 'build'
                  ? 'bg-purple-brand text-white'
                  : 'bg-raised text-fg hover:bg-raised-2'
              }`}
            >
              BUILD
            </button>
            <button
              onClick={() => handleTabClick('train')}
              className={`px-6 py-3 font-semibold text-sm transition-colors ${
                activeTab === 'train'
                  ? 'bg-purple-brand text-white'
                  : 'bg-raised text-fg hover:bg-raised-2'
              }`}
            >
              TRAIN
            </button>
            <button
              onClick={() => handleTabClick('publish')}
              className={`px-6 py-3 font-semibold text-sm transition-colors ${
                activeTab === 'publish'
                  ? 'bg-purple-brand text-white'
                  : 'bg-raised text-fg hover:bg-raised-2'
              }`}
            >
              PUBLISH
            </button>
          </div>

          <div className="flex items-center gap-4">
            {/* Preview Toggle */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-fg">Preview</span>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  showPreview ? 'bg-blue-500' : 'bg-raised-2'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform shadow-md ${
                    showPreview ? 'translate-x-7' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Settings/Customize Button */}
            <button className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center hover:bg-blue-600 transition-colors">
              <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex h-[calc(100vh-5rem)]">
          {/* Left Sidebar - CHANNELS */}
          {sidebarOpen && (
            <div className="w-72 bg-card border-r border-magenta-brand/20 p-6 overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-fg">CHANNELS</h3>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="text-fg hover:text-fg/80 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Chatbot Channel - Selected */}
                <button className="w-full flex flex-col items-center gap-2 px-4 py-6 rounded-lg bg-purple-brand/20 border-2 border-magenta-brand hover:bg-purple-brand/30 transition-colors">
                  <div className="w-16 h-16 bg-purple-brand rounded-lg flex items-center justify-center relative">
                    <svg className="w-8 h-8 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <div className="absolute bottom-0 right-0 w-4 h-4 bg-white rounded-full border-2 border-magenta-brand"></div>
                  </div>
                  <span className="font-medium text-fg text-sm">Chatbot</span>
                </button>

                {/* Standalone Channel */}
                <button className="w-full flex flex-col items-center gap-2 px-4 py-6 rounded-lg bg-raised/30 border-2 border-transparent hover:bg-raised/50 hover:border-raised-2 transition-colors">
                  <div className="w-16 h-16 bg-raised-2 rounded-lg flex items-center justify-center">
                    <svg className="w-8 h-8 text-fg/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <span className="font-medium text-fg/80 text-sm">Standalone</span>
                </button>

                {/* Salesforce Channel */}
                <button className="w-full flex flex-col items-center gap-2 px-4 py-6 rounded-lg bg-raised/30 border-2 border-transparent hover:bg-raised/50 hover:border-raised-2 transition-colors">
                  <div className="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center">
                    <span className="text-fg font-bold text-xl">S</span>
                  </div>
                  <span className="font-medium text-fg/80 text-sm">Salesforce</span>
                </button>
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div className="flex-1 flex">
            {/* Build Content Area */}
            <div className="flex-1 p-8 overflow-y-auto relative">
              <div>
                <h2 className="text-2xl font-bold text-fg mb-8">Knowledge Base & Rules</h2>
                
                {/* Knowledge Base Section */}
                <div className="bg-card rounded-xl p-6 mb-6 border border-magenta-brand/10">
                  <h3 className="text-lg font-semibold text-fg mb-6">Knowledge Base</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button className="bg-canvas border border-magenta-brand/20 rounded-lg p-5 text-left hover:border-magenta-brand/40 hover:bg-card transition-all">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-fg font-semibold mb-2">Add Text</h4>
                          <p className="text-sm text-fg/60">Add text content to knowledge base</p>
                        </div>
                        <svg className="w-6 h-6 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>

                    <button className="bg-canvas border border-magenta-brand/20 rounded-lg p-5 text-left hover:border-magenta-brand/40 hover:bg-card transition-all">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-fg font-semibold mb-2">Upload File</h4>
                          <p className="text-sm text-fg/60">Upload documents and files</p>
                        </div>
                        <svg className="w-6 h-6 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>

                    <button className="bg-canvas border border-magenta-brand/20 rounded-lg p-5 text-left hover:border-magenta-brand/40 hover:bg-card transition-all">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-fg font-semibold mb-2">Add Link</h4>
                          <p className="text-sm text-fg/60">Add web links and URLs</p>
                        </div>
                        <svg className="w-6 h-6 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>

                    <button className="bg-canvas border border-magenta-brand/20 rounded-lg p-5 text-left hover:border-magenta-brand/40 hover:bg-card transition-all">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-fg font-semibold mb-2">Q&A Pairs</h4>
                          <p className="text-sm text-fg/60">Add question and answer pairs</p>
                        </div>
                        <svg className="w-6 h-6 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Rules Section */}
                <div className="bg-card rounded-xl p-6 border border-magenta-brand/10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-fg">Rules</h3>
                    <button className="px-5 py-2.5 bg-purple-brand text-white rounded-lg hover:bg-purple-brand/80 transition-colors font-medium">
                      Add Rule
                    </button>
                  </div>
                  <p className="text-sm text-fg/60">Create rules to control agent behavior and responses</p>
                </div>
              </div>

              {/* Settings Gear Icon */}
              <button className="absolute right-8 top-8 w-12 h-12 bg-purple-brand rounded-full flex items-center justify-center hover:bg-purple-brand/80 transition-colors shadow-lg">
                <svg className="w-6 h-6 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>

            {/* Preview Panel */}
            {showPreview && (
              <div className="w-96 bg-card border-l border-magenta-brand/20 p-6 overflow-y-auto">
                <div className="sticky top-0 bg-card pb-4 mb-4 border-b border-magenta-brand/20">
                  <h3 className="text-lg font-semibold text-fg mb-4">Preview</h3>
                </div>
                
                {/* Chatbot Preview */}
                <div className="border-2 border-magenta-brand/30 rounded-lg p-4 bg-white">
                  {/* Chatbot Header */}
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b">
                    <div className="w-10 h-10 rounded-full bg-purple-brand flex items-center justify-center text-white font-semibold">
                      {selectedProject.name.charAt(0)}
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-800">{selectedProject.name}</h4>
                      <p className="text-xs text-fg/50">AI Agent</p>
                    </div>
                  </div>

                  {/* Chat Messages */}
                  <div className="space-y-3 mb-4 min-h-[200px]">
                    <div className="bg-gray-100 rounded-lg p-3">
                      <p className="text-sm text-gray-800">
                        Hello! I&apos;m {selectedProject.name}, your friendly AI Agent. How can I help you today?
                      </p>
                    </div>
                    <div className="bg-purple-brand/10 rounded-lg p-3 ml-auto max-w-[80%]">
                      <p className="text-sm text-gray-800">I would like to learn more.</p>
                    </div>
                  </div>

                  {/* Input Area */}
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Type your message..."
                        className="flex-1 px-3 py-2 border rounded-lg text-sm text-gray-800"
                        disabled
                      />
                      <button className="w-10 h-10 rounded-full bg-purple-brand flex items-center justify-center">
                        <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors">
                        Chat
                      </button>
                      <button className="px-3 py-1 text-xs text-fg/50 rounded hover:bg-gray-100 transition-colors">
                        Voice
                      </button>
                      <button className="px-3 py-1 text-xs text-fg/50 rounded hover:bg-gray-100 transition-colors">
                        Forms
                      </button>
                      <button className="px-3 py-1 text-xs text-fg/50 rounded hover:bg-gray-100 transition-colors">
                        History
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Sidebar Toggle Button (when closed) */}
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="fixed left-0 top-20 bottom-0 w-8 bg-card border-r border-magenta-brand/20 hover:bg-card transition-colors flex items-center justify-center"
              >
                <svg className="w-5 h-5 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

