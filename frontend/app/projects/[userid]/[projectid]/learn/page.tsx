'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
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
import SampleTestMessages, { type Prediction } from '../../../../../components/SampleLabelling/SampleTestMessages';

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

interface DatasetExample {
  text: string;
  label: string;
  addedAt: string;
}

interface ImageExample {
  image_url: string;
  label: string;
  filename: string;
  addedAt: string;
}

interface Dataset {
  filename: string;
  size: number;
  records: number;
  uploadedAt: string | null;
  gcsPath: string;
  examples: DatasetExample[];
  image_examples: ImageExample[];
  labels: string[];
}

interface ProjectDetailResponse {
  success: boolean;
  data: {
    id: string;
    name: string;
    description: string;
    type: string;  // Changed from model_type to type
    status: string;
    createdAt: string;
    updatedAt: string;
    dataset: Dataset;
    // ... other fields
  };
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

interface TrainedModel {
  id: string;
  status: 'training' | 'available' | 'failed';
  startedAt: Date;
  expiresAt: Date;
  testResults?: Array<{
    text: string;
    prediction: string;
    confidence: number;
  }>;
}

interface TrainingJob {
  id: string;
  projectId: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  progress: number;
  config: {
    epochs: number;
    batchSize: number;
    learningRate: number;
    validationSplit: number;
  };
  result?: {
    total_features: number;
    feature_importance: {
      [label: string]: string[];
    };
    labels: string[];
    accuracy: number;
    validation_examples: number;
    training_examples: number;
  };
}

interface TrainingStatusResponse {
  success: boolean;
  projectStatus: 'untrained' | 'training' | 'trained' | 'failed';
  modelType?: string | null;
  currentJob: TrainingJob | null;
  allJobs: TrainingJob[];
  totalJobs: number;
}

interface PredictionResponse {
  success: boolean;
  label: string;
  confidence: number;
  alternatives: Array<{
    label: string;
    confidence: number;
  }>;
}

export default function LearnPage() {
  const [guestSession, setGuestSession] = useState<GuestSession | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectDataset, setProjectDataset] = useState<Dataset | null>(null);
  const [isValidSession, setIsValidSession] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [actualSessionId, setActualSessionId] = useState<string>('');
  const [actualProjectId, setActualProjectId] = useState<string>('');
  const [trainingStats, setTrainingStats] = useState({
    totalExamples: 0,
    totalLabels: 0,
    labelBreakdown: [] as { name: string; count: number }[]
  });
  const [isTraining, setIsTraining] = useState(false);
  const [trainedModel, setTrainedModel] = useState<TrainedModel | null>(null);
  const [currentTrainingJob, setCurrentTrainingJob] = useState<TrainingJob | null>(null);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<{
    text: string;
    prediction: string;
    confidence: number;
    alternatives?: Array<{
      label: string;
      confidence: number;
    }>;
  } | null>(null);
  const [isTestingModel, setIsTestingModel] = useState(false);

