'use client';

import { useState, useEffect } from 'react';
import { useParams, usePathname } from 'next/navigation';
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
import { checkGuestSession, leaveAfterFailedCheck } from '../../../../../lib/session-cleanup';
import Link from 'next/link';
import { ImageUpload, ImageGallery } from '../../../../../components/ImageCollection';
import SampleLabeller from '../../../../../components/SampleLabelling/SampleLabeller';
import { SAMPLE_SOURCES, batches, standardLabelNames, type NewExample, type SampleSource } from '../../../../../components/SampleLabelling/sample';
import SampleImagesDialog from '../../../../../components/SampleImages/SampleImagesDialog';
import { MIN_IMAGES_PER_LABEL, labelNamesKey } from '../../../../../components/SampleImages/sampleImages';
import { labelProblem, LABEL_MAX } from '../../../../../lib/labels';

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

interface Example {
  id: string;
  text: string;
  createdAt: string;
}

interface Label {
  id: string;
  name: string;
  examples: Example[];
  createdAt: string;
}

export default function TrainPage() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [showAddLabelModal, setShowAddLabelModal] = useState(false);
  const [showAddExampleModal, setShowAddExampleModal] = useState(false);
  const [selectedLabelId, setSelectedLabelId] = useState<string>('');
  const [newLabelName, setNewLabelName] = useState('');
  const [newExampleText, setNewExampleText] = useState('');
  const [guestSession, setGuestSession] = useState<GuestSession | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isValidSession, setIsValidSession] = useState(false);
  const [actualSessionId, setActualSessionId] = useState<string>('');
  const [actualProjectId, setActualProjectId] = useState<string>('');

  const [isSubmittingToAPI, setIsSubmittingToAPI] = useState(false);
  const [isDeletingExample, setIsDeletingExample] = useState(false);
  const [deletingExampleId, setDeletingExampleId] = useState<string | null>(null);
  const [isDeletingLabel, setIsDeletingLabel] = useState(false);
  const [deletingLabelId, setDeletingLabelId] = useState<string | null>(null);
  const [deletingLabels, setDeletingLabels] = useState<Set<string>>(new Set());
  const [deletingExamplesByLabel, setDeletingExamplesByLabel] = useState<Set<string>>(new Set());
  const [hasInitialDataLoaded, setHasInitialDataLoaded] = useState(false);
  const [lastDataRefresh, setLastDataRefresh] = useState<number>(0);
  
  // Image collection state
  const [images, setImages] = useState<{ label: string; image_url: string; id: string; filename: string }[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [showSampleImages, setShowSampleImages] = useState(false);

  // Image delete state
  const [isDeletingImageLabel, setIsDeletingImageLabel] = useState(false);
  const [isDeletingImageExamples, setIsDeletingImageExamples] = useState(false);
  const [deletingImageLabelId, setDeletingImageLabelId] = useState<string | null>(null);
  const [deletingImageExampleId, setDeletingImageExampleId] = useState<string | null>(null);
  const [sampleSource, setSampleSource] = useState<SampleSource | null>(null);

  const params = useParams();
  const urlUserId = params?.userid as string;
  const urlProjectId = params?.projectid as string;
  const pathname = usePathname();

  useEffect(() => {
    validateGuestSession();
  }, [urlUserId, urlProjectId, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add focus event listener to detect when user returns to the train page
  useEffect(() => {
    const handleFocus = () => {
      // Only reload data if we have valid session and project IDs, and initial data was loaded before
      if (actualSessionId && actualProjectId && isValidSession && hasInitialDataLoaded) {
        console.log('🔄 User returned to train page, reloading existing data...');
        refreshExamplesFromAPI();
      }
    };

    // Listen for when the window/tab becomes focused
    window.addEventListener('focus', handleFocus);
    
    // Also listen for visibility change (when user switches back to tab)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && actualSessionId && actualProjectId && isValidSession && hasInitialDataLoaded) {
        console.log('🔄 Tab became visible, reloading existing data...');
        refreshExamplesFromAPI();
      }
    });

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [actualSessionId, actualProjectId, isValidSession, hasInitialDataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Comprehensive data refresh effect - handles all cases when user returns to train page
  useEffect(() => {
    // Only reload data if we have valid session and project IDs, and initial data was loaded before
    if (pathname.includes('/train') && actualSessionId && actualProjectId && isValidSession && hasInitialDataLoaded) {
      console.log('🔄 User on train page with valid session, ensuring data is fresh...');
      
      // Add a small delay to avoid immediate API calls during navigation
      const timer = setTimeout(() => {
        // Only refresh if we haven't refreshed recently
        const now = Date.now();
        if (now - lastDataRefresh > 5000) {
          refreshExamplesFromAPI();
        } else {
          console.log('🔄 Data was refreshed recently, skipping refresh...');
        }
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [pathname, actualSessionId, actualProjectId, isValidSession, hasInitialDataLoaded, lastDataRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Immediate data loading when component has valid session and project IDs
  useEffect(() => {
    if (actualSessionId && actualProjectId && isValidSession && !hasInitialDataLoaded) {
      console.log('🔄 Component has valid session, loading data immediately...');
      // Small delay to ensure component is fully mounted
      const timer = setTimeout(() => {
        refreshExamplesFromAPI();
      }, 200);
      
      return () => clearTimeout(timer);
    }
  }, [actualSessionId, actualProjectId, isValidSession, hasInitialDataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load images for image-recognition projects
  useEffect(() => {
    if (actualSessionId && actualProjectId && isValidSession && selectedProject?.type === 'image-recognition') {
      loadImages();
    }
  }, [actualSessionId, actualProjectId, isValidSession, selectedProject?.type]); // eslint-disable-line react-hooks/exhaustive-deps

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
        window.location.href = `/projects/${maskedId}/${urlProjectId}/train`;
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

      // Validate session with backend API. Only a session the backend says is gone (404, inactive,
      // expired) is cleaned up; a server error or network blip keeps it (see checkGuestSession).
      const check = await checkGuestSession<GuestSessionResponse>(sessionId);
      if (check.kind !== 'valid') {
        await leaveAfterFailedCheck(check);
        return;
      }
      const sessionResponse = check.response;

      // Check if this is a new session or if we're returning to an existing valid session
      const isReturningToValidSession = actualSessionId === sessionId && actualProjectId === projectId && isValidSession;
      
      setActualSessionId(sessionId);
      setActualProjectId(projectId);
      setGuestSession(sessionResponse.data);
      setIsValidSession(true);
      
      if (isReturningToValidSession && hasInitialDataLoaded) {
        // We're returning to a valid session, just refresh the data
        console.log('🔄 Returning to valid session, refreshing data...');
        await refreshExamplesFromAPI();
      } else {
        // New session or first time loading, load project and labels
        console.log('🔄 New session or first time loading, loading project and labels...');
        await loadProjectAndLabels(sessionId, projectId);
      }
    } catch (error) {
      // Could not reach the server (network blip, server restarting): keep the session, so the
      // learner's projects are still there when they come back
      console.error('Error validating session:', error);
      window.location.href = '/projects';
      return;
    }
    setIsLoading(false);
  };

  const saveLocalLabels = (sessionId: string, projectId: string, localLabels: Label[]) => {
    try {
      const labelsKey = `yaaralabs_playground_local_labels_${sessionId}_${projectId}`;
      localStorage.setItem(labelsKey, JSON.stringify(localLabels));
    } catch (error) {
      console.error('Error saving local labels:', error);
    }
  };

  const loadLocalLabels = (sessionId: string, projectId: string): Label[] => {
    try {
      const labelsKey = `yaaralabs_playground_local_labels_${sessionId}_${projectId}`;
      const savedLabels = localStorage.getItem(labelsKey);
      if (savedLabels) {
        return JSON.parse(savedLabels);
      }
    } catch (error) {
      console.error('Error loading local labels:', error);
    }
    return [];
  };

  const mergeLabels = (apiLabels: Label[], localLabels: Label[]): Label[] => {
    // Create a map of API labels by name for quick lookup
    const apiLabelsMap = new Map(apiLabels.map(label => [label.name, label]));
    
    // Start with API labels
    const mergedLabels = [...apiLabels];
    
    // Add local labels that don't exist in API yet
    localLabels.forEach(localLabel => {
      if (!apiLabelsMap.has(localLabel.name)) {
        // This is a locally created label that hasn't been submitted to API yet
        mergedLabels.push(localLabel);
      }
    });
    
    return mergedLabels;
  };

  // Unified label management function that combines text and image labels
  const createUnifiedLabels = (textLabels: Label[], imageLabels: string[], apiLabels: string[]) => {
    // Create a map to track all labels and their sources
    const labelMap = new Map<string, { label: Label; sources: Set<string> }>();
    
    // Add text labels (from examples)
    textLabels.forEach(label => {
      labelMap.set(label.name, { label, sources: new Set(['text']) });
    });
    
    // Add image labels (from images)
    imageLabels.forEach(labelName => {
      if (labelMap.has(labelName)) {
        labelMap.get(labelName)!.sources.add('image');
      } else {
        // Create a new label for image-only labels
        const newLabel: Label = {
          id: `label-${Date.now()}-${Math.random()}`,
          name: labelName,
          examples: [], // Image labels don't have text examples
          createdAt: new Date().toLocaleDateString()
        };
        labelMap.set(labelName, { label: newLabel, sources: new Set(['image']) });
      }
    });
    
    // Add API labels (from backend labels list)
    apiLabels.forEach(labelName => {
      if (labelMap.has(labelName)) {
        labelMap.get(labelName)!.sources.add('api');
      } else {
        // Create a new label for API-only labels (empty labels)
        const newLabel: Label = {
          id: `label-${Date.now()}-${Math.random()}`,
          name: labelName,
          examples: [],
          createdAt: new Date().toLocaleDateString()
        };
        labelMap.set(labelName, { label: newLabel, sources: new Set(['api']) });
      }
    });
    
    // Create ordered labels: new labels first, then existing labels in their original order
    const orderedLabels: Label[] = [];
    const seenLabels = new Set<string>();
    
    // First, add all labels in the order they appear in the API labels (maintains backend order)
    apiLabels.forEach(labelName => {
      if (labelMap.has(labelName) && !seenLabels.has(labelName)) {
        orderedLabels.push(labelMap.get(labelName)!.label);
        seenLabels.add(labelName);
      }
    });
    
    // Then add any remaining labels (image-only or text-only labels not in API)
    labelMap.forEach(({ label }, labelName) => {
      if (!seenLabels.has(labelName)) {
        orderedLabels.unshift(label); // Add new labels at the top
        seenLabels.add(labelName);
      }
    });
    
    return orderedLabels;
  };

  const refreshExamplesFromAPI = async (forceRefresh = false) => {
    if (!actualSessionId || !actualProjectId) return;
    
    // Only apply cooldown for automatic refreshes, not for forced refreshes after API operations
    if (!forceRefresh) {
      const now = Date.now();
      if (now - lastDataRefresh < 5000) {
        console.log('🔄 Data was refreshed recently, skipping refresh...');
        return;
      }
    }
    
    try {
      console.log('🔄 Refreshing examples from API' + (forceRefresh ? ' (forced refresh)' : ''));
      
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.examples(actualSessionId, actualProjectId)}`);
      
      if (response.ok) {
        const result: { success: boolean; examples?: Array<{ id?: string; text: string; label: string; createdAt?: string }>; labels?: string[] } = await response.json();
        console.log('✅ Examples refreshed from API:', result);
        
        if (result.success) {
          // Group examples by label
          const examplesByLabel: { [key: string]: Example[] } = {};
          
          // Process examples if they exist
          if (result.examples && result.examples.length > 0) {
            result.examples.forEach((example) => {
              if (!examplesByLabel[example.label]) {
                examplesByLabel[example.label] = [];
              }
              examplesByLabel[example.label].push({
                id: example.id || `example-${Date.now()}-${Math.random()}`,
                text: example.text,
                createdAt: example.createdAt || new Date().toLocaleDateString()
              });
            });
          }
          
          // Create text labels from API labels list (includes empty labels)
          const textLabels: Label[] = [];
          const apiLabels = result.labels || [];
          
          // Use API labels list to preserve empty labels, not just labels from examples
          apiLabels.forEach(labelName => {
            textLabels.push({
              id: `label-${Date.now()}-${Math.random()}`,
              name: labelName,
              examples: examplesByLabel[labelName] || [], // Examples will be empty for empty labels
              createdAt: new Date().toLocaleDateString()
            });
          });
          
          // Get image labels from current images state
          const imageLabels = [...new Set(images.map(img => img.label).filter(Boolean))];
          
          // Use unified label management to combine all sources
          const unifiedLabels = createUnifiedLabels(textLabels, imageLabels, []);
          
          // Load locally saved labels to preserve any locally created labels
          const localLabels = loadLocalLabels(actualSessionId, actualProjectId);
          
          // Merge with local labels, preserving local labels that don't exist in unified labels yet
          const mergedLabels = mergeLabels(unifiedLabels, localLabels);
          
          console.log('🔄 Updating labels with unified data (text + image + API + local):', mergedLabels);
          setLabels(mergedLabels);
          
          // Set flag that initial data has been loaded
          if (!hasInitialDataLoaded) {
            setHasInitialDataLoaded(true);
            console.log('✅ Initial data loaded successfully');
          }
          
          // Update last refresh timestamp
          setLastDataRefresh(Date.now());
          
          // Don't save merged data to localStorage - only save local labels separately
        }
      } else {
        // Handle specific error cases gracefully
        if (response.status === 404) {
          // Project might have been deleted - this is expected, don't show error
          console.log('⚠️ Project not found (may have been deleted), skipping refresh');
        } else {
          console.error('❌ Failed to refresh examples from API:', response.status);
        }
      }
    } catch (error) {
      // Only log errors that aren't related to navigation/unmounting
      if (error instanceof Error && !error.message.includes('aborted')) {
        console.error('❌ Error refreshing examples from API:', error);
      }
    } finally {
      // Always mark as loaded after API call completes, regardless of success/failure
      if (!hasInitialDataLoaded) {
        setHasInitialDataLoaded(true);
        console.log('✅ Initial data load completed');
      }
    }
  };

  const loadProjectAndLabels = async (sessionId: string, projectId: string) => {
    try {
      console.log('Loading project and labels for session:', sessionId, 'project:', projectId);
      
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
            
            // Load labels for this project from API instead of localStorage
            await refreshExamplesFromAPI();
            
            // Ensure hasInitialDataLoaded is set even if refreshExamplesFromAPI didn't set it
            if (!hasInitialDataLoaded) {
              setHasInitialDataLoaded(true);
              console.log('✅ Project loaded successfully, marking initial data as loaded');
            }
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
      console.error('Error loading project and labels:', error);
      
      // Even on error, mark as loaded so refresh mechanisms work
      if (!hasInitialDataLoaded) {
        setHasInitialDataLoaded(true);
        console.log('✅ Initial data load completed (with error)');
      }
      
      window.location.href = `/projects/${urlUserId}`;
      return;
    }
  };

  const submitExamplesToAPI = async (labelName: string, examples: Example[]) => {
    // Validation checks
    if (!actualSessionId || !actualProjectId) {
      console.log('❌ Missing session or project ID:', { actualSessionId, actualProjectId });
      return false;
    }

    if (examples.length === 0) {
      console.log('❌ No examples to submit');
      return false;
    }

    if (!labelName || labelName.trim().length === 0) {
      console.error('❌ Label name is empty or invalid:', labelName);
      alert('Label name cannot be empty');
      return false;
    }

    // Filter out empty examples
    const validExamples = examples.filter(example => 
      example && example.text && example.text.trim().length > 0
    );

    if (validExamples.length === 0) {
      console.log('❌ No valid examples to submit after filtering');
      return false;
    }

    try {
      setIsSubmittingToAPI(true);
      
      // Use the correct API format as specified
      const payload = {
        examples: validExamples.map(example => ({
          text: example.text.trim(),
          label: labelName.trim()
        }))
      };

      console.log('🚀 Submitting examples to API');
      console.log('📋 Payload:', JSON.stringify(payload, null, 2));
      console.log('📊 Examples count:', validExamples.length);
      console.log('🏷️ Label:', labelName);
      
      const apiUrl = `${config.apiBaseUrl}${config.api.guests.examples(actualSessionId, actualProjectId)}`;
      console.log('🌐 API URL:', apiUrl);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log('📤 Response Status:', response.status);

             if (response.ok) {
         const result = await response.json();
         console.log('✅ Successfully submitted examples to API:', result);
         
         // Remove this label from local storage since it's now on the API
         const currentLocalLabels = loadLocalLabels(actualSessionId, actualProjectId);
         const updatedLocalLabels = currentLocalLabels.filter(label => label.name !== labelName);
         saveLocalLabels(actualSessionId, actualProjectId, updatedLocalLabels);
         
         return true;
       } else {
        console.error('❌ API submission failed:', response.status);
        
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('📋 Error Details:', errorDetails);
        } catch (jsonError) {
          const errorText = await response.text();
          console.error('📝 Error Text:', errorText);
          errorDetails = { message: errorText };
        }

        // Show the server's reason: a string (limits: "Add at most 50 examples at a time", "at most 500
        // examples"), or FastAPI's list of field errors (e.g. an example over 500 characters)
        const detail = errorDetails?.detail;
        const reason =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.some((d: { type?: string }) => String(d?.type).includes('too_long'))
                ? 'An example can be at most 500 characters, and a label at most 50.'
                : detail.map((d: { msg?: string }) => d?.msg).filter(Boolean).join('; ')
              : errorDetails?.message;
        if (response.status === 404) {
          alert('API endpoint not found. Please check if the server is running.');
        } else if (response.status >= 500) {
          alert('Server error. Please try again later.');
        } else {
          alert(reason || 'Could not add these examples.');
        }

        return false;
      }
    } catch (error) {
      console.error('❌ Network error submitting examples to API:', error);
      alert('Network error: Failed to connect to the server. Please check your connection.');
      return false;
    } finally {
      setIsSubmittingToAPI(false);
    }
  };

  // Submit examples immediately to API
  const submitExampleImmediately = async (labelName: string, exampleText: string) => {
    const example: Example = {
      id: `example-${Date.now()}`,
      text: exampleText.trim(),
      createdAt: new Date().toLocaleDateString()
    };

    // Submit to API immediately
    const success = await submitExamplesToAPI(labelName, [example]);
    
    if (success) {
      console.log('✅ Example submitted successfully to API');
    } else {
      console.log('❌ Failed to submit example to API');
    }
    
    return success;
  };

  /** "Create standard labels": add the four standard labels that are not in the project yet, in order. */
  const handleCreateStandardLabels = () => {
    if (!actualSessionId || !actualProjectId) return;
    const have = new Set(labels.map((l) => l.name.toLowerCase()));
    const now = Date.now();
    const created: Label[] = standardLabelNames()
      .filter((name) => !have.has(name.toLowerCase()))
      .map((name, i) => ({ id: `label-${now}-${i}`, name, examples: [], createdAt: new Date().toLocaleDateString() }));
    if (created.length === 0) return;
    setLabels([...created, ...labels]);
    saveLocalLabels(actualSessionId, actualProjectId, [...created, ...loadLocalLabels(actualSessionId, actualProjectId)]);
  };

  /** "Finish labelling" from the sample labelling table: add each query whole (no comma splitting),
   *  skipping any text already under that label, then show the labels like hand-made ones. */
  const handleGroupSample = async (items: NewExample[]) => {
    if (!actualSessionId || !actualProjectId) throw new Error('Your session is not ready yet. Please reload the page.');
    const url = `${config.apiBaseUrl}${config.api.guests.examples(actualSessionId, actualProjectId)}`;
    for (const batch of batches(items, 50)) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examples: batch, split: false, skip_existing: true }),
      });
      if (!response.ok) {
        let detail = '';
        try {
          detail = (await response.json())?.detail ?? '';
        } catch {
          /* no body */
        }
        throw new Error(`Could not add the examples${detail ? `: ${detail}` : ''}. Nothing you added before was changed.`);
      }
    }
    // Labels created by hand but still empty live only in this browser; they now exist on the server
    const added = new Set(items.map((i) => i.label));
    saveLocalLabels(actualSessionId, actualProjectId, loadLocalLabels(actualSessionId, actualProjectId).filter((l) => !added.has(l.name)));
    await refreshExamplesFromAPI(true);
  };

  const handleAddLabel = async () => {
    if (newLabelName.trim() && actualSessionId && actualProjectId) {
      // Validate label name: letters in any script, numbers, spaces, - _ &; 50 characters; no case-only duplicate
      const validLabelName = newLabelName.trim();
      const problem = labelProblem(validLabelName, labels.map((l) => l.name));
      if (problem) {
        alert(problem);
        return;
      }
      
      const newLabel: Label = {
        id: `label-${Date.now()}`,
        name: validLabelName,
        examples: [],
        createdAt: new Date().toLocaleDateString()
      };
      
      // Add new label at the top of the list
      const updatedLabels = [newLabel, ...labels];
      setLabels(updatedLabels);
      
      // Save only the new local label to localStorage (also at the top)
      const currentLocalLabels = loadLocalLabels(actualSessionId, actualProjectId);
      const updatedLocalLabels = [newLabel, ...currentLocalLabels];
      saveLocalLabels(actualSessionId, actualProjectId, updatedLocalLabels);
      
      // Label created successfully - examples will be submitted when added
      // Don't submit empty labels to API as they might cause validation errors
      console.log('Label created locally, will submit to API when examples are added');
      
      setNewLabelName('');
      setShowAddLabelModal(false);
    }
  };

  const handleAddExample = async () => {
    if (newExampleText.trim() && selectedLabelId && actualSessionId && actualProjectId) {
      // Find the label name for API submission
      const label = labels.find(l => l.id === selectedLabelId);
      if (!label) {
        alert('Label not found');
        return;
      }

      // Submit to API immediately
      const success = await submitExampleImmediately(label.name, newExampleText.trim());
      
      if (success) {
                 // Refresh from API to ensure sync - this will update the UI with the correct state
         await refreshExamplesFromAPI(true);
         
         // Reset form and close modal
        setNewExampleText('');
        setSelectedLabelId('');
        setShowAddExampleModal(false);
      } else {
        alert('Failed to submit example to API. Please try again.');
      }
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, labelId: string) => {
    const file = event.target.files?.[0];
    if (!file || !actualSessionId || !actualProjectId) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (text) {
        // Split text by lines and filter out empty lines; at most 500 lines (a project's limit)
        const MAX_LINES = 500;
        const BATCH = 50; // the server takes at most 50 examples per request
        const allLines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (allLines.length > MAX_LINES) {
          alert(`This file has ${allLines.length} lines. Only the first ${MAX_LINES} are added.`);
        }
        const lines = allLines.slice(0, MAX_LINES);
        
        // Find the label name for API submission
        const label = labels.find(l => l.id === labelId);
        if (!label) {
          alert('Label not found');
          return;
        }

        console.log(`📁 Processing file upload: ${lines.length} examples for label "${label.name}"`);

        // Submit all examples to API immediately
        const newExamples: Example[] = lines.map(line => ({
          id: `example-${Date.now()}-${Math.random()}`,
          text: line.trim(),
          createdAt: new Date().toLocaleDateString()
        }));

        let success = true;
        for (let i = 0; i < newExamples.length && success; i += BATCH) {
          success = await submitExamplesToAPI(label.name, newExamples.slice(i, i + BATCH));
        }
        
        // Refresh from the API either way: batches added before a refused one are kept and shown
        // (submitExamplesToAPI already told the learner why a batch was refused)
        await refreshExamplesFromAPI(true);
        if (success) console.log(`✅ Successfully uploaded ${newExamples.length} examples from file`);
      }
    };
    reader.readAsText(file);
    
    // Reset the input
    event.target.value = '';
  };

  const handleDeleteLabel = async (labelId: string) => {
    if (!actualSessionId || !actualProjectId) return;
    
    // Find the label to get the label name
    const label = labels.find(l => l.id === labelId);
    if (!label) {
      alert('Label not found');
      return;
    }
    
    // Show confirmation dialog
    if (!confirm(`Are you sure you want to delete the label "${label.name}"${label.examples.length > 0 ? ` and all ${label.examples.length} examples` : ''}? This action cannot be undone.`)) {
      return;
    }
    
    setDeletingLabels(prev => new Set(prev).add(labelId));
    setDeletingLabelId(labelId);
    
    try {
      console.log('🗑️ Deleting label via API:', label.name);
      console.log('Session ID:', actualSessionId);
      console.log('Project ID:', actualProjectId);
      console.log('Label:', label.name);
      console.log('Examples count:', label.examples.length);
      
      // Use the new delete label endpoint that handles both cases
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.deleteLabel(actualSessionId, actualProjectId, label.name)}?session_id=${actualSessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('🗑️ Delete Label API Response Status:', response.status);
      
             if (response.ok) {
         const result = await response.json();
         console.log('✅ Label deleted successfully:', result);
         
         // Remove this label from local storage since it's been deleted from API
         const currentLocalLabels = loadLocalLabels(actualSessionId, actualProjectId);
         const updatedLocalLabels = currentLocalLabels.filter(localLabel => localLabel.name !== label.name);
         saveLocalLabels(actualSessionId, actualProjectId, updatedLocalLabels);
         
         // Refresh from API to ensure sync - this will update the UI with the correct state
         await refreshExamplesFromAPI(true);
         
                 // Success - no alert needed, UI will update automatically
       } else {
        console.error('❌ Delete Label API failed:', response.status);
        
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('📋 Error Details:', errorDetails);
        } catch (jsonError) {
          const errorText = await response.text();
          console.error('📝 Error Text:', errorText);
          errorDetails = { detail: errorText };
        }
        
        // Show user-friendly error
        if (response.status === 404) {
          alert('Label not found. It may have already been deleted.');
        } else if (response.status === 403) {
          alert('Access denied. You do not have permission to delete this label.');
        } else if (response.status === 500) {
          alert('Server error occurred while deleting the label. Please try again later.');
        } else {
          alert(`Failed to delete label (${response.status}): ${errorDetails.detail || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('❌ Network error during label deletion:', error);
      alert('Network error: Failed to connect to the server. Please check your connection and try again.');
    } finally {
      setDeletingLabels(prev => {
        const newSet = new Set(prev);
        newSet.delete(labelId);
        return newSet;
      });
      setDeletingLabelId(null);
    }
  };

    const handleDeleteEmptyLabel = async (labelId: string) => {
    if (!actualSessionId || !actualProjectId) return;
    
    // Find the label to get the label name
    const label = labels.find(l => l.id === labelId);
    if (!label) {
      alert('Label not found');
      return;
    }
    
    if (label.examples.length > 0) {
      alert('This label has examples. Please delete all examples first or use the "Delete Label" button to delete both label and examples.');
      return;
    }
    
    // Show confirmation dialog
    if (!confirm(`Are you sure you want to delete the empty label "${label.name}"? This action cannot be undone.`)) {
      return;
    }
    
    setDeletingLabels(prev => new Set(prev).add(labelId));
    
    try {
             // Check if this is a truly local label (never had examples) or an API-known label
       // Local labels: label-1234567890 (created locally, never submitted to API)
       // API-known labels: label-1234567890-0.123456 (created from API response)
       const isLocalLabel = label.id.startsWith('label-') && !label.id.includes('-', 6);
      
      if (isLocalLabel) {
        // This is a locally created label that never had examples - delete locally
        console.log('🗑️ Deleting local empty label:', label.name);
        
        // Remove from frontend state
        setLabels(prevLabels => prevLabels.filter(l => l.id !== labelId));
        
        // Remove from local storage
        const currentLocalLabels = loadLocalLabels(actualSessionId, actualProjectId);
        const updatedLocalLabels = currentLocalLabels.filter(localLabel => localLabel.name !== label.name);
        saveLocalLabels(actualSessionId, actualProjectId, updatedLocalLabels);
        
        console.log('✅ Local empty label deleted successfully from frontend');
        
        // Success - no alert needed, UI will update automatically
      } else {
        // This is an API-known label that had examples before - delete via API
        console.log('🗑️ Deleting API-known empty label via API:', label.name);
        
        const response = await fetch(`${config.apiBaseUrl}${config.api.guests.deleteEmptyLabel(actualSessionId, actualProjectId, label.name)}?session_id=${actualSessionId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        console.log('🗑️ Delete Empty Label API Response Status:', response.status);
        
        if (response.ok) {
          const result = await response.json();
          console.log('✅ API-known empty label deleted successfully:', result);
          
          // Remove this label from local storage since it's been deleted from API
          const currentLocalLabels = loadLocalLabels(actualSessionId, actualProjectId);
          const updatedLocalLabels = currentLocalLabels.filter(localLabel => localLabel.name !== label.name);
          saveLocalLabels(actualSessionId, actualProjectId, updatedLocalLabels);
          
          // Refresh from API to ensure sync
          await refreshExamplesFromAPI(true);
          
          // Success - no alert needed, UI will update automatically
        } else {
          console.error('❌ Delete Empty Label API failed:', response.status);
          
          let errorDetails;
          try {
            errorDetails = await response.json();
            console.error('📋 Error Details:', errorDetails);
          } catch (jsonError) {
            const errorText = await response.text();
            console.error('📝 Error Text:', errorText);
            errorDetails = { detail: errorText };
          }
          
          // Show user-friendly error
          if (response.status === 400) {
            alert(errorDetails.detail || 'This label has examples and cannot be deleted as an empty label.');
          } else if (response.status === 404) {
            alert('Label not found. It may have already been deleted.');
          } else if (response.status === 500) {
            alert('Server error occurred while deleting the label. Please try again later.');
          } else {
            alert(`Failed to delete empty label (${response.status}): ${errorDetails.detail || 'Unknown error'}`);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error during empty label deletion:', error);
      alert('Error occurred while deleting the label. Please try again.');
    } finally {
      setDeletingLabels(prev => {
        const newSet = new Set(prev);
        newSet.delete(labelId);
        return newSet;
      });
    }
  };

  const handleDeleteExample = async (labelId: string, exampleId: string) => {
    if (!actualSessionId || !actualProjectId) return;
    
    // Find the label and example to get the label name and example index
    const label = labels.find(l => l.id === labelId);
    if (!label) {
      alert('Label not found');
      return;
    }
    
    const exampleIndex = label.examples.findIndex(ex => ex.id === exampleId);
    if (exampleIndex === -1) {
      alert('Example not found');
      return;
    }
    
    // Show confirmation dialog
    if (!confirm(`Are you sure you want to delete the example "${label.examples[exampleIndex].text.substring(0, 50)}..." from the "${label.name}" label?`)) {
      return;
    }
    
    setIsDeletingExample(true);
    setDeletingExampleId(exampleId);
    
    try {
      console.log('🗑️ Deleting example via API');
      console.log('Session ID:', actualSessionId);
      console.log('Project ID:', actualProjectId);
      console.log('Label:', label.name);
      console.log('Example Index:', exampleIndex);
      
             const response = await fetch(`${config.apiBaseUrl}${config.api.guests.deleteSpecificExample(actualSessionId, actualProjectId, label.name, exampleIndex)}?session_id=${actualSessionId}`, {
         method: 'DELETE',
         headers: {
           'Content-Type': 'application/json',
         },
       });
      
      console.log('🗑️ Delete Example API Response Status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Example deleted successfully:', result);
        
        // Refresh from API to ensure sync - this will update the UI with the correct state
        await refreshExamplesFromAPI(true);
        
        // Success - no alert needed, UI will update automatically
      } else {
        console.error('❌ Delete Example API failed:', response.status);
        
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('📋 Error Details:', errorDetails);
        } catch (jsonError) {
          const errorText = await response.text();
          console.error('📝 Error Text:', errorText);
          errorDetails = { detail: errorText };
        }
        
        // Show user-friendly error
        if (response.status === 404) {
          // Example might have been deleted already, refresh to sync
          console.log('⚠️ Example not found (might be deleted already), refreshing data...');
          await refreshExamplesFromAPI(true);
          alert('Example not found. The data has been refreshed to show current state.');
        } else if (response.status === 403) {
          alert('Access denied. You do not have permission to delete this example.');
        } else if (response.status === 500) {
          alert('Server error occurred while deleting the example. Please try again later.');
        } else {
          alert(`Failed to delete example (${response.status}): ${errorDetails.detail || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('❌ Network error during example deletion:', error);
      alert('Network error: Failed to connect to the server. Please check your connection and try again.');
    } finally {
      setIsDeletingExample(false);
      setDeletingExampleId(null);
    }
  };

  const handleDeleteAllExamplesByLabel = async (labelId: string) => {
    if (!actualSessionId || !actualProjectId) return;
    
    // Find the label to get the label name
    const label = labels.find(l => l.id === labelId);
    if (!label) {
      alert('Label not found');
      return;
    }
    
    if (label.examples.length === 0) {
      alert('No examples to delete');
      return;
    }
    
    // Show confirmation dialog
    if (!confirm(`Are you sure you want to delete ALL ${label.examples.length} examples from the "${label.name}" label? The label will remain but will be empty. This action cannot be undone.`)) {
      return;
    }
    
    setDeletingExamplesByLabel(prev => new Set(prev).add(labelId));
    
    try {
      console.log('🗑️ Deleting all examples by label via API (keeping label empty)');
      console.log('Session ID:', actualSessionId);
      console.log('Project ID:', actualProjectId);
      console.log('Label:', label.name);
      console.log('Examples count:', label.examples.length);
      
      // Use the correct API endpoint for deleting examples by label
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.deleteExamplesByLabel(actualSessionId, actualProjectId, label.name)}?session_id=${actualSessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('🗑️ Delete Examples by Label API Response Status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ All examples deleted successfully (label kept empty):', result);
        
        // Refresh from API to ensure sync - this will update the UI with the correct state
        await refreshExamplesFromAPI(true);
        
        // Success - no alert needed, UI will update automatically
      } else {
        console.error('❌ Delete Examples by Label API failed:', response.status);
        
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('📋 Error Details:', errorDetails);
        } catch (jsonError) {
          const errorText = await response.text();
          console.error('📝 Error Text:', errorText);
          errorDetails = { detail: errorText };
        }
        
        // Show user-friendly error
        if (response.status === 404) {
          // Examples might have been deleted already, refresh to sync
          console.log('⚠️ Examples not found (might be deleted already), refreshing data...');
          await refreshExamplesFromAPI(true);
          alert('Examples not found. The data has been refreshed to show current state.');
        } else if (response.status === 403) {
          alert('Access denied. You do not have permission to delete these examples.');
        } else if (response.status === 500) {
          alert('Server error occurred while deleting the examples. Please try again later.');
        } else {
          alert(`Failed to delete examples (${response.status}): ${errorDetails.detail || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('❌ Network error during examples deletion:', error);
      alert('Network error: Failed to connect to the server. Please check your connection and try again.');
    } finally {
      setDeletingExamplesByLabel(prev => {
        const newSet = new Set(prev);
        newSet.delete(labelId);
        return newSet;
      });
    }
  };

  const openAddExampleModal = (labelId: string) => {
    setSelectedLabelId(labelId);
    setShowAddExampleModal(true);
  };

  // Image collection functions
  const loadImages = async () => {
    if (!actualSessionId || !actualProjectId) return;
    
    console.log('🖼️ Loading images for project:', actualProjectId);
    setIsLoadingImages(true);
    try {
      const url = `${config.apiBaseUrl}${config.api.guests.images(actualSessionId, actualProjectId)}`;
      console.log('🖼️ Fetching images from:', url);
      
      const response = await fetch(url);
      console.log('🖼️ Response status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('🖼️ Images response:', result);
        console.log('🖼️ Images array:', result.images);
        console.log('🖼️ Labels array:', result.labels);
        console.log('🖼️ Images count:', result.images?.length || 0);
        console.log('🖼️ Labels count:', result.labels?.length || 0);
        
        setImages(result.images || []);
        
        // Get image labels from the loaded images
        const imageLabels = [...new Set(result.images?.map((img: { label: string }) => img.label).filter(Boolean) || [])] as string[];
        
        // Get API labels from the response
        const apiLabels = result.labels || [];
        
        // Create text labels from API labels list (includes empty labels)
        const textLabels: Label[] = [];
        apiLabels.forEach((labelName: string) => {
          // Find existing label from current state to preserve examples
          const existingLabel = labels.find(l => l.name === labelName);
          textLabels.push({
            id: existingLabel?.id || `label-${Date.now()}-${Math.random()}`,
            name: labelName,
            examples: existingLabel?.examples || [],
            createdAt: existingLabel?.createdAt || new Date().toLocaleDateString()
          });
        });
        
        // Debug: Log what we're passing to createUnifiedLabels
        console.log('🖼️ Debug - textLabels:', textLabels.map(l => l.name));
        console.log('🖼️ Debug - imageLabels:', imageLabels);
        console.log('🖼️ Debug - apiLabels:', apiLabels);
        
        // Use unified label management to combine all sources
        const unifiedLabels = createUnifiedLabels(textLabels, imageLabels, apiLabels);
        
        console.log('🖼️ Debug - unifiedLabels result:', unifiedLabels.map(l => l.name));
        
        // Load locally saved labels to preserve any locally created labels
        const localLabels = loadLocalLabels(actualSessionId, actualProjectId);
        
        // Merge with local labels, preserving local labels that don't exist in unified labels yet
        const mergedLabels = mergeLabels(unifiedLabels, localLabels);
        
        console.log('🖼️ Updating labels with unified data (text + image + API + local):', mergedLabels);
        console.log('🖼️ Final labels being set:', mergedLabels.map(l => l.name));
        setLabels(mergedLabels);
        
        console.log('🖼️ Set images count:', result.images?.length || 0);
        console.log('🖼️ Set labels:', result.labels || []);
        
        // Debug: Check if images have the expected structure
        if (result.images && result.images.length > 0) {
          console.log('🖼️ First image structure:', result.images[0]);
          console.log('🖼️ All image labels:', result.images.map((img: { label: string }) => img.label));
        }
        
        // Debug: Check for potential issues
        if (result.images && result.images.length > 0 && (!result.labels || result.labels.length === 0)) {
          console.warn('⚠️ Images exist but no labels in labels array - this might cause display issues');
        }
      } else {
        console.error('Failed to load images:', response.status);
        const errorText = await response.text();
        console.error('Error details:', errorText);
      }
    } catch (error) {
      console.error('Error loading images:', error);
    } finally {
      setIsLoadingImages(false);
    }
  };

  const handleImageUpload = async (files: File[], label: string) => {
    if (!actualSessionId || !actualProjectId) return;
    
    console.log('📤 Uploading images:', files.length, 'files with label:', label);
    setIsUploadingImages(true);
    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });
      formData.append('label', label);
      
      const url = `${config.apiBaseUrl}${config.api.guests.images(actualSessionId, actualProjectId)}`;
      
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });
      
      
      if (response.ok) {
        const result = await response.json();
        // Reload images to show the new ones
        await loadImages();
        // Also refresh labels to update counts
        await refreshExamplesFromAPI(true);
      } else {
        const errorData = await response.json();
        alert(`Failed to upload images: ${errorData.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error uploading images:', error);
      alert('Network error: Failed to upload images. Please try again.');
    } finally {
      setIsUploadingImages(false);
    }
  };

  /** Sample images: every label in one upload (labels sent per file), then one reload. */
  const uploadSampleImages = async (items: { file: File; label: string }[]) => {
    if (!actualSessionId || !actualProjectId) throw new Error('Your session is not ready yet. Please reload the page.');
    const form = new FormData();
    items.forEach(({ file, label }) => {
      form.append('files', file);
      form.append('labels', label);
    });
    const response = await fetch(`${config.apiBaseUrl}${config.api.guests.images(actualSessionId, actualProjectId)}`, { method: 'POST', body: form });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.detail ?? ''; } catch { /* no body */ }
      throw new Error(`Could not add the images${detail ? `: ${detail}` : ''}.`);
    }
    await loadImages();
  };

  const handleDeleteImage = async (imageUrl: string) => {
    // For now, just remove from local state
    // In a full implementation, you'd call a delete API endpoint
    setImages(prev => prev.filter(img => img.image_url !== imageUrl));
  };

  // Image delete functions
  const handleDeleteImageLabel = async (label: string) => {
    if (!actualSessionId || !actualProjectId) return;
    
    // Show confirmation dialog
    const imagesWithLabel = images.filter(img => img.label === label);
    if (!confirm(`Are you sure you want to delete the image label "${label}"${imagesWithLabel.length > 0 ? ` and all ${imagesWithLabel.length} images` : ''}? This action cannot be undone.`)) {
      return;
    }
    
    setIsDeletingImageLabel(true);
    setDeletingImageLabelId(label);
    
    try {
      console.log('🗑️ Deleting image label via API:', label);
      
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.deleteImageLabel(actualSessionId, actualProjectId, label)}?session_id=${actualSessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('🗑️ Delete Image Label API Response Status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Image label deleted successfully:', result);
        
        // Update local state immediately to prevent UI issues
        const remainingImages = images.filter(img => img.label !== label);
        setImages(remainingImages);
        
        // Refresh labels to update the unified label state
        await refreshExamplesFromAPI(true);
        
        console.log('🖼️ Remaining images after label deletion:', remainingImages);
        
        // Also reload from API to ensure consistency
        await loadImages();
      } else {
        console.error('❌ Delete Image Label API failed:', response.status);
        
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('📋 Error Details:', errorDetails);
        } catch (jsonError) {
          const errorText = await response.text();
          console.error('📝 Error Text:', errorText);
          errorDetails = { detail: errorText };
        }
        
        // Show user-friendly error
        if (response.status === 404) {
          alert('Image label not found. It may have already been deleted.');
        } else if (response.status === 403) {
          alert('Access denied. You do not have permission to delete this image label.');
        } else if (response.status === 500) {
          alert('Server error occurred while deleting the image label. Please try again later.');
        } else {
          alert(`Failed to delete image label (${response.status}): ${errorDetails.detail || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('❌ Network error during image label deletion:', error);
      alert('Network error: Failed to connect to the server. Please check your connection and try again.');
    } finally {
      setIsDeletingImageLabel(false);
      setDeletingImageLabelId(null);
    }
  };

  const handleDeleteImageExamplesByLabel = async (label: string) => {
    if (!actualSessionId || !actualProjectId) return;
    
    const imagesWithLabel = images.filter(img => img.label === label);
    if (imagesWithLabel.length === 0) {
      // Label is already empty - this is fine, just refresh the data
      console.log('Label is already empty, refreshing data...');
      await loadImages();
      return;
    }
    
    // Show confirmation dialog
    if (!confirm(`Are you sure you want to delete ALL ${imagesWithLabel.length} images from the "${label}" label? The label will remain but will be empty. This action cannot be undone.`)) {
      return;
    }
    
    setIsDeletingImageExamples(true);
    setDeletingImageLabelId(label);
    
    try {
      console.log('🗑️ Deleting all image examples by label via API');
      console.log('Label:', label);
      console.log('Images count:', imagesWithLabel.length);
      
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.deleteImageExamplesByLabel(actualSessionId, actualProjectId, label)}?session_id=${actualSessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('🗑️ Delete Image Examples by Label API Response Status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ All image examples deleted successfully:', result);
        
        // Update local state immediately to prevent UI issues
        const remainingImages = images.filter(img => img.label !== label);
        setImages(remainingImages);
        
        // Refresh labels to update the unified label state
        await refreshExamplesFromAPI(true);
        
        // Debug: Log current state after update
        console.log('🖼️ Current images after Clear All:', remainingImages);
        
        // Also reload from API to ensure consistency
        await loadImages();
      } else {
        console.error('❌ Delete Image Examples by Label API failed:', response.status);
        
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('📋 Error Details:', errorDetails);
        } catch (jsonError) {
          const errorText = await response.text();
          console.error('📝 Error Text:', errorText);
          errorDetails = { detail: errorText };
        }
        
        // Show user-friendly error
        if (response.status === 404) {
          console.log('⚠️ Images not found (might be deleted already), refreshing data...');
          await loadImages();
          alert('Images not found. The data has been refreshed to show current state.');
        } else if (response.status === 403) {
          alert('Access denied. You do not have permission to delete these images.');
        } else if (response.status === 500) {
          alert('Server error occurred while deleting the images. Please try again later.');
        } else {
          alert(`Failed to delete images (${response.status}): ${errorDetails.detail || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('❌ Network error during image examples deletion:', error);
      alert('Network error: Failed to connect to the server. Please check your connection and try again.');
    } finally {
      setIsDeletingImageExamples(false);
      setDeletingImageLabelId(null);
    }
  };

  const handleDeleteSpecificImageExample = async (label: string, exampleIndex: number) => {
    if (!actualSessionId || !actualProjectId) return;
    
    const imagesWithLabel = images.filter(img => img.label === label);
    const exampleToDelete = imagesWithLabel[exampleIndex];
    
    if (!exampleToDelete) {
      alert('Image not found');
      return;
    }
    
    // Show confirmation dialog
    if (!confirm(`Are you sure you want to delete this image from the "${label}" label?`)) {
      return;
    }
    
    setIsDeletingImageExamples(true);
    setDeletingImageLabelId(label);
    setDeletingImageExampleId(`${label}-${exampleIndex}`);
    
    try {
      console.log('🗑️ Deleting specific image example via API');
      console.log('Label:', label);
      console.log('Example Index:', exampleIndex);
      
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.deleteSpecificImageExample(actualSessionId, actualProjectId, label, exampleIndex)}?session_id=${actualSessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('🗑️ Delete Specific Image Example API Response Status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Image example deleted successfully:', result);
        
        // Reload images to show updated state
        await loadImages();
      } else {
        console.error('❌ Delete Specific Image Example API failed:', response.status);
        
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('📋 Error Details:', errorDetails);
        } catch (jsonError) {
          const errorText = await response.text();
          console.error('📝 Error Text:', errorText);
          errorDetails = { detail: errorText };
        }
        
        // Show user-friendly error
        if (response.status === 404) {
          console.log('⚠️ Image not found (might be deleted already), refreshing data...');
          await loadImages();
          alert('Image not found. The data has been refreshed to show current state.');
        } else if (response.status === 400 && errorDetails.detail && errorDetails.detail.includes('Invalid example index')) {
          console.log('🔄 Index out of range - refreshing data...');
          await loadImages();
          alert('The image data has changed. Please try deleting the image again.');
        } else if (response.status === 403) {
          alert('Access denied. You do not have permission to delete this image.');
        } else if (response.status === 500) {
          alert('Server error occurred while deleting the image. Please try again later.');
        } else {
          alert(`Failed to delete image (${response.status}): ${errorDetails.detail || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('❌ Network error during specific image deletion:', error);
      alert('Network error: Failed to connect to the server. Please check your connection and try again.');
    } finally {
      setIsDeletingImageExamples(false);
      setDeletingImageLabelId(null);
      setDeletingImageExampleId(null);
    }
  };

  const handleDeleteEmptyImageLabel = async (label: string) => {
    if (!actualSessionId || !actualProjectId) return;
    
    const imagesWithLabel = images.filter(img => img.label === label);
    if (imagesWithLabel.length > 0) {
      alert('This label has images. Please delete all images first or use the "Delete Label" button to delete both label and images.');
      return;
    }
    
    // Show confirmation dialog
    if (!confirm(`Are you sure you want to delete the empty image label "${label}"? This action cannot be undone.`)) {
      return;
    }
    
    setIsDeletingImageLabel(true);
    setDeletingImageLabelId(label);
    
    try {
      console.log('🗑️ Deleting empty image label via API:', label);
      
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.deleteEmptyImageLabel(actualSessionId, actualProjectId, label)}?session_id=${actualSessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('🗑️ Delete Empty Image Label API Response Status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Empty image label deleted successfully:', result);
        
        // Refresh labels to update the unified label state
        await refreshExamplesFromAPI(true);
        
        // Also reload from API to ensure consistency
        await loadImages();
      } else {
        console.error('❌ Delete Empty Image Label API failed:', response.status);
        
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('📋 Error Details:', errorDetails);
        } catch (jsonError) {
          const errorText = await response.text();
          console.error('📝 Error Text:', errorText);
          errorDetails = { detail: errorText };
        }
        
        // Show user-friendly error
        if (response.status === 400) {
          alert(errorDetails.detail || 'This label has images and cannot be deleted as an empty label.');
        } else if (response.status === 404) {
          alert('Image label not found. It may have already been deleted.');
        } else if (response.status === 500) {
          alert('Server error occurred while deleting the image label. Please try again later.');
        } else {
          alert(`Failed to delete empty image label (${response.status}): ${errorDetails.detail || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('❌ Network error during empty image label deletion:', error);
      alert('Network error: Failed to connect to the server. Please check your connection and try again.');
    } finally {
      setIsDeletingImageLabel(false);
      setDeletingImageLabelId(null);
    }
  };





  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas text-fg">
        <Header />
        <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center min-h-[25rem]">
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

      <main className="pt-24 short:pt-20 pb-20 px-4 sm:px-6 lg:px-8">
        <div>
          

                               <div className="mb-8 short:mb-4 flex items-center justify-between">
            <Link
              href={`/projects/${urlUserId}/${urlProjectId}`}
              className="px-3 py-1.5 text-fg/70 hover:text-white hover:bg-purple-brand/10 rounded-lg transition-all duration-300 flex items-center gap-1.5 text-xs"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to project
            </Link>
            
                        <h1 className="text-2xl md:text-3xl font-bold">
              <span className="text-fg">Project Type: </span>
              <span className="text-pink-brand">
                {selectedProject?.type === 'text-recognition' ? 'Text Recognition' : 
                 selectedProject?.type === 'image-recognition' ? 'Image Recognition' :
                 selectedProject?.type === 'image-recognition-teachable-machine' ? 'Image Recognition - Teachable Machine' :
                 selectedProject?.type === 'classification' ? 'Classification' :
                 selectedProject?.type === 'regression' ? 'Regression' :
                 selectedProject?.type === 'custom' ? 'Custom' :
                 selectedProject?.type || 'Text Recognition'}
              </span>
            </h1>
            
            <div></div> {/* Empty div to balance the layout */}
          </div>

          {/* Image Collection for Image Recognition Projects */}
          {selectedProject?.type === 'image-recognition' && (() => {
            const counts = labels.map((l) => ({ name: l.name, n: images.filter((img) => img.label === l.name).length }));
            const enoughLabels = counts.length >= 2;
            const enoughEach = counts.length > 0 && counts.every((c) => c.n >= MIN_IMAGES_PER_LABEL);
            const ready = enoughLabels && enoughEach;
            const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${ok ? 'border-[var(--success)] text-[var(--success)] bg-[var(--success)]/10' : 'border-fg/20 text-fg/70'}`}>
                <span aria-hidden="true">{ok ? '✓' : '○'}</span>{children}
              </span>
            );
            return (
              <div className="space-y-5">
                {/* toolbar */}
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-magenta-brand/20 bg-card px-5 py-4">
                  <div className="flex-1 min-w-[16rem]">
                    <h2 className="text-lg font-semibold text-fg">Collect image data</h2>
                    <div className="flex flex-wrap gap-2 mt-2" aria-label="Before you can train">
                      <Check ok={enoughLabels}>At least 2 labels</Check>
                      <Check ok={enoughEach}>At least {MIN_IMAGES_PER_LABEL} images in every label</Check>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSampleImages(true)}
                    className="border-2 border-purple-brand text-purple-brand hover:bg-purple-brand/10 rounded-lg px-4 py-2 inline-flex items-center gap-2 text-sm font-medium transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Use sample data
                  </button>
                  {ready ? (
                    <Link
                      href={`/projects/${urlUserId}/${urlProjectId}/learn`}
                      className="bg-purple-brand hover:bg-purple-brand/90 text-white px-4 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors"
                    >
                      Move to next - Training
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  ) : (
                    <span className="bg-purple-brand/40 text-white/80 px-4 py-2.5 rounded-lg text-sm font-semibold cursor-not-allowed" aria-disabled="true" title="Finish the checklist first">
                      Move to next - Training
                    </span>
                  )}
                </div>

                <div className="grid gap-5 md:grid-cols-[22rem_minmax(0,1fr)] items-start">
                  <section className="rounded-xl border border-magenta-brand/20 bg-card p-5 md:sticky md:top-24" aria-labelledby="add-images-h">
                    <h3 id="add-images-h" className="font-semibold text-fg mb-3">Add images</h3>
                    <ImageUpload
                      onUpload={handleImageUpload}
                      isUploading={isUploadingImages}
                      projectType={selectedProject.type}
                    />
                  </section>

                  <section className="rounded-xl border border-magenta-brand/20 bg-card p-5 min-w-0" aria-labelledby="your-images-h">
                    <div className="flex items-baseline gap-2 mb-4">
                      <h3 id="your-images-h" className="font-semibold text-fg">Your images</h3>
                      <span className="text-sm text-fg/60">
                        {images.length} image{images.length === 1 ? '' : 's'} in {counts.length} label{counts.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <ImageGallery
                      images={images}
                      labels={labels.map(label => label.name)}
                      onDelete={handleDeleteImage}
                      onDeleteLabel={handleDeleteImageLabel}
                      onDeleteAllExamples={handleDeleteImageExamplesByLabel}
                      onDeleteSpecificExample={handleDeleteSpecificImageExample}
                      onDeleteEmptyLabel={handleDeleteEmptyImageLabel}
                      onUploadImages={handleImageUpload}
                      isLoading={isLoadingImages}
                      sessionId={actualSessionId}
                      projectId={actualProjectId}
                      isDeletingLabel={isDeletingImageLabel}
                      isDeletingExamples={isDeletingImageExamples}
                      deletingLabelId={deletingImageLabelId || undefined}
                      deletingExampleId={deletingImageExampleId || undefined}
                    />
                  </section>
                </div>
              </div>
            );
          })()}

          {showSampleImages && (
            <SampleImagesDialog
              namesKey={labelNamesKey(actualSessionId || '', actualProjectId || '')}
              existing={images}
              onAdd={uploadSampleImages}
              onClose={() => setShowSampleImages(false)}
            />
          )}

          {/* Text Recognition Content - only show for text-recognition projects */}
          {selectedProject?.type === 'text-recognition' && (
            <>
              {/* Note (left) and actions (right), one row */}
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                {/* Note on the left */}
                <div className="w-fit max-w-full bg-canvas border border-magenta-brand/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-pink-brand mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div>
                      <h3 className="text-pink-brand font-medium mb-2 md:whitespace-nowrap">Note: Before you can proceed to next step</h3>
                      <div className="text-fg text-sm space-y-1">
                        <p className="md:whitespace-nowrap">
                          <strong>1.</strong> Create the standard labels (or at least <strong>2 labels</strong> of your own)
                        </p>
                        <p className="md:whitespace-nowrap">
                          <strong>2.</strong> Fill in at least <strong>5 examples</strong> for each label: use &lsquo;Input sample label data&rsquo; or add your own
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Actions on the right: create the standard labels, add your own, then label the sample data */}
                {(() => {
                  const have = new Set(labels.map((l) => l.name.toLowerCase()));
                  const standardMissing = standardLabelNames().some((n) => !have.has(n.toLowerCase()));
                  const ready = labels.length >= 2 && labels.every((label) => label.examples.length >= 5);
                  const step = 'px-4 py-2.5 rounded-lg transition-all duration-300 inline-flex items-center gap-2 text-sm font-medium';
                  const primary = `${step} bg-purple-brand hover:bg-purple-brand/90 text-white`;
                  const secondary = `${step} border-2 border-purple-brand text-purple-brand hover:bg-purple-brand/10`;
                  return (
                    <div className="flex flex-wrap items-center gap-3">
                      {standardMissing && (
                        <button onClick={handleCreateStandardLabels} className={primary}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                          </svg>
                          Create standard labels
                        </button>
                      )}
                      <button onClick={() => setShowAddLabelModal(true)} className={secondary}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        Add new label
                      </button>
                      {!standardMissing && (
                        <button onClick={() => setSampleSource(SAMPLE_SOURCES[0])} className={ready ? secondary : primary}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h10" />
                          </svg>
                          Input sample label data
                        </button>
                      )}
                      {ready && (
                        <Link href={`/projects/${urlUserId}/${urlProjectId}/learn`} className={primary}>
                          Move to next - Training
                        </Link>
                      )}
                    </div>
                  );
                })()}
              </div>

            

                                               {labels.length > 0 ? (
                      <div className={`grid gap-6 ${
                        labels.length === 1 ? 'grid-cols-1 max-w-3xl mx-auto' :
                        labels.length === 2 ? 'grid-cols-2 max-w-5xl mx-auto' :
                        labels.length === 3 ? 'grid-cols-3 max-w-6xl mx-auto' :
                        labels.length === 4 ? 'grid-cols-4 max-w-7xl mx-auto' :
                        'grid-cols-4 max-w-7xl mx-auto'
                      }`}>
                {labels.map((label) => (
                  <div key={label.id} className={`bg-canvas border-2 border-magenta-brand/20 rounded-lg overflow-hidden relative ${
                             labels.length === 1 ? 'h-[37.5rem]' :
                             labels.length === 2 ? 'h-[34.375rem]' :
                             labels.length === 3 ? 'h-[31.25rem]' :
                             labels.length === 4 ? 'h-[28.125rem]' :
                             'h-[25rem]'
                           }`}>
                                       <div className="bg-purple-brand/20 px-3 py-2 flex justify-between items-center">
                      <h3 className="text-fg font-semibold text-base">
                        {label.name}
                        {deletingLabels.has(label.id) && (
                          <span className="ml-2 text-orange-400 text-sm font-normal">Deleting...</span>
                        )}
                        {deletingExamplesByLabel.has(label.id) && (
                          <span className="ml-2 text-orange-400 text-sm font-normal">Clearing examples...</span>
                        )}
                      </h3>
                     <div className="flex items-center gap-2">
                                               {label.examples.length > 0 && (
                          <button
                            onClick={() => handleDeleteAllExamplesByLabel(label.id)}
                            disabled={deletingExamplesByLabel.has(label.id)}
                            className="text-orange-400 hover:text-orange-300 transition-all duration-300 text-xs px-2 py-1 rounded border border-orange-400/30 hover:border-orange-400/50"
                            title="Delete all examples under this label"
                          >
                            {deletingExamplesByLabel.has(label.id) ? 'Deleting...' : 'Clear All'}
                          </button>
                        )}
                                               {/* Show different delete button based on whether label has examples */}
                        {label.examples.length > 0 ? (
                          // Label has examples - delete entire label with examples
                                                     <button
                             onClick={() => handleDeleteLabel(label.id)}
                             disabled={deletingLabels.has(label.id) || deletingExamplesByLabel.has(label.id)}
                             className="text-red-500 hover:text-red-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                             title="Delete label and all examples"
                           >
                             {deletingLabels.has(label.id) ? (
                               <div className="w-4 h-4 border border-red-500/20 border-t-red-500 rounded-full animate-spin"></div>
                             ) : (
                               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                               </svg>
                             )}
                           </button>
                        ) : (
                          // Label has no examples - delete empty label only
                                                     <button
                             onClick={() => handleDeleteEmptyLabel(label.id)}
                             disabled={deletingLabels.has(label.id)}
                             className="text-red-400 hover:text-red-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                             title="Delete empty label"
                           >
                             {deletingLabels.has(label.id) ? (
                               <div className="w-4 h-4 border border-red-400/20 border-t-red-400 rounded-full animate-spin"></div>
                             ) : (
                               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                               </svg>
                             )}
                           </button>
                        )}
                     </div>
                   </div>

                                                           <div className="p-3 bg-canvas text-fg flex flex-col h-full">
                    {/* Action buttons - always at top, side by side */}
                                         <div className="flex gap-2 mb-3 flex-shrink-0">
                       <button
                         onClick={() => openAddExampleModal(label.id)}
                         disabled={deletingLabels.has(label.id) || deletingExamplesByLabel.has(label.id)}
                         className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 border-2 border-dashed border-magenta-brand/40 text-pink-brand hover:border-magenta-brand/60 hover:text-pink-brand/80 hover:bg-purple-brand/5 transition-all duration-300 rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                         <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                         </svg>
                         <span className="hidden sm:inline">Add example</span>
                         <span className="sm:hidden">Add</span>
                       </button>

                       <label className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 border-2 border-dashed border-magenta-brand/40 text-pink-brand hover:border-magenta-brand/60 hover:text-pink-brand/80 hover:bg-purple-brand/5 transition-all duration-300 rounded-lg text-xs font-medium ${deletingLabels.has(label.id) || deletingExamplesByLabel.has(label.id) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                         <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                         </svg>
                         <span className="hidden sm:inline">Add file</span>
                         <span className="sm:hidden">File</span>
                         <input
                           type="file"
                           accept=".txt,.csv"
                           onChange={(e) => handleFileUpload(e, label.id)}
                           className="hidden"
                           disabled={deletingLabels.has(label.id) || deletingExamplesByLabel.has(label.id)}
                         />
                       </label>
                     </div>

                    {/* Examples display area */}
                    {label.examples.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-center text-fg/40 text-sm">
                        <div className="space-y-3">
                          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-purple-brand/10 rounded-full">
                            <svg className="w-6 h-6 text-purple-brand/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <div>
                            <p className="font-medium text-fg/60">No examples yet</p>
                            <p className="text-xs mt-1 text-fg/40">Start training by adding examples above</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 overflow-hidden">
                        {/* Examples as pills in a flexible grid */}
                        <div className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-magenta-brand/30 scrollbar-track-transparent">
                          <div className="flex flex-wrap gap-2 pb-8">
                            {label.examples.map((example) => (
                              <div
                                key={example.id}
                                className="inline-flex items-start gap-2 bg-gradient-to-r from-purple-brand/15 to-magenta-brand/10 hover:from-purple-brand/25 hover:to-magenta-brand/20 border border-magenta-brand/30 hover:border-magenta-brand/50 px-3 py-1.5 rounded-2xl text-xs transition-all duration-200 group max-w-full shadow-sm"
                              >
                                <span className="font-medium text-fg/90 whitespace-normal break-words min-w-0 leading-snug">
                                  {example.text}
                                </span>
                                <button
                                  onClick={() => handleDeleteExample(label.id, example.id)}
                                  disabled={isDeletingExample && deletingExampleId === example.id}
                                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-full p-0.5 opacity-70 group-hover:opacity-100 transition-all duration-300 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Delete example"
                                >
                                  {isDeletingExample && deletingExampleId === example.id ? (
                                    <div className="w-2.5 h-2.5 border border-red-400/20 border-t-red-400 rounded-full animate-spin"></div>
                                  ) : (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Example count badge */}
                    {label.examples.length > 0 && (
                      <div className="absolute bottom-2 right-2">
                        <span className="bg-purple-brand text-white text-xs px-2 py-1 rounded-full font-medium">
                          {label.examples.length}
                        </span>
                      </div>
                    )}
                  </div>
                 </div>
               ))}
             </div>
                        ) : null}

          {/* Next Step Button */}
      {labels.length >= 2 && labels.every(label => label.examples.length >= 5) && (
        <div className="flex justify-end mt-12">
          <Link
            href={`/projects/${urlUserId}/${urlProjectId}/learn`}
            className="bg-purple-brand hover:bg-purple-brand/90 text-white px-8 py-4 rounded-lg text-lg font-medium hover:scale-105 transition-all duration-300 inline-block shadow-lg hover:shadow-xl"
          >
            Move to next - Training
          </Link>
        </div>
      )}
            </>
          )}
        </div>
      </main>

      {sampleSource && (
        <SampleLabeller
          source={sampleSource}
          draftKey={`yl-sample:${sampleSource.id}:${actualProjectId}`}
          existing={labels.map((l) => ({ label: l.name, texts: l.examples.map((e) => e.text) }))}
          onClose={() => setSampleSource(null)}
          onGroup={handleGroupSample}
        />
      )}

      {/* Add Label Modal */}
      {showAddLabelModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-canvas border border-magenta-brand/20 rounded-lg max-w-md w-full">
            <div className="bg-purple-brand/20 text-white px-6 py-4 rounded-t-lg">
              <h2 className="text-xl font-semibold">Add new label</h2>
            </div>
            
            <div className="p-6">
              <label className="block text-sm font-medium text-pink-brand mb-2">
                Enter a Label / Class for what you want the AI to classify like &quot;Happy&quot; or &quot;Sad&quot; 
              </label>
              <input
                type="text"
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newLabelName.trim()) {
                    handleAddLabel();
                  }
                }}
                placeholder="label"
                className="w-full px-3 py-2 border border-magenta-brand/40 rounded text-fg bg-canvas focus:outline-none focus:border-pink-brand"
                maxLength={LABEL_MAX}
                autoFocus
              />
              <div className="text-right text-xs text-fg/60 mt-1">
                {newLabelName.length} / 30
              </div>
            </div>
            
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button
                onClick={() => {
                  setShowAddLabelModal(false);
                  setNewLabelName('');
                }}
                className="px-4 py-2 text-fg/70 hover:text-fg transition-all duration-300"
              >
                CANCEL
              </button>
              <button
                onClick={handleAddLabel}
                disabled={!newLabelName.trim() || isSubmittingToAPI}
                className="px-4 py-2 bg-purple-brand text-white rounded hover:bg-purple-brand/90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isSubmittingToAPI ? 'ADDING...' : 'ADD'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Example Modal */}
      {showAddExampleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-canvas border border-magenta-brand/20 rounded-lg max-w-lg w-full">
            <div className="bg-purple-brand/20 text-white px-6 py-4 rounded-t-lg">
              <h2 className="text-xl font-semibold">Add example</h2>
            </div>
            
            <div className="p-6">
              <label className="block text-sm font-medium text-pink-brand mb-2">
                Enter examples of what you want the AI to recognise as &apos;{labels.find(l => l.id === selectedLabelId)?.name}&apos;
              </label>
              <textarea
                value={newExampleText}
                onChange={(e) => setNewExampleText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && newExampleText.trim()) {
                    e.preventDefault();
                    handleAddExample();
                  }
                }}
                placeholder={`You can enter more than one example with a comma separating them like
Example 1, Example 2... and so on`}
                className="w-full px-3 py-2 border border-magenta-brand/40 rounded text-fg bg-canvas focus:outline-none focus:border-pink-brand min-h-32 h-40 resize-y placeholder-fg/40"
                autoFocus
              />
              <p className="text-fg/60 text-xs mt-1">
                Separate several examples with commas. Press Shift+Enter for a new line.
              </p>
            </div>
            
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button
                onClick={() => {
                  setShowAddExampleModal(false);
                  setNewExampleText('');
                  setSelectedLabelId('');
                }}
                className="px-4 py-2 text-fg/70 hover:text-fg transition-all duration-300"
              >
                CANCEL
              </button>
              <button
                onClick={handleAddExample}
                disabled={!newExampleText.trim() || isSubmittingToAPI}
                className="px-4 py-2 bg-purple-brand text-white rounded hover:bg-purple-brand/90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isSubmittingToAPI ? 'ADDING...' : 'ADD'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}