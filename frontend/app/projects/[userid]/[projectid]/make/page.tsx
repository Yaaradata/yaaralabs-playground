'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Header from '../../../../../components/Header';
import config from '../../../../../lib/config';
import { 
  getSessionIdFromMaskedId, 
  isMaskedId, 
  isSessionId, 
  getOrCreateMaskedId,
  getProjectIdFromMaskedId,
  isMaskedProjectId,
  isProjectId
} from '../../../../../lib/session-utils';
import { cleanupSessionWithReason, SessionCleanupReason } from '../../../../../lib/session-cleanup';
import { SCRATCH_EDITOR_URL } from '@/config/scratch-editor';

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
}

export default function MakePage() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isValidSession, setIsValidSession] = useState(false);
  const [actualSessionId, setActualSessionId] = useState<string>('');
  const [actualProjectId, setActualProjectId] = useState<string>('');
  const [isLoadingProjectData, setIsLoadingProjectData] = useState(false);
  const [projectLabels, setProjectLabels] = useState<string[]>([]);

  const params = useParams();
  const urlUserId = params?.userid as string;
  const urlProjectId = params?.projectid as string;

  useEffect(() => {
    validateGuestSession();
  }, [urlUserId, urlProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear localStorage when component loads to ensure clean slate
  useEffect(() => {
    // Clear any existing ML extension data when this component loads
    const mlExtensionKeys = [
      'ml_extension_project_id',
      'ml_extension_session_id',
      'ml_extension_project_name',
      'ml_extension_project_labels'
    ];
    
    mlExtensionKeys.forEach(key => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        console.log(`Cleared localStorage key on component load: ${key}`);
      }
    });
    
    console.log('Component loaded - localStorage cleared for clean slate');
  }, []); // Only run once when component mounts

  // Monitor URL changes and update localStorage if project changes
  useEffect(() => {
    if (actualProjectId && actualSessionId && selectedProject) {
      // Check if the current URL project ID matches the actual project ID
      const currentUrl = window.location.href;
      const urlParts = currentUrl.split('/');
      const currentProjectIdInUrl = urlParts[urlParts.length - 2];
      
      if (currentProjectIdInUrl !== actualProjectId) {
        console.log('URL project ID mismatch detected:', {
          urlProjectId: currentProjectIdInUrl,
          actualProjectId: actualProjectId
        });
        
        // Clear old project data first
        const keysToClear = [
          'ml_extension_project_id',
          'ml_extension_session_id', 
          'ml_extension_project_name',
          'ml_extension_project_labels'
        ];
        keysToClear.forEach(key => localStorage.removeItem(key));
        
        // Also clear any other keys that start with ml_extension_
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('ml_extension_')) {
            localStorage.removeItem(key);
            console.log(`Cleared localStorage key on URL change: ${key}`);
          }
        });
        
        // Update localStorage to reflect the actual project being viewed
        localStorage.setItem('ml_extension_project_id', actualProjectId);
        localStorage.setItem('ml_extension_session_id', actualSessionId);
        localStorage.setItem('ml_extension_project_name', selectedProject.name);
        
        console.log('LocalStorage updated to reflect actual project:', {
          projectId: actualProjectId,
          sessionId: actualSessionId,
          projectName: selectedProject.name,
          oldDataCleared: true,
          aggressiveClearing: true
        });
        
        // Update the URL to match the actual project ID
        const newUrl = currentUrl.replace(`/${currentProjectIdInUrl}/`, `/${actualProjectId}/`);
        window.history.replaceState({}, '', newUrl);
        console.log('URL updated to match actual project:', newUrl);
      }
    }
  }, [actualProjectId, actualSessionId, selectedProject, urlProjectId]);

  // Cleanup function to remove project-specific data when component unmounts
  useEffect(() => {
    return () => {
      // Always clear ML extension data when component unmounts
      console.log('Component unmounting, clearing all ML extension localStorage data');
      const keysToClear = [
        'ml_extension_project_id',
        'ml_extension_session_id',
        'ml_extension_project_name',
        'ml_extension_project_labels'
      ];
      
      keysToClear.forEach(key => {
        if (localStorage.getItem(key)) {
          localStorage.removeItem(key);
          console.log(`Cleared localStorage key on unmount: ${key}`);
        }
      });
      
      // Also clear any other keys that start with ml_extension_
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('ml_extension_')) {
          localStorage.removeItem(key);
          console.log(`Cleared localStorage key on unmount: ${key}`);
        }
      });
    };
  }, []); // Always run cleanup regardless of dependencies

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
        window.location.href = `/projects/${maskedId}/${urlProjectId}/make`;
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
            setIsValidSession(true);
            
            // Clear any existing ML extension data when session becomes valid
            const mlExtensionKeys = [
              'ml_extension_project_id',
              'ml_extension_session_id',
              'ml_extension_project_name',
              'ml_extension_project_labels'
            ];
            
            mlExtensionKeys.forEach(key => localStorage.removeItem(key));
            console.log('Session validated - cleared existing ML extension data');
            
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
          localStorage.removeItem('yaaralabs_playground_session_id');
          localStorage.removeItem('yaaralabs_playground_session_created');
          window.location.href = '/projects';
          return;
        }
      } else {
        console.error('Session validation failed:', response.status);
        await cleanupSessionWithReason(SessionCleanupReason.ERROR_FALLBACK);
        window.location.href = '/projects';
        return;
      }
    } catch (error) {
      console.error('Error validating session:', error);
      localStorage.removeItem('yaaralabs_playground_session_id');
      localStorage.removeItem('yaaralabs_playground_session_created');
      window.location.href = '/projects';
      return;
    }
    setIsLoading(false);
  };

  const loadProject = async (sessionId: string, projectId: string) => {
    try {
      console.log('Loading project:', projectId, 'for session:', sessionId);
      
      // Clear any existing ML extension data first
      const mlExtensionKeys = [
        'ml_extension_project_id',
        'ml_extension_session_id',
        'ml_extension_project_name',
        'ml_extension_project_labels'
      ];
      
      mlExtensionKeys.forEach(key => localStorage.removeItem(key));
      console.log('Cleared existing ML extension data before loading new project');
      
      // Load all projects for the session and find the specific project
      const response = await fetch(`${config.apiBaseUrl}/api/guests/session/${sessionId}/projects`);
      
      if (response.ok) {
        const projectsResponse = await response.json();
        console.log('Projects response:', projectsResponse);
        
        if (projectsResponse.success && projectsResponse.data) {
          console.log('Available projects:', projectsResponse.data.map((p: Project) => ({ id: p.id, name: p.name })));
          
          // Find the specific project by ID
          const project = projectsResponse.data.find((p: Project) => p.id === projectId);
          
          if (project) {
            console.log('Found project:', project);
            setSelectedProject(project);
            
            // Clear any existing ML extension data before setting new project data
            const mlExtensionKeys = [
              'ml_extension_project_id',
              'ml_extension_session_id',
              'ml_extension_project_name',
              'ml_extension_project_labels'
            ];
            
            mlExtensionKeys.forEach(key => localStorage.removeItem(key));
            console.log('Cleared existing ML extension data before setting new project data');
            
            // Update localStorage with the current project information
            localStorage.setItem('ml_extension_project_id', projectId);
            localStorage.setItem('ml_extension_session_id', sessionId);
            localStorage.setItem('ml_extension_project_name', project.name);
            
            console.log('Project loaded and stored in localStorage:', {
              projectId: projectId,
              sessionId: sessionId,
              projectName: project.name,
              dataCleared: true,
              freshData: true
            });
          } else {
            // Project not found in the session's projects
            console.error('Project not found in session projects. Looking for:', projectId);
            console.error('Available project IDs:', projectsResponse.data.map((p: Project) => p.id));
            window.location.href = `/projects/${urlUserId}`;
            return;
          }
        } else {
          // No projects found or empty response
          console.error('No projects found for session or invalid response structure');
          window.location.href = `/projects/${urlUserId}`;
          return;
        }
      } else {
        // Failed to load projects
        console.error('Failed to load session projects:', response.status);
        window.location.href = `/projects/${urlUserId}`;
        return;
      }
    } catch (error) {
      console.error('Error loading session projects:', error);
      window.location.href = `/projects/${urlUserId}`;
      return;
    }
  };

  // Function to load project details and open Scratch
  const handleOpenScratch = async () => {
    if (!actualSessionId || !actualProjectId) {
      console.error('Cannot open Scratch: missing session or project ID');
      return;
    }

    setIsLoadingProjectData(true);
    try {
      console.log('Loading project details to open Scratch...');
      
      // Clear any existing ML extension data before loading new details
      const mlExtensionKeys = [
        'ml_extension_project_id',
        'ml_extension_session_id',
        'ml_extension_project_name',
        'ml_extension_project_labels'
      ];
      
      mlExtensionKeys.forEach(key => localStorage.removeItem(key));
      console.log('Cleared existing ML extension data before loading project details');
      
      const response = await fetch(`${config.apiBaseUrl}/api/guests/session/${actualSessionId}/projects/${actualProjectId}`);
      
      if (response.ok) {
        const projectResponse = await response.json();
        console.log('Project details response:', projectResponse);
        
        if (projectResponse.success && projectResponse.data) {
          const details = projectResponse.data;
          
          // Extract labels from the model
          if (details.model && Array.isArray(details.model.labels)) {
            const labels = details.model.labels;
            setProjectLabels(labels);
            
            // Store labels in localStorage for the ML extension
            localStorage.setItem('ml_extension_project_labels', JSON.stringify(labels));
            
            console.log('Project labels loaded:', labels);
            console.log('Labels stored in localStorage for ML extension');
          } else {
            console.warn('No labels found in project model');
            setProjectLabels([]);
            localStorage.setItem('ml_extension_project_labels', '[]');
          }
          
          // Ensure localStorage has the current project information
          localStorage.setItem('ml_extension_project_id', actualProjectId);
          localStorage.setItem('ml_extension_session_id', actualSessionId);
          localStorage.setItem('ml_extension_project_name', selectedProject?.name || 'Unknown Project');
          
          // Open the Scratch GUI running on port 8601 with session and project parameters
          const scratchGuiUrl = `${SCRATCH_EDITOR_URL}/?sessionId=${actualSessionId}&projectId=${actualProjectId}`;
          window.open(scratchGuiUrl, '_blank');
          
          console.log('Scratch opened with fresh project data:', {
            sessionId: actualSessionId,
            projectId: actualProjectId,
            projectName: selectedProject?.name,
            labels: projectLabels,
            storedInLocalStorage: true,
            localStorageKeys: {
              projectId: 'ml_extension_project_id',
              sessionId: 'ml_extension_session_id',
              projectName: 'ml_extension_project_name',
              labels: 'ml_extension_project_labels'
            },
            oldDataCleared: true,
            aggressiveClearing: true
          });
        } else {
          console.error('Failed to load project details:', projectResponse);
        }
      } else {
        console.error('Failed to fetch project details:', response.status);
      }
    } catch (error) {
      console.error('Error loading project details:', error);
    } finally {
      setIsLoadingProjectData(false);
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
              Invalid Session or Project
            </h1>
            <p className="text-lg text-fg mb-8">
              Please return to your projects and try again.
            </p>
            <a 
              href={`/projects/${urlUserId}`}
              className="bg-purple-brand text-white px-8 py-4 rounded-lg text-lg font-medium hover:scale-105 transition-all duration-300 inline-block"
            >
              Back to Projects
            </a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <Header />

      <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div>
          {/* Back to Project Navigation */}
          <div className="flex items-center mb-8">
            <a
              href={`/projects/${urlUserId}/${urlProjectId}`}
              className="p-2 text-fg/70 hover:text-white hover:bg-purple-brand/10 rounded-lg transition-all duration-300 flex items-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to project
            </a>
          </div>

          {/* Main Heading */}
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-bold text-fg">
              Make something with your machine learning model
            </h1>
          </div>

          {/* Integration Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            
            {/* Scratch 3 Card */}
            <div className="bg-canvas border-2 border-magenta-brand/20 rounded-lg p-6 shadow-lg">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-fg mb-3">Scratch 3</h2>
                <p className="text-pink-brand text-sm mb-4">
                  Use your machine learning model in Scratch
                </p>
                
                {/* Action Button */}
                <button 
                  onClick={handleOpenScratch}
                  disabled={isLoadingProjectData}
                  className="bg-purple-brand hover:bg-purple-brand/90 text-white px-6 py-2 rounded-lg font-medium text-sm transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoadingProjectData ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-canvas mx-auto mb-2"></div>
                      <span>Loading...</span>
                    </>
                  ) : (
                    'Open Scratch Editor'
                  )}
                </button>
                
                {/* Scratch Image */}
                <div className="mt-4">
                  <img src="/image.png" alt="Scratch Integration" className="w-full h-auto rounded-lg" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}