  // Image prediction state
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [predictionMode, setPredictionMode] = useState<'upload' | 'url' | 'webcam'>('upload');
  const [imagePredictionResult, setImagePredictionResult] = useState<{
    predicted_class: string;
    confidence: number;
    all_probabilities: Array<{
      class: string;
      confidence: number;
    }>;
  } | null>(null);
  const [isPredictingImage, setIsPredictingImage] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  
  // Webcam state
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [webcamVideoRef, setWebcamVideoRef] = useState<HTMLVideoElement | null>(null);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isDeletingModel, setIsDeletingModel] = useState(false);
  const [isStatusLoading, setIsStatusLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  // Text recognition: which model to train ('logistic_regression' | 'distilbert') and which one the current model used
  const [selectedTextModel, setSelectedTextModel] = useState<'logistic_regression' | 'distilbert'>('logistic_regression');
  const [trainedModelType, setTrainedModelType] = useState<string | null>(null);
  const isTextProject = !selectedProject?.type || selectedProject.type === 'text-recognition';
  const modelTypeLabel = (type: string | null) => {
    if (!type) return 'Unknown';
    if (type === 'logistic_regression_ovr') return 'Logistic Regression';
    if (type === 'distilbert') return 'DistilBERT';
    if (type === 'logistic_regression') return 'Logistic Regression (previous version)';
    return type;
  };

  const params = useParams();
  const urlUserId = params?.userid as string;
  const urlProjectId = params?.projectid as string;

  useEffect(() => {
    validateGuestSession();
  }, [urlUserId, urlProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup webcam on unmount
  useEffect(() => {
    return () => {
      if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [webcamStream]);

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
        window.location.href = `/projects/${maskedId}/${urlProjectId}/learn`;
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
            
            // Load project and training data after setting session as valid
            await loadProjectAndTrainingData(sessionId, projectId);
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
      await cleanupSessionWithReason(SessionCleanupReason.ERROR_FALLBACK);
      window.location.href = '/projects';
      return;
    }
    setIsLoading(false);
  };

  const loadProjectAndTrainingData = async (sessionId: string, projectId: string) => {
    try {
      console.log('Loading project and training data for:', projectId);
      
      // Load project data with dataset from the specific project API
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.projectById(sessionId, projectId)}`);
      
      if (response.ok) {
        const projectResponse: ProjectDetailResponse = await response.json();
        console.log('Project response:', projectResponse);
        
        if (projectResponse.success && projectResponse.data) {
          const projectData = projectResponse.data;
          console.log('Found project with dataset:', projectData);
          
          // Set the project
          setSelectedProject({
            id: projectData.id,
            name: projectData.name,
            type: projectData.type,
            createdAt: projectData.createdAt,
            description: projectData.description,
            status: projectData.status
          });

          // Set the dataset
          setProjectDataset(projectData.dataset);

          // Process the dataset to calculate training statistics
          if (projectData.dataset) {
            const textExamples = projectData.dataset.examples || [];
            const labels = projectData.dataset.labels || [];
            
            console.log('Dataset text examples:', textExamples.length);
            console.log('Dataset labels:', labels);
            
            // Group examples by label and count them
            const labelCounts: { [key: string]: number } = {};
            
            // Count text examples
            textExamples.forEach(example => {
              labelCounts[example.label] = (labelCounts[example.label] || 0) + 1;
            });
            
            // For image recognition projects, also load image data
            if (projectData.type === 'image-recognition') {
              try {
                const imagesResponse = await fetch(`${config.apiBaseUrl}${config.api.guests.images(sessionId, projectId)}`);
                if (imagesResponse.ok) {
                  const imagesData = await imagesResponse.json();
                  console.log('Images data loaded:', imagesData);
                  
                  if (imagesData.success) {
                    const imageExamples = imagesData.images || [];
                    const imageLabels = imagesData.labels || [];
                    
                    console.log('Image examples:', imageExamples.length);
                    console.log('Image labels:', imageLabels);
                    
                    // Count image examples
                    imageExamples.forEach((example: { label: string }) => {
                      labelCounts[example.label] = (labelCounts[example.label] || 0) + 1;
                    });
                    
                    // Merge labels from both text and image data
                    const allLabels = [...new Set([...labels, ...imageLabels])];
                    
                    // Create label breakdown for display
                    const labelBreakdown = allLabels.map(labelName => ({
                      name: labelName,
                      count: labelCounts[labelName] || 0
                    }));
                    
                    // Set training statistics from API data (total of text and image examples)
                    const totalExamples = textExamples.length + imageExamples.length;
                    setTrainingStats({
                      totalExamples,
                      totalLabels: allLabels.length,
                      labelBreakdown
                    });

                    console.log('Training stats calculated (with images):', {
                      totalExamples,
                      totalLabels: allLabels.length,
                      labelBreakdown
                    });
                  } else {
                    throw new Error('Failed to load image data');
                  }
                } else {
                  throw new Error('Failed to load image data');
                }
              } catch (error) {
                console.error('Error loading image data:', error);
                // Fall back to text-only data
                const labelBreakdown = labels.map(labelName => ({
                  name: labelName,
                  count: labelCounts[labelName] || 0
                }));
                
                setTrainingStats({
                  totalExamples: textExamples.length,
                  totalLabels: labels.length,
                  labelBreakdown
                });
              }
            } else {
              // For text recognition projects, use only text data
              const labelBreakdown = labels.map(labelName => ({
                name: labelName,
                count: labelCounts[labelName] || 0
              }));
              
              setTrainingStats({
                totalExamples: textExamples.length,
                totalLabels: labels.length,
                labelBreakdown
              });

              console.log('Training stats calculated (text only):', {
                totalExamples: textExamples.length,
                totalLabels: labels.length,
                labelBreakdown
              });
            }
          } else {
            console.log('No dataset found in project response');
            // Set empty stats if no dataset
            setTrainingStats({
              totalExamples: 0,
              totalLabels: 0,
              labelBreakdown: []
            });
          }
        } else {
          console.error('Invalid project response structure');
          window.location.href = `/projects/${urlUserId}`;
          return;
        }
      } else {
        console.error('Failed to load project details:', response.status);
        window.location.href = `/projects/${urlUserId}`;
        return;
      }

      // Load trained model if exists (still from localStorage for now)
      const modelKey = `yaaralabs_playground_model_${sessionId}_${projectId}`;
      const savedModel = localStorage.getItem(modelKey);
      if (savedModel) {
        const modelData = JSON.parse(savedModel);
        // Convert string dates back to Date objects
        const trainedModel: TrainedModel = {
          ...modelData,
          startedAt: new Date(modelData.startedAt),
          expiresAt: new Date(modelData.expiresAt)
        };
        setTrainedModel(trainedModel);
      }
    } catch (error) {
      console.error('Error loading project and training data:', error);
      window.location.href = `/projects/${urlUserId}`;
    }
  };

  // Function to fetch training status from API
  const fetchTrainingStatus = async () => {
    if (!actualSessionId || !actualProjectId) return;
    
    // Prevent multiple simultaneous calls
    if (isStatusLoading) return;
    
    try {
      setIsStatusLoading(true);
      console.log('🔍 Checking training status...');
      
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.trainingStatus(actualSessionId, actualProjectId)}`);
      
      if (response.ok) {
        const statusData: TrainingStatusResponse = await response.json();
        console.log('📊 Training status response:', statusData);
        
        if (statusData.success) {
          const { projectStatus, currentJob } = statusData;
          setTrainedModelType(statusData.modelType ?? null);
          if (statusData.modelType === 'distilbert') setSelectedTextModel('distilbert');
          else if (statusData.modelType === 'logistic_regression_ovr') setSelectedTextModel('logistic_regression');
          
          // Update current training job
          setCurrentTrainingJob(currentJob);
          
          // Update training state based on project status and current job
          if (projectStatus === 'training' && currentJob) {
            setIsTraining(true);
            
            // Check if training is complete
            if (currentJob.status === 'ready' && currentJob.completedAt) {
              // Training completed successfully
              setIsTraining(false);
              
              const completedModel: TrainedModel = {
                id: currentJob.id,
                status: 'available',
                startedAt: new Date(currentJob.startedAt || currentJob.createdAt),
                expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours from now
              };
              
              setTrainedModel(completedModel);
              
              // Save to localStorage
              const modelKey = `yaaralabs_playground_model_${actualSessionId}_${actualProjectId}`;
              localStorage.setItem(modelKey, JSON.stringify(completedModel));
            }
          } else if (projectStatus === 'trained') {
            // Project has a trained model - show it regardless of currentJob
            setIsTraining(false);
            
            // If we have a current job with results, use it
            if (currentJob && currentJob.status === 'ready') {
              const existingModel: TrainedModel = {
                id: currentJob.id,
                status: 'available',
                startedAt: new Date(currentJob.startedAt || currentJob.createdAt),
                expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
              };
              setTrainedModel(existingModel);
            } else {
              // Create a model object from localStorage or create a default one
              const modelKey = `yaaralabs_playground_model_${actualSessionId}_${actualProjectId}`;
              const savedModel = localStorage.getItem(modelKey);
              
              if (savedModel) {
                const modelData = JSON.parse(savedModel);
                const trainedModel: TrainedModel = {
                  ...modelData,
                  startedAt: new Date(modelData.startedAt),
                  expiresAt: new Date(modelData.expiresAt)
                };
                setTrainedModel(trainedModel);
              } else {
                // Create a default model object for trained projects
                const defaultModel: TrainedModel = {
                  id: `model-${actualProjectId}`,
                  status: 'available',
                  startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
                  expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours from now
                };
                setTrainedModel(defaultModel);
                
                // Save to localStorage
                localStorage.setItem(modelKey, JSON.stringify(defaultModel));
              }
            }
          } else if (projectStatus === 'failed' || (currentJob && currentJob.status === 'failed')) {
            // Training failed
            setIsTraining(false);
            setTrainedModel(null);
            setCurrentTrainingJob(null);
          } else if (projectStatus === 'untrained') {
            // No training has been done yet
            setIsTraining(false);
            setTrainedModel(null);
            setCurrentTrainingJob(null);
          }
        }
      } else {
        console.error('❌ Failed to fetch training status:', response.status);
      }
    } catch (error) {
      console.error('❌ Error fetching training status:', error);
    } finally {
      setIsStatusLoading(false);
      setIsInitializing(false);
    }
  };



  // Only check training status when necessary, not continuously
  useEffect(() => {
    if (actualSessionId && actualProjectId) {
      // Initial status check only once when page loads
      fetchTrainingStatus();
    }
  }, [actualSessionId, actualProjectId]); // Only depend on session and project IDs, not training state



  const handleTrainModel = async () => {
    console.log('🎯 handleTrainModel called');
    console.log('📊 Training stats:', trainingStats);
    console.log('✅ canTrainModel:', canTrainModel);
    
    if (!canTrainModel) {
      console.log('❌ Training requirements not met');
      alert(`Cannot train model yet. You need at least 5 examples and 2 labels. Current: ${trainingStats.totalExamples} examples, ${trainingStats.totalLabels} labels`);
      return;
    }
    
    if (!actualSessionId || !actualProjectId) {
      console.log('❌ Missing session or project ID');
      alert('Missing session or project information. Please refresh the page.');
      return;
    }
    
    setIsTraining(true);
    
    try {
      console.log('🚀 Starting model training via API');
      console.log('Session ID:', actualSessionId);
      console.log('Project ID:', actualProjectId);
      
      // Training configuration payload
      const trainingConfig = {
        epochs: 100,
        batchSize: 32,
        learningRate: 0.001,
        validationSplit: 0.2,
        ...(isTextProject ? { modelType: selectedTextModel } : {})
      };
      
      console.log('📋 Training config:', trainingConfig);
      
      const apiUrl = `${config.apiBaseUrl}${config.api.guests.trainModel(actualSessionId, actualProjectId)}`;
      console.log('🌐 API URL:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(trainingConfig),
      });
      
      console.log('📤 Training API Response Status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Training API response:', result);

        // Backend reported a training problem (e.g. only one label) - show it instead of waiting forever
        if (result && result.success === false) {
          alert(`Training failed: ${result.message || 'Unknown error'}`);
          setIsTraining(false);
          setCurrentTrainingJob(null);
          return;
        }
        
                 if (result.success && result.message === 'Training completed successfully!') {
           // Training completed immediately (synchronous training)
           console.log('🎉 Training completed immediately!');
           setIsTraining(false);
           
           // Create completed model object
           const now = new Date();
           const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours from now
           
           const completedModel: TrainedModel = {
             id: result.jobId || `model-${Date.now()}`,
             status: 'available',
             startedAt: now,
             expiresAt: expiresAt
           };

           setTrainedModel(completedModel);
           // The model just trained (the status read before training still shows the project's old default)
           if (isTextProject) setTrainedModelType(selectedTextModel === 'distilbert' ? 'distilbert' : 'logistic_regression_ovr');

           // Save to localStorage
           const modelKey = `yaaralabs_playground_model_${actualSessionId}_${actualProjectId}`;
           localStorage.setItem(modelKey, JSON.stringify(completedModel));
           
           // Clear any existing training job
           setCurrentTrainingJob(null);
           
           // Check training status once after completion
           setTimeout(() => {
             fetchTrainingStatus();
           }, 1000);
           
         } else {
           // Training started asynchronously
           console.log('🚀 Training started asynchronously');
           
           // Create a temporary training job object to show progress
           const tempTrainingJob: TrainingJob = {
             id: result.jobId || `temp-${Date.now()}`,
             projectId: actualProjectId,
             status: 'pending',
             createdAt: new Date().toISOString(),
             startedAt: null,
             completedAt: null,
             error: null,
             progress: 0,
             config: trainingConfig
           };
           
           setCurrentTrainingJob(tempTrainingJob);
           
           // Create model object for UI
           const now = new Date();
           const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours from now
           
           const newModel: TrainedModel = {
             id: result.jobId || `model-${Date.now()}`,
             status: 'training',
             startedAt: now,
             expiresAt: expiresAt
           };
           
           setTrainedModel(newModel);
           
           // For async training, check status once after a delay
           setTimeout(() => {
             fetchTrainingStatus();
           }, 2000);
         }
        
      } else {
        console.error('❌ Training API failed:', response.status);
        
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('📋 Error Details:', errorDetails);
        } catch (jsonError) {
          const errorText = await response.text();
          console.error('📝 Error Text:', errorText);
          errorDetails = { message: errorText };
        }
        
        // Show user-friendly error
        if (response.status === 422) {
          const errorMsg = errorDetails.message || 'Invalid training configuration';
          alert(`Training Error: ${errorMsg}`);
        } else if (response.status === 404) {
          alert('Training endpoint not found. Please check if the server is running.');
        } else if (response.status === 500) {
          alert('Server error during training. Please try again later.');
        } else {
          alert(`Training failed (${response.status}): ${errorDetails.message || 'Unknown error'}`);
        }
        
        setIsTraining(false);
        setCurrentTrainingJob(null);
      }
    } catch (error) {
      console.error('❌ Network error during training:', error);
      alert('Network error: Failed to connect to the training server. Please check your connection.');
      setIsTraining(false);
      setCurrentTrainingJob(null);
    }
  };

  const handleGoToTrain = () => {
    window.location.href = `/projects/${urlUserId}/${urlProjectId}/train`;
  };

  const handleDeleteModel = async () => {
    if (!actualSessionId || !actualProjectId) return;
    
    // Check if we have a trained model to delete
    if (!trainedModel) {
      alert('No trained model found to delete.');
      return;
    }
    
    // Show confirmation dialog
    if (!confirm('Are you sure you want to delete this trained model? This action cannot be undone and will permanently remove the model from Google Cloud Storage.')) {
      return;
    }
    
    setIsDeletingModel(true);
    
    try {
      console.log('🗑️ Deleting model via API');
      console.log('Session ID:', actualSessionId);
      console.log('Project ID:', actualProjectId);
      
      const deleteUrl = `${config.apiBaseUrl}${config.api.guests.deleteModel(actualProjectId)}?session_id=${actualSessionId}`;
      console.log('🗑️ Delete API URL:', deleteUrl);
      console.log('🗑️ Request headers:', {
        'Content-Type': 'application/json'
      });
      
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('🗑️ Delete API Response Status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Model deleted successfully:', result);
        
        // Clear local storage
        const modelKey = `yaaralabs_playground_model_${actualSessionId}_${actualProjectId}`;
        localStorage.removeItem(modelKey);
        
                 // Update UI state
         setTrainedModel(null);
         setTestResult(null);
         setCurrentTrainingJob(null);
         
         // Show success message
         alert('Model deleted successfully! The model has been removed from Google Cloud Storage and the project status has been reset to draft.');
         
         // Refresh training status to get updated project status
         setTimeout(() => {
           fetchTrainingStatus();
         }, 1000);
      } else {
        console.error('❌ Delete API failed:', response.status);
        
                 let errorDetails;
         try {
           errorDetails = await response.json();
           console.error('📋 Error Details:', errorDetails);
         } catch (jsonError) {
           const errorText = await response.text();
           console.error('📝 Error Text:', errorText);
           errorDetails = { detail: errorText };
         }
         
         // Show user-friendly error with more specific details
         if (response.status === 404) {
           alert('Model not found. It may have already been deleted.');
         } else if (response.status === 403) {
           alert('Access denied. You do not have permission to delete this model.');
         } else if (response.status === 422) {
           // Handle validation errors
           let errorMessage = 'Failed to delete model: Validation error.';
           if (errorDetails.detail && Array.isArray(errorDetails.detail)) {
             errorMessage = `Failed to delete model: ${errorDetails.detail.join(', ')}`;
           } else if (errorDetails.detail) {
             errorMessage = `Failed to delete model: ${errorDetails.detail}`;
           }
           alert(errorMessage);
         } else if (response.status === 500) {
           alert('Server error occurred while deleting the model. Please try again later.');
         } else {
           alert(`Failed to delete model (${response.status}): ${errorDetails.detail || 'Unknown error'}`);
         }
      }
    } catch (error) {
      console.error('❌ Network error during model deletion:', error);
      alert('Network error: Failed to connect to the server. Please check your connection and try again.');
    } finally {
      setIsDeletingModel(false);
    }
  };

  const modelSelector = isTextProject ? (
    <div className="flex flex-col items-end gap-1 w-full sm:w-auto shrink-0">
      <label htmlFor="text-model-select" className="text-fg/70 text-xs text-right whitespace-nowrap">
        Choose the machine learning model to train
      </label>
      <select
        id="text-model-select"
        value={selectedTextModel}
        onChange={(e) => setSelectedTextModel(e.target.value as 'logistic_regression' | 'distilbert')}
        disabled={isTraining}
        className="w-full sm:w-56 bg-canvas border border-magenta-brand/40 focus:border-pink-brand focus:outline-none text-fg text-sm rounded-lg px-3 py-2 disabled:opacity-50"
      >
        <option value="logistic_regression">Logistic Regression</option>
        <option value="distilbert">DistilBERT</option>
      </select>
    </div>
  ) : null;

  const handleTrainNewModel = async () => {
    // Clear previous model state
    setTrainedModel(null);
    setTestResult(null);
    
    // Start training the new model
    await handleTrainModel();
  };



  /** Same prediction call as the test box, for the sample test messages. */
  const predictText = async (text: string): Promise<Prediction> => {
    const response = await fetch(`${config.apiBaseUrl}${config.api.guests.predict(actualSessionId, actualProjectId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    });
    if (!response.ok) throw new Error(`Prediction failed (${response.status})`);
    const data: PredictionResponse = await response.json();
    if (!data.success || !data.label || typeof data.confidence !== 'number') throw new Error('Invalid prediction');
    return { label: data.label, confidence: Math.round(data.confidence * 100) / 100 };
  };

  const handleTestModel = async () => {
    if (!testText.trim() || !trainedModel || !actualSessionId || !actualProjectId) return;

    // Clear any existing test result
    setTestResult(null);

    // Check if model is available for predictions
    if (trainedModel.status !== 'available') {
      console.warn('⚠️ Model not ready for predictions. Model status:', trainedModel.status);
      alert('Model is not ready for predictions yet. Please wait for training to complete.');
      return;
    }

    setIsTestingModel(true);
    
    try {
      console.log('🔮 ===== PREDICTION REQUEST DEBUG =====');
      console.log('Text to predict:', testText);
      console.log('Text length:', testText.trim().length);
      console.log('Session ID:', actualSessionId);
      console.log('Project ID:', actualProjectId);
      console.log('Trained Model:', trainedModel);
      console.log('Current Training Job:', currentTrainingJob);
      
      const requestUrl = `${config.apiBaseUrl}${config.api.guests.predict(actualSessionId, actualProjectId)}`;
      console.log('Full request URL:', requestUrl);
      
      const requestPayload = {
        text: testText.trim()
      };
      console.log('Request payload:', requestPayload);

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload)
      });

      console.log('🔮 Prediction API response status:', response.status);
      console.log('🔮 Response headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        const responseText = await response.text();
        console.log('🔮 Raw response text:', responseText);
        
        try {
          const predictionData: PredictionResponse = JSON.parse(responseText);
          console.log('🔮 Parsed prediction response:', predictionData);

          if (predictionData.success && predictionData.label && typeof predictionData.confidence === 'number') {
    const newResult = {
      text: testText,
              prediction: predictionData.label,
              confidence: Math.round(predictionData.confidence * 100) / 100,
              alternatives: predictionData.alternatives || []
    };
    
            setTestResult(newResult);
    setTestText('');
            
            console.log('✅ Prediction successful:', newResult);
            console.log('📊 Prediction alternatives:', predictionData.alternatives);
          } else {
            console.error('❌ Prediction failed: Invalid response format');
            console.error('Response success:', predictionData.success);
            console.error('Response label:', predictionData.label);
            console.error('Response confidence:', predictionData.confidence);
            alert('Failed to get prediction. Invalid response format from server.');
          }
        } catch (parseError) {
          console.error('❌ JSON parse error:', parseError);
          console.error('Response was not valid JSON:', responseText);
          alert('Failed to parse prediction response. Server returned invalid data.');
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Prediction API failed:', response.status);
        console.error('❌ Error response body:', errorText);
        
        let errorMessage = 'Failed to get prediction. ';
        if (response.status === 404) {
          errorMessage += 'Model not found or not ready.';
        } else if (response.status === 422) {
          errorMessage += 'Invalid input text.';
        } else if (response.status === 500) {
          errorMessage += 'Server error occurred.';
        } else {
          errorMessage += `HTTP ${response.status}: ${errorText || 'Unknown error'}`;
        }
        
        alert(errorMessage);
      }
    } catch (error) {
      console.error('❌ Network/fetch error:', error);
      console.error('❌ Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      alert('Network error. Please check your connection and try again.');
    } finally {
      setIsTestingModel(false);
      console.log('🔮 ===== PREDICTION REQUEST END =====');
    }
  };

  // Image handling functions
  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type.startsWith('image/')) {
        setSelectedImage(file);
        const reader = new FileReader();
        reader.onload = (e) => {
          setImagePreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        alert('Please select a valid image file.');
      }
    }
  };

  const handleImageDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      alert('Please drop a valid image file.');
    }
  };

  const handleImageDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setImageUrl('');
    setCapturedImage(null);
    setImagePredictionResult(null);
  };

  // Webcam functions
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user' // Front camera
        } 
      });
      setWebcamStream(stream);
      setIsWebcamActive(true);
      
      // Set video element source when it's available
      if (webcamVideoRef) {
        webcamVideoRef.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing webcam:', error);
      alert('Unable to access webcam. Please check permissions and try again.');
    }
  };

  const stopWebcam = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach(track => track.stop());
      setWebcamStream(null);
      setIsWebcamActive(false);
    }
  };

  const captureImage = () => {
    if (webcamVideoRef && isWebcamActive) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (context) {
        // Set canvas dimensions to match video
        canvas.width = webcamVideoRef.videoWidth;
        canvas.height = webcamVideoRef.videoHeight;
        
        // Draw current video frame to canvas
        context.drawImage(webcamVideoRef, 0, 0, canvas.width, canvas.height);
        
        // Convert canvas to blob and create file
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `webcam_capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
            setSelectedImage(file);
            
            // Create preview URL
            const previewUrl = URL.createObjectURL(blob);
            setImagePreview(previewUrl);
            setCapturedImage(previewUrl);
            
            // Stop webcam after capture
            stopWebcam();
          }
        }, 'image/jpeg', 0.8);
      }
    }
  };

  const predictImage = async () => {
    if (!trainedModel || !actualSessionId || !actualProjectId) return;

    // Clear any existing prediction result
    setImagePredictionResult(null);

    // Check if model is available for predictions
    if (trainedModel.status !== 'available') {
      console.warn('⚠️ Model not ready for predictions. Model status:', trainedModel.status);
      alert('Model is not ready for predictions yet. Please wait for training to complete.');
      return;
    }

    // Validate input based on mode
    if (predictionMode === 'upload' && !selectedImage) {
      alert('Please select an image to upload.');
      return;
    }
    if (predictionMode === 'url' && !imageUrl.trim()) {
      alert('Please enter an image URL.');
      return;
    }
    if (predictionMode === 'webcam' && !selectedImage) {
      alert('Please capture an image using the webcam.');
      return;
    }

    try {
      setIsUploadingImage(true);
      setIsPredictingImage(true);

      const predictionLabel = 'prediction';
      let finalImageUrl: string;

      if (predictionMode === 'upload' || predictionMode === 'webcam') {
        // Upload file mode for prediction only (does not store in training dataset)
        console.log(`📤 Uploading image file for prediction only (${predictionMode} mode)...`);
        
      const formData = new FormData();
        formData.append('files', selectedImage!);

      const uploadResponse = await fetch(
          `${config.apiBaseUrl}/api/guests/session/${actualSessionId}/projects/${actualProjectId}/predict-image`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
          console.error('❌ Prediction upload failed:', uploadResponse.status, errorText);
          throw new Error(`Failed to upload image for prediction: ${uploadResponse.status}`);
      }

      const uploadData = await uploadResponse.json();
        console.log('✅ Prediction upload successful:', uploadData);
        
        finalImageUrl = uploadData.imageUrl;

        if (!finalImageUrl) {
          throw new Error('No image URL returned from prediction upload');
        }
      } else {
        // URL mode - use prediction-only API endpoint
        console.log('📤 Uploading image from URL for prediction only...');
        
        const formData = new FormData();
        formData.append('image_url', imageUrl.trim());

        const uploadResponse = await fetch(
          `${config.apiBaseUrl}/api/guests/session/${actualSessionId}/projects/${actualProjectId}/predict-image/url`,
          {
            method: 'POST',
            body: formData,
          }
        );

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          let detail = '';
          try { detail = JSON.parse(errorText).detail || ''; } catch { /* not JSON */ }
          // 4xx = a problem with the pasted link (explained in detail), not an app error
          if (uploadResponse.status < 500) {
            console.warn('⚠️ URL prediction upload rejected:', uploadResponse.status, errorText);
          } else {
            console.error('❌ URL prediction upload failed:', uploadResponse.status, errorText);
          }
          throw new Error(detail || `Failed to upload image from URL for prediction: ${uploadResponse.status}`);
        }

        const uploadData = await uploadResponse.json();
        console.log('✅ URL prediction upload successful:', uploadData);
        
        finalImageUrl = uploadData.imageUrl;

        if (!finalImageUrl) {
          throw new Error('No GCS URL returned from URL prediction upload');
        }
      }

      console.log('🔮 Making prediction with image URL:', finalImageUrl);

      // Now make prediction with the GCS URL
      const predictionResponse = await fetch(
        `${config.apiBaseUrl}/api/guests/session/${actualSessionId}/projects/${actualProjectId}/predict`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: finalImageUrl, // For image recognition, we pass the GCS URL as text
          }),
        }
      );

      if (predictionResponse.ok) {
        const predictionData = await predictionResponse.json();
        console.log('✅ Prediction successful:', predictionData);
        if (predictionData.success) {
          setImagePredictionResult({
            predicted_class: predictionData.label,
            confidence: predictionData.confidence,
            all_probabilities: predictionData.alternatives || []
          });
        } else {
          alert('Prediction failed: ' + predictionData.message);
        }
      } else {
        const errorText = await predictionResponse.text();
        console.error('❌ Prediction failed:', predictionResponse.status, errorText);
        let detail = '';
        try { detail = JSON.parse(errorText).detail || ''; } catch { /* not JSON */ }
        throw new Error(detail || `Prediction request failed: ${predictionResponse.status}`);
      }
    } catch (error) {
      console.warn('⚠️ Image prediction failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert('Failed to predict image: ' + errorMessage);
    } finally {
      setIsUploadingImage(false);
      setIsPredictingImage(false);
    }
  };

  const handleDescribeModel = () => {
    // This could open a modal or navigate to a description page
    console.log('Describe model clicked');
  };

  // Check if training requirements are met
  const canTrainModel = trainingStats.totalExamples >= 5 && trainingStats.totalLabels >= 2;

  if (isLoading || isInitializing) {
    return (
      <div className="min-h-screen bg-canvas text-fg">
        <Header />
        <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
          <div>
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <div className="w-16 h-16 border-4 border-magenta-brand/20 border-t-pink-brand rounded-full animate-spin mx-auto mb-4"></div>
                <div className="text-fg text-xl">Loading project data...</div>
                <div className="text-fg/70 text-sm mt-2">Please wait while we set up your learning environment</div>
              </div>
            </div>
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

  // Show original Learn page (when no model is trained)
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <Header />

      <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div>
          {/* Back to Project Link */}
          <div className="mb-6">
            <Link
              href={`/projects/${urlUserId}/${urlProjectId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-fg/70 hover:text-white hover:bg-purple-brand/10 rounded-lg transition-all duration-300 text-xs"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to project
            </Link>
          </div>

          {/* Main Title */}
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-bold mb-3">
              <span className="text-fg">Machine learning </span>
              <span className="text-pink-brand">models</span>
            </h1>
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
            {/* Left Box: What have you done? */}
            <div className="bg-canvas border border-magenta-brand/20 rounded-xl p-8 shadow-lg">
              <h2 className="text-2xl md:text-3xl font-bold text-fg mb-6 text-left">
                What have you done?
              </h2>
              <div className="text-fg space-y-4">
                <p className="text-base leading-relaxed">
                  You have collected examples of text for a computer to use to recognise different types of text.
                </p>
                <p className="text-base font-medium">You&apos;ve collected:</p>
                {trainingStats.labelBreakdown.length > 0 ? (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                    {trainingStats.labelBreakdown.map((label, index) => (
                      <li key={index} className="flex items-center gap-2 min-w-0">
                        <span className="w-1.5 h-1.5 bg-purple-brand rounded-full flex-shrink-0"></span>
                        <span className="truncate">{label.count} examples of {label.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-fg/50 italic">No examples collected yet</p>
                )}
                <div className="pt-4 border-t border-magenta-brand/20">
                  <p className="text-sm text-fg/70">
                    <strong>Total:</strong> {trainingStats.totalExamples} examples across {trainingStats.totalLabels} labels
                  </p>
                </div>
              </div>
            </div>

            {/* Right Box: What's next? */}
            <div className="bg-canvas border border-magenta-brand/20 rounded-xl p-8 shadow-lg">
              <h2 className="text-2xl md:text-3xl font-bold text-fg mb-6 text-left">
                What&apos;s next?
              </h2>
              <div className="text-fg space-y-4">
                <p className="text-base font-medium">
                  Ready to start the computer&apos;s training?
                </p>
                <p className="text-base leading-relaxed">
                  Click the button below to start training a machine learning model using the examples you have collected so far
                </p>
                <p className="text-sm text-fg/70">
                  (Or go back to the{' '}
                  <button
                    onClick={handleGoToTrain}
                    className="text-pink-brand hover:text-pink-brand/80 underline font-medium"
                  >
                    Train
                  </button>
                  {' '}page if you want to collect some more examples first.)
                </p>
              </div>
            </div>
          </div>

                                {/* Bottom Section: Info from training computer */}
            <div className="bg-canvas border border-magenta-brand/20 rounded-xl px-6 py-5 shadow-lg">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h3 className="text-xl font-semibold text-fg">
                  Info from training computer:
                </h3>
                {!isTraining && !isInitializing && modelSelector}
              </div>
            
                         {/* Loading State */}
             {isInitializing && (
               <div className="text-center mb-6">
                 <div className="w-16 h-16 border-4 border-magenta-brand/20 border-t-pink-brand rounded-full animate-spin mx-auto mb-4"></div>
                 <h4 className="text-xl font-bold text-fg mb-2">Loading...</h4>
                 <p className="text-fg/70 mb-4">Please wait while we load your project data...</p>
               </div>
             )}

                         {/* Training in Progress */}
             {isTraining && (
               <div className="text-center mb-6">
                 <div className="w-16 h-16 border-4 border-magenta-brand/20 border-t-pink-brand rounded-full animate-spin mx-auto mb-4"></div>
                 <h4 className="text-xl font-bold text-fg mb-2">Training in Progress</h4>
                 <p className="text-fg/70 mb-4">Your machine learning model is being trained...</p>
                 
                 {/* Status indicator */}
                 {isStatusLoading && (
                   <div className="text-center pt-2">
                     <p className="text-pink-brand text-sm">Checking training status...</p>
                   </div>
                 )}
                <div className="bg-canvas border border-magenta-brand/20 rounded-lg p-4 max-w-md mx-auto">
                  <div className="space-y-2 text-left">
                    <div className="flex justify-between">
                      <span className="text-fg/70">Status:</span>
                      <span className="text-pink-brand font-medium">
                        {currentTrainingJob?.status === 'running' ? 'Training' : 
                         currentTrainingJob?.status === 'pending' ? 'Starting...' : 'Training'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg/70">Progress:</span>
                      <span className="text-pink-brand font-medium">
                        {currentTrainingJob?.progress ? `${currentTrainingJob.progress}%` : 'Processing examples...'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg/70">Job ID:</span>
                      <span className="text-pink-brand font-medium text-xs">
                        {currentTrainingJob?.id ? currentTrainingJob.id.substring(0, 8) + '...' : 'Starting...'}
                      </span>
                    </div>
                    {currentTrainingJob?.status === 'pending' && (
                      <div className="text-center pt-2">
                        <p className="text-pink-brand text-sm">Initializing training job...</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

                         {/* Trained Model Interface */}
             {trainedModel && !isTraining && (
               <div className="space-y-6">
                 {/* Status indicator */}
                 {isStatusLoading && (
                   <div className="text-center mb-4">
                     <p className="text-pink-brand text-sm">Checking model status...</p>
                   </div>
                 )}
                                 {/* Model Testing Section */}
                 <div className="bg-canvas border border-magenta-brand/20 rounded-lg p-6">
                   {selectedProject?.type === 'image-recognition' ? (
                     // Image Recognition Interface
                     <>
                       <h4 className="text-lg font-semibold text-fg mb-4">
                         Upload an image, provide an image URL, or capture with your webcam to see how it&apos;s classified based on your training.
                       </h4>
                       
                       {/* Mode Selection */}
                       <div className="mb-6">
                         <div className="flex gap-4 mb-4 flex-wrap">
                           <button
                             onClick={() => {
                               setPredictionMode('upload');
                               clearImage();
                               stopWebcam();
                             }}
                             className={`px-4 py-2 rounded-lg font-medium transition-colors duration-300 ${
                               predictionMode === 'upload'
                                 ? 'bg-purple-brand text-white'
                                 : 'bg-canvas border border-magenta-brand/20 text-fg hover:border-magenta-brand/40'
                             }`}
                           >
                             Upload Image
                           </button>
                           <button
                             onClick={() => {
                               setPredictionMode('url');
                               clearImage();
                               stopWebcam();
                             }}
                             className={`px-4 py-2 rounded-lg font-medium transition-colors duration-300 ${
                               predictionMode === 'url'
                                 ? 'bg-purple-brand text-white'
                                 : 'bg-canvas border border-magenta-brand/20 text-fg hover:border-magenta-brand/40'
                             }`}
                           >
                             Image URL
                           </button>
                           <button
                             onClick={() => {
                               setPredictionMode('webcam');
                               clearImage();
                             }}
                             className={`px-4 py-2 rounded-lg font-medium transition-colors duration-300 ${
                               predictionMode === 'webcam'
                                 ? 'bg-purple-brand text-white'
                                 : 'bg-canvas border border-magenta-brand/20 text-fg hover:border-magenta-brand/40'
                             }`}
                           >
                             📷 Webcam
                           </button>
                         </div>
                       </div>
                       
                       {/* Image Upload/URL Area */}
                       <div className="mb-6">
                         {predictionMode === 'upload' ? (
                           // Upload Mode
                           !imagePreview ? (
                           <div
                             className="border-2 border-dashed border-magenta-brand/30 rounded-lg p-8 text-center hover:border-magenta-brand/50 transition-colors duration-300 cursor-pointer"
                             onDrop={handleImageDrop}
                             onDragOver={handleImageDragOver}
                             onClick={() => document.getElementById('image-upload')?.click()}
                           >
                             <div className="space-y-4">
                               <div className="text-4xl text-purple-brand/50">📷</div>
                               <div>
                                 <p className="text-fg font-medium mb-2">Drop an image here or click to browse</p>
                                 <p className="text-fg/70 text-sm">Supports JPG, PNG, GIF, WebP</p>
                               </div>
                             </div>
                             <input
                               id="image-upload"
                               type="file"
                               accept="image/*"
                               onChange={handleImageSelect}
                               className="hidden"
                             />
                           </div>
                         ) : (
                           <div className="space-y-4">
                             <div className="relative">
                               <img
                                 src={imagePreview}
                                 alt="Preview"
                                 className="max-w-full max-h-64 mx-auto rounded-lg"
                               />
                               <button
                                 onClick={clearImage}
                                 className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm"
                               >
                                 ×
                               </button>
                             </div>
                             <div className="flex gap-4 justify-center">
                               <button
                                 onClick={predictImage}
                                 disabled={isPredictingImage || isUploadingImage}
                                 className="bg-purple-brand hover:bg-purple-brand/90 disabled:bg-canvas disabled:border disabled:border-magenta-brand/20 disabled:text-fg/50 text-white px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                               >
                                 {isPredictingImage || isUploadingImage ? (
                                   <div className="flex items-center gap-2">
                                     <div className="w-4 h-4 border-2 border-fg/20 border-t-fg rounded-full animate-spin"></div>
                                     {isUploadingImage ? 'Uploading...' : 'Predicting...'}
                                   </div>
                                 ) : (
                                   'Predict Image'
                                 )}
                               </button>
                               <button
                                 onClick={clearImage}
                                 className="bg-canvas border border-magenta-brand/20 hover:border-magenta-brand/40 text-fg px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                               >
                                 Clear
                               </button>
                               </div>
                             </div>
                           )
                         ) : predictionMode === 'url' ? (
                           // URL Mode
                           <div className="space-y-4">
                             <div>
                               <label className="block text-fg font-medium mb-2">
                                 Enter Image URL:
                               </label>
                               <input
                                 type="url"
                                 value={imageUrl}
                                 onChange={(e) => setImageUrl(e.target.value)}
                                 placeholder="https://example.com/image.jpg"
                                 className="w-full px-4 py-3 bg-canvas border border-magenta-brand/20 rounded-lg text-fg placeholder-fg/50 focus:outline-none focus:border-pink-brand focus:ring-1 focus:ring-pink-brand transition-all duration-300"
                               />
                               <p className="text-fg/70 text-sm mt-2">
                                 Enter a direct URL to an image (JPG, PNG, GIF, WebP)
                               </p>
                             </div>
                             
                             {/* Image Preview for URL */}
                             {imageUrl && (
                               <div className="space-y-4">
                                 <div className="relative">
                                   <img
                                     src={imageUrl}
                                     alt="URL Preview"
                                     className="max-w-full max-h-64 mx-auto rounded-lg"
                                     onError={(e) => {
                                       e.currentTarget.style.display = 'none';
                                     }}
                                   />
                             </div>
                               </div>
                             )}
                             
                             <div className="flex gap-4 justify-center">
                               <button
                                 onClick={predictImage}
                                 disabled={!imageUrl.trim() || isPredictingImage || isUploadingImage}
                                 className="bg-purple-brand hover:bg-purple-brand/90 disabled:bg-canvas disabled:border disabled:border-magenta-brand/20 disabled:text-fg/50 text-white px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                               >
                                 {isPredictingImage || isUploadingImage ? (
                                   <div className="flex items-center gap-2">
                                     <div className="w-4 h-4 border-2 border-fg/20 border-t-fg rounded-full animate-spin"></div>
                                     Predicting...
                                   </div>
                                 ) : (
                                   'Predict Image'
                                 )}
                               </button>
                               <button
                                 onClick={clearImage}
                                 className="bg-canvas border border-magenta-brand/20 hover:border-magenta-brand/40 text-fg px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                               >
                                 Clear
                               </button>
                             </div>
                           </div>
                         ) : (
                           // Webcam Mode
                           <div className="space-y-4">
                             {!isWebcamActive && !capturedImage ? (
                               // Start webcam button
                               <div className="text-center">
                                 <div className="mb-4">
                                   <div className="text-4xl text-purple-brand/50 mb-2">📷</div>
                                   <p className="text-fg font-medium mb-2">Capture an image using your webcam</p>
                                   <p className="text-fg/70 text-sm">Click the button below to start your camera</p>
                                 </div>
                                 <button
                                   onClick={startWebcam}
                                   className="bg-purple-brand hover:bg-purple-brand/90 text-white px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                                 >
                                   Start Camera
                                 </button>
                               </div>
                             ) : isWebcamActive ? (
                               // Webcam active - show video and capture button
                               <div className="space-y-4">
                                 <div className="relative">
                                   <video
                                     ref={(ref) => {
                                       if (ref) {
                                         setWebcamVideoRef(ref);
                                         ref.srcObject = webcamStream;
                                       }
                                     }}
                                     autoPlay
                                     playsInline
                                     muted
                                     className="max-w-full max-h-64 mx-auto rounded-lg"
                                   />
                                   <div className="absolute inset-0 border-2 border-pink-brand rounded-lg pointer-events-none"></div>
                                 </div>
                                 <div className="flex gap-4 justify-center">
                                   <button
                                     onClick={captureImage}
                                     className="bg-purple-brand hover:bg-purple-brand/90 text-white px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                                   >
                                     📸 Capture Photo
                                   </button>
                                   <button
                                     onClick={stopWebcam}
                                     className="bg-canvas border border-magenta-brand/20 hover:border-magenta-brand/40 text-fg px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                                   >
                                     Cancel
                                   </button>
                                 </div>
                               </div>
                             ) : (
                               // Captured image preview
                               <div className="space-y-4">
                                 <div className="relative">
                                   <img
                                     src={capturedImage || ''}
                                     alt="Captured"
                                     className="max-w-full max-h-64 mx-auto rounded-lg"
                                   />
                                   <button
                                     onClick={clearImage}
                                     className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm"
                                   >
                                     ×
                                   </button>
                                 </div>
                                 <div className="flex gap-4 justify-center">
                                   <button
                                     onClick={predictImage}
                                     disabled={isPredictingImage || isUploadingImage}
                                     className="bg-purple-brand hover:bg-purple-brand/90 disabled:bg-canvas disabled:border disabled:border-magenta-brand/20 disabled:text-fg/50 text-white px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                                   >
                                     {isPredictingImage || isUploadingImage ? (
                                       <div className="flex items-center gap-2">
                                         <div className="w-4 h-4 border-2 border-fg/20 border-t-fg rounded-full animate-spin"></div>
                                         {isUploadingImage ? 'Uploading...' : 'Predicting...'}
                                       </div>
                                     ) : (
                                       'Predict Image'
                                     )}
                                   </button>
                                   <button
                                     onClick={() => {
                                       clearImage();
                                       startWebcam();
                                     }}
                                     className="bg-canvas border border-magenta-brand/20 hover:border-magenta-brand/40 text-fg px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                                   >
                                     Take Another
                                   </button>
                                 </div>
                               </div>
                             )}
                           </div>
                         )}
                       </div>

                       {/* Image Prediction Results */}
                       {imagePredictionResult && (
                         <div className="mt-4">
                           <h5 className="text-md font-medium text-fg mb-3">Prediction Result:</h5>
                           <div className="bg-purple-brand/10 p-4 rounded-lg border border-magenta-brand/20">
                             <div className="mb-3">
                               <span className="text-fg font-medium">Predicted Class: </span>
                               <span className="text-pink-brand font-bold text-lg">
                                 {imagePredictionResult.predicted_class}
                               </span>
                             </div>
                             <div className="mb-3">
                               <span className="text-fg/70">Confidence: </span>
                               <span className="text-pink-brand font-medium">
                                 {imagePredictionResult.confidence.toFixed(1)}%
                               </span>
                             </div>
                             
                           </div>
                         </div>
                       )}
                     </>
                   ) : (
                     // Text Recognition Interface
                     <>
                       <h4 className="text-lg font-semibold text-fg mb-4">
                         Try putting in some text to see how it is recognised based on your training.
                       </h4>
                       <div className="flex gap-4 items-end mb-4">
                         <div className="flex-1">
                           <input
                             type="text"
                             value={testText}
                             onChange={(e) => setTestText(e.target.value)}
                             onKeyDown={(e) => {
                               if (e.key === 'Enter' && testText.trim() && !isTestingModel) {
                                 e.preventDefault();
                                 handleTestModel();
                               }
                             }}
                             placeholder="enter a test text here (Enter to test)"
                             className="w-full px-4 py-3 bg-canvas border border-magenta-brand/20 rounded-lg text-fg placeholder-fg/50 focus:outline-none focus:border-pink-brand focus:ring-1 focus:ring-pink-brand transition-all duration-300"
                           />
                         </div>
                         <button
                           onClick={handleTestModel}
                           disabled={!testText.trim() || isTestingModel}
                           className="bg-purple-brand hover:bg-purple-brand/90 disabled:bg-canvas disabled:border disabled:border-magenta-brand/20 disabled:text-fg/50 text-white px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                         >
                           {isTestingModel ? (
                             <div className="flex items-center gap-2">
                               <div className="w-4 h-4 border-2 border-fg/20 border-t-fg rounded-full animate-spin"></div>
                               Testing...
                             </div>
                           ) : (
                             'Test'
                           )}
                         </button>
                       </div>

                       {/* Text Test Results */}
                       {testResult && (
                         <div className="mt-4">
                           <h5 className="text-md font-medium text-fg mb-3">Test Result:</h5>
                           <div className="bg-purple-brand/10 p-4 rounded-lg border border-magenta-brand/20">
                             <div className="mb-2">
                               <span className="text-fg font-medium">&ldquo;{testResult.text}&rdquo;</span>
                             </div>
                             <div className="flex items-center gap-2 mb-2">
                               <span className="text-fg/70">Confidence:</span>
                               <span className="text-pink-brand font-medium">
                                 {testResult.prediction} ({testResult.confidence.toFixed(1)}%)
                               </span>
                             </div>
                           </div>
                         </div>
                       )}

                       {trainedModel.status === 'available' && (
                         <SampleTestMessages
                           projectLabels={trainingStats.labelBreakdown.map((l) => l.name)}
                           predict={predictText}
                         />
                       )}
                     </>
                   )}
                </div>

                {/* Training Results */}
                {currentTrainingJob && currentTrainingJob.result && (
                  <div className="bg-canvas border border-magenta-brand/20 rounded-lg p-6 mb-6">
                    <h4 className="text-lg font-semibold text-fg mb-4">Training Results</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-fg/70">Accuracy:</span>
                          <span className="text-pink-brand font-medium">{currentTrainingJob.result.accuracy}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-fg/70">Training Examples:</span>
                          <span className="text-fg font-medium">{currentTrainingJob.result.training_examples}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-fg/70">Validation Examples:</span>
                          <span className="text-fg font-medium">{currentTrainingJob.result.validation_examples}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-fg/70">Total Features:</span>
                          <span className="text-fg font-medium">{currentTrainingJob.result.total_features}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-fg/70">Labels:</span>
                          <span className="text-fg font-medium">{currentTrainingJob.result.labels.join(', ')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-fg/70">Job ID:</span>
                          <span className="text-fg font-medium text-xs">{currentTrainingJob.id.substring(0, 8)}...</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Feature Importance */}
                    {currentTrainingJob.result.feature_importance && Object.keys(currentTrainingJob.result.feature_importance).length > 0 && (
                      <div className="mt-4">
                        <h5 className="text-md font-medium text-fg mb-3">Important Features by Label:</h5>
                        <div className="space-y-3">
                          {Object.entries(currentTrainingJob.result.feature_importance).map(([label, features]) => (
                            <div key={label}>
                              <h6 className="text-sm font-medium text-pink-brand mb-1">{label}:</h6>
                              <div className="flex flex-wrap gap-1">
                                {features.slice(0, 5).map((feature, index) => (
                                  <span key={index} className="inline-block bg-purple-brand/15 text-white text-xs px-2 py-1 rounded-full">
                                    {feature}
                                  </span>
                                ))}
                                {features.length > 5 && (
                                  <span className="inline-block text-fg/50 text-xs px-2 py-1">
                                    +{features.length - 5} more
                                  </span>
                                )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                )}

                {/* Model Information */}
                <div className="bg-canvas border border-magenta-brand/20 rounded-lg p-6">
                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between">
                      <span className="text-fg/70">Model started training at:</span>
                      <span className="text-fg font-medium">
                        {trainedModel.startedAt.toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg/70">Current model status:</span>
                      <span className="text-pink-brand font-medium">{trainedModel.status}</span>
                    </div>
                    {isTextProject && trainedModelType && (
                      <div className="flex justify-between">
                        <span className="text-fg/70">Model used:</span>
                        <span className="text-fg font-medium">{modelTypeLabel(trainedModelType)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-fg/70">Model will automatically be deleted after:</span>
                      <span className="text-fg font-medium">
                        {trainedModel.expiresAt.toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-4">
                                         <button
                       onClick={handleDeleteModel}
                       disabled={isDeletingModel || !trainedModel}
                       className="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white px-6 py-3 rounded-lg font-medium transition-colors duration-300 flex items-center gap-2"
                     >
                      {isDeletingModel ? (
                        <>
                          <div className="w-4 h-4 border-2 border-fg/20 border-t-fg rounded-full animate-spin"></div>
                          Deleting...
                        </>
                      ) : (
                        'Delete this model'
                      )}
                    </button>
                    <button
                      onClick={handleTrainNewModel}
                      className="bg-purple-brand hover:bg-purple-brand/90 text-white px-6 py-3 rounded-lg font-medium transition-colors duration-300"
                    >
                      Train new machine learning model
                    </button>
                  </div>
                </div>
              </div>
            )}

                                      {/* Default Training Interface */}
             {!isTraining && !trainedModel && (
               <div className="flex flex-col items-center gap-3 pt-1">
                {!canTrainModel && (
                  <div className="text-center p-4 bg-canvas border border-magenta-brand/20 rounded-lg max-w-md">
                    <div className="flex items-start gap-3">
                      
                      <div>
                        <h4 className="text-pink-brand font-medium mb-2">⚠ Requirements not met</h4>
                        <p className="text-fg text-sm">
                          You need at least <strong>5 examples</strong> and <strong>2 labels</strong> to train a model.
                          <br />
                          Current: {trainingStats.totalExamples} examples, {trainingStats.totalLabels} labels
                        </p>
                        <button
                          onClick={handleGoToTrain}
                          className="mt-3 bg-purple-brand hover:bg-purple-brand/90 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300"
                        >
                          Go to Train Page
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Only show the train button when requirements are met */}
                {canTrainModel && (
                  <button
                    onClick={handleTrainModel}
                    disabled={isTraining}
                    className={`px-8 py-4 rounded-lg font-medium text-lg transition-all duration-300 shadow-lg ${
                      !isTraining
                        ? 'bg-purple-brand hover:bg-purple-brand/90 text-white hover:scale-105'
                        : 'bg-canvas border border-magenta-brand/20 text-fg/50 cursor-not-allowed'
                    }`}
                  >
                    {isTraining ? (
                      <>
                        ⏳ Training in progress...
                        <br />
                        <span className="text-sm opacity-75">
                          Please wait for completion
                        </span>
                      </>
                    ) : (
                      <>
                        🚀 Train new machine learning model
                        <br />
                        <span className="text-sm opacity-75">
                          ({trainingStats.totalExamples} examples, {trainingStats.totalLabels} labels)
                        </span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}

