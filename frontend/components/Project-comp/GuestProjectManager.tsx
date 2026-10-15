'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
    useGuestProjects, 
    useCreateGuestProject, 
    useUpdateGuestProject, 
    useDeleteGuestProject,
    useGuestTraining,
    useGuestTrainingStatus,
    useUploadGuestExamples,
    useGuestPrediction
} from '../../lib/use-api';
import { Project } from '../../lib/api-service';
import config from '../../lib/config';

interface GuestProjectFormData {
    name: string;
    description: string;
    type: string;  // Changed from model_type to type
    teachable_machine_link?: string;  // Changed from teachable_link to teachable_machine_link
}

interface ValidationState {
    isValidating: boolean;
    isValid: boolean | null;
    error: string | null;
}

interface GuestProjectManagerProps {
    sessionId: string;
}

const GuestProjectManager: React.FC<GuestProjectManagerProps> = ({ sessionId }) => {
    const [formData, setFormData] = useState<GuestProjectFormData>({
        name: '',
        description: '',
        type: 'text-recognition',  // Changed from 'text' to 'text-recognition' to match backend
        teachable_machine_link: ''
    });
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [trainingConfig, setTrainingConfig] = useState({
        epochs: 100,
        batch_size: 32,
        learning_rate: 0.001
    });
    const [predictionInput, setPredictionInput] = useState('');
    const [examples, setExamples] = useState<Array<{text: string, label: string}>>([
        { text: '', label: '' }
    ]);
    const [urlValidation, setUrlValidation] = useState<ValidationState>({
        isValidating: false,
        isValid: null,
        error: null
    });
    const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // API hooks
    const guestProjects = useGuestProjects(sessionId);
    const createGuestProject = useCreateGuestProject();
    const updateGuestProject = useUpdateGuestProject();
    const deleteGuestProject = useDeleteGuestProject();
    const guestTraining = useGuestTraining();
    const guestTrainingStatus = useGuestTrainingStatus(sessionId, selectedProject?.id || '');
    const uploadGuestExamples = useUploadGuestExamples();
    const guestPrediction = useGuestPrediction();

    // Load projects on component mount
    useEffect(() => {
        if (sessionId) {
            guestProjects.execute();
        }
    }, [sessionId]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (validationTimeoutRef.current) {
                clearTimeout(validationTimeoutRef.current);
            }
        };
    }, []);

    // Validate Teachable Machine URL
    const validateTeachableMachineUrl = async (url: string): Promise<boolean> => {
        console.log('Validating URL:', url);
        
        if (!url) {
            console.log('No URL provided');
            return false;
        }

        // Normalize URL - add https:// if missing
        let normalizedUrl = url.trim();
        if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
            normalizedUrl = 'https://' + normalizedUrl;
        }

        // Check if it's a valid Teachable Machine URL format
        if (!normalizedUrl.includes('teachablemachine.withgoogle.com/models/')) {
            console.log('Invalid Teachable Machine URL format');
            return false;
        }

        // Ensure URL ends with /
        if (!normalizedUrl.endsWith('/')) {
            normalizedUrl += '/';
        }

        // Check if model.json exists
        const modelUrl = normalizedUrl + 'model.json';
        console.log('Checking model URL:', modelUrl);
        
        try {
            const response = await fetch(modelUrl, { 
                method: 'HEAD',
                mode: 'cors'
            });
            console.log('Response status:', response.status, 'OK:', response.ok);
            return response.ok;
        } catch (error) {
            console.error('Error validating Teachable Machine URL:', error);
            return false;
        }
    };

    // Handle URL validation when teachable machine link changes
    const handleTeachableLinkChange = (url: string) => {
        console.log('handleTeachableLinkChange called with:', url, 'type:', formData.type);
        setFormData({ ...formData, teachable_machine_link: url });
        
        // Clear any existing timeout
        if (validationTimeoutRef.current) {
            clearTimeout(validationTimeoutRef.current);
        }
        
        if (url && formData.type === 'image-recognition-teachable-machine') {
            console.log('Starting validation for Teachable Machine URL');
            // Clear previous validation state
            setUrlValidation({ isValidating: false, isValid: null, error: null });
            
            // Debounce validation - only validate after user stops typing for 1 second
            validationTimeoutRef.current = setTimeout(async () => {
                console.log('Validation timeout triggered');
                setUrlValidation({ isValidating: true, isValid: null, error: null });
                
                const isValid = await validateTeachableMachineUrl(url);
                console.log('Validation result:', isValid);
                setUrlValidation({ 
                    isValidating: false, 
                    isValid, 
                    error: isValid ? null : 'Invalid Teachable Machine URL. Please enter a valid URL.' 
                });
            }, 1000);
        } else {
            console.log('Not validating - URL or type not suitable');
            setUrlValidation({ isValidating: false, isValid: null, error: null });
        }
    };

    // Auto-open Scratch editor for newly created image recognition projects
    useEffect(() => {
        if (guestProjects.data && guestProjects.data.length > 0 && formData.type === 'image-recognition-teachable-machine') {
            // Find the most recently created project that matches our form data
            const latestProject = guestProjects.data
                .filter(p => p.name === formData.name && p.type === 'image-recognition-teachable-machine')
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            
            if (latestProject && !selectedProject) {
                // Open Scratch editor for this project
                openScratchEditor(latestProject.id);
            }
        }
    }, [guestProjects.data, formData.type, formData.name, selectedProject]);

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        console.log('=== FORM SUBMISSION START ===');
        console.log('Type:', formData.type);
        console.log('URL:', formData.teachable_machine_link);
        console.log('Validation state:', urlValidation);
        
        // ALWAYS validate Teachable Machine URL if required - no exceptions
        if ((formData.type === 'image-recognition-teachable-machine' || formData.type === 'pose-recognition-teachable-machine') && formData.teachable_machine_link) {
            console.log('Validating Teachable Machine URL...');
            
            // Always validate, regardless of previous state
            setUrlValidation({ isValidating: true, isValid: null, error: null });
            
            const isValid = await validateTeachableMachineUrl(formData.teachable_machine_link);
            console.log('Validation result:', isValid);
            
            if (!isValid) {
                setUrlValidation({ 
                    isValidating: false, 
                    isValid: false, 
                    error: 'Invalid Teachable Machine URL. Please enter a valid URL.' 
                });
                console.log('BLOCKING SUBMISSION - URL is invalid');
                alert('Invalid Teachable Machine URL. Please enter a valid URL.');
                return;
            } else {
                setUrlValidation({ 
                    isValidating: false, 
                    isValid: true, 
                    error: null 
                });
                console.log('URL validation passed');
            }
        }
        
        console.log('Proceeding with form submission');
        if (selectedProject) {
            await updateGuestProject.execute(sessionId, selectedProject.id, formData);
        } else {
            await createGuestProject.execute(sessionId, formData);
        }
        
        // Reset form and reload projects
        setFormData({ name: '', description: '', type: 'text-recognition', teachable_machine_link: '' });
        setSelectedProject(null);
        setUrlValidation({ isValidating: false, isValid: null, error: null });
        guestProjects.execute();
        console.log('=== FORM SUBMISSION END ===');
    };

    // Open Scratch editor for image recognition projects
    const openScratchEditor = (projectId: string) => {
        // Get the project name from the selected project or form data
        const projectName = selectedProject?.name || formData.name;
        const scratchUrl = `${config.scratchEditor.gui}?sessionId=${sessionId}&projectId=${projectId}&projectName=${encodeURIComponent(projectName)}&teachableLink=${encodeURIComponent(formData.teachable_machine_link || '')}`;
        window.open(scratchUrl, '_blank');
    };

    // Handle project selection
    const handleProjectSelect = (project: Project) => {
        setSelectedProject(project);
        setFormData({
            name: project.name,
            description: project.description || '',
            type: project.type || 'text-recognition',
            teachable_machine_link: project.teachable_machine_link || ''
        });
        // Reset validation state when selecting a project
        setUrlValidation({ isValidating: false, isValid: null, error: null });
        
        // If editing a Teachable Machine project, validate the existing URL
        if ((project.type === 'image-recognition-teachable-machine' || project.type === 'pose-recognition-teachable-machine') && project.teachable_machine_link) {
            console.log('Validating existing Teachable Machine URL:', project.teachable_machine_link);
            validateTeachableMachineUrl(project.teachable_machine_link).then(isValid => {
                setUrlValidation({ 
                    isValidating: false, 
                    isValid, 
                    error: isValid ? null : 'Invalid Teachable Machine URL. Please enter a valid URL.' 
                });
            });
        }
    };

    // Handle project deletion
    const handleDeleteProject = async (projectId: string) => {
        if (confirm('Are you sure you want to delete this project?')) {
            await deleteGuestProject.execute(sessionId, projectId);
            guestProjects.execute();
        }
    };

    // Handle training start
    const handleStartTraining = async () => {
        if (selectedProject) {
            await guestTraining.execute(sessionId, selectedProject.id, trainingConfig);
            // Start monitoring training status
            guestTrainingStatus.execute();
        }
    };

    // Handle examples upload
    const handleUploadExamples = async () => {
        if (selectedProject && examples.some(ex => ex.text && ex.label)) {
            const validExamples = examples.filter(ex => ex.text && ex.label);
            await uploadGuestExamples.execute(sessionId, selectedProject.id, validExamples);
            setExamples([{ text: '', label: '' }]);
        }
    };

    // Handle prediction
    const handlePrediction = async () => {
        if (selectedProject && predictionInput.trim()) {
            await guestPrediction.execute(sessionId, selectedProject.id, { text: predictionInput });
        }
    };

    // Add new example field
    const addExample = () => {
        setExamples([...examples, { text: '', label: '' }]);
    };

    // Remove example field
    const removeExample = (index: number) => {
        setExamples(examples.filter((_, i) => i !== index));
    };

    // Update example
    const updateExample = (index: number, field: 'text' | 'label', value: string) => {
        const newExamples = [...examples];
        newExamples[index][field] = value;
        setExamples(newExamples);
    };

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-3xl font-bold text-gray-900">Guest Project Manager</h1>
            <p className="text-gray-600">Session ID: {sessionId}</p>
            
            {/* Project Form */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">
                    {selectedProject ? 'Edit Project' : 'Create New Project'}
                </h2>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Project Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            required
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Description</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            rows={3}
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Project Type</label>
                        <select
                            value={formData.type}
                            onChange={(e) => {
                                const newType = e.target.value;
                                setFormData({ ...formData, type: newType });
                                // Reset validation when changing project type
                                if (newType !== 'image-recognition-teachable-machine' && newType !== 'pose-recognition-teachable-machine') {
                                    setUrlValidation({ isValidating: false, isValid: null, error: null });
                                }
                            }}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        >
                            <option value="rule-based-process">Rule Based Process</option>
                            <option value="text-recognition">Text Recognition</option>
                            <option value="confusion-matrix">Confusion Matrix</option>
                            <option value="rag-chatbot">RAG Chatbot</option>
                            <option value="copilot-ethics">Copilot: AI Ethics (Ex 9)</option>
                            <option value="copilot-document-ai">Copilot: Document AI (Ex 10)</option>
                            <option value="ai-agent">AI Agent</option>
                            <option value="live-object-detection">Live Object Detection</option>
                            <option value="image-recognition">Image Recognition</option>
                            <option value="image-recognition-teachable-machine">Image Recognition - Teachable Machine</option>
                            <option value="pose-recognition-teachable-machine">Pose Recognition - Teachable Machine</option>
                            <option value="classification">Classification</option>
                            <option value="regression">Regression</option>
                            <option value="custom">Custom</option>
                            <option value="exercises">Exercises</option>
                        </select>
                    </div>
                    
                    {(formData.type === 'image-recognition-teachable-machine' || formData.type === 'pose-recognition-teachable-machine') && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Teachable Link</label>
                            <input
                                type="text"
                                value={formData.teachable_machine_link || ''}
                                onChange={(e) => handleTeachableLinkChange(e.target.value)}
                                className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 ${
                                    urlValidation.isValid === false 
                                        ? 'border-red-300 focus:border-red-500' 
                                        : urlValidation.isValid === true 
                                        ? 'border-green-300 focus:border-green-500'
                                        : 'border-gray-300 focus:border-blue-500'
                                }`}
                                placeholder="Enter your Teachable Link (e.g., https://teachablemachine.withgoogle.com/models/9ofJResGz/)"
                            />
                            
                            {/* Validation feedback */}
                            {urlValidation.isValidating && (
                                <div className="mt-1 text-sm text-blue-600 flex items-center">
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Validating URL...
                                </div>
                            )}
                            
                            {urlValidation.isValid === true && (
                                <div className="mt-1 text-sm text-green-600 flex items-center">
                                    <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    Valid Teachable Machine URL
                                </div>
                            )}
                            
                            {urlValidation.error && (
                                <div className="mt-1 text-sm text-red-600 flex items-center">
                                    <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    {urlValidation.error}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex space-x-3">
                        <button
                            type="submit"
                            onClick={() => {
                                console.log('Button clicked!');
                                console.log('Form data:', formData);
                                console.log('Validation state:', urlValidation);
                            }}
                            disabled={
                                createGuestProject.loading || 
                                updateGuestProject.loading ||
                                (formData.type === 'image-recognition-teachable-machine' && 
                                 Boolean(formData.teachable_machine_link && formData.teachable_machine_link.trim() !== '') &&
                                 (urlValidation.isValidating || urlValidation.isValid === false))
                            }
                            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                        >
                            {createGuestProject.loading || updateGuestProject.loading ? 'Saving...' : 'Save Project'}
                        </button>
                        
                        {selectedProject && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedProject(null);
                                    setFormData({ name: '', description: '', type: 'text-recognition', teachable_machine_link: '' });
                                    setUrlValidation({ isValidating: false, isValid: null, error: null });
                                }}
                                className="bg-gray-500 text-fg px-4 py-2 rounded-md hover:bg-raised-2"
                            >
                                Cancel Edit
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {/* Projects List */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Your Guest Projects</h2>
                
                {guestProjects.loading ? (
                    <div className="text-center py-4">Loading projects...</div>
                ) : guestProjects.error ? (
                    <div className="text-red-600 text-center py-4">{guestProjects.error}</div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-3">
                        {guestProjects.data?.map((project) => (
                            <div
                                key={project.id}
                                className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                                    selectedProject?.id === project.id
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 hover:border-gray-300'
                                }`}
                                onClick={() => handleProjectSelect(project)}
                            >
                                <h3 className="font-semibold text-lg">{project.name}</h3>
                                <p className="text-gray-600 text-sm mt-1">
                                    {project.description || 'No description'}
                                </p>
                                <div className="flex items-center justify-between mt-3">
                                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                                        {project.type === 'text-recognition' ? 'Text Recognition' : 
                                         project.type === 'image-recognition' ? 'Image Recognition' :
                                         project.type === 'image-recognition-teachable-machine' ? 'Image Recognition - Teachable Machine' :
                                         project.type === 'pose-recognition-teachable-machine' ? 'Pose Recognition - Teachable Machine' :
                                         project.type === 'classification' ? 'Classification' :
                                         project.type === 'regression' ? 'Regression' :
                                         project.type === 'custom' ? 'Custom' :
                                         project.type === 'rule-based-process' ? 'Rule Based Process' :
                                         project.type === 'live-object-detection' ? 'Live Object Detection' :
                                         project.type === 'live-video-classification' ? 'Live Object Detection' :
                                         project.type === 'exercises' ? 'Exercises' :
                                         project.type === 'confusion-matrix' ? 'Confusion Matrix' :
                                         project.type === 'rag-chatbot' ? 'RAG Chatbot' :
                                         project.type === 'copilot-ethics' ? 'Copilot: AI Ethics (Ex 9)' :
                                         project.type === 'copilot-document-ai' ? 'Copilot: Document AI (Ex 10)' :
                                         project.type === 'ai-agent' ? 'AI Agent' :
                                         project.type || 'Unknown'}
                                    </span>
                                    <span className={`text-xs px-2 py-1 rounded ${
                                        project.status === 'trained' ? 'bg-green-100 text-green-800' :
                                        project.status === 'training' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-gray-100 text-gray-800'
                                    }`}>
                                        {project.status}
                                    </span>
                                </div>
                                
                                <div className="flex space-x-2 mt-3">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleProjectSelect(project);
                                        }}
                                        className="text-blue-600 hover:text-blue-800 text-sm"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteProject(project.id);
                                        }}
                                        className="text-red-600 hover:text-red-800 text-sm"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Training Section */}
            {selectedProject && (
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-semibold mb-4">Training: {selectedProject.name}</h2>
                    
                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Training Configuration */}
                        <div>
                            <h3 className="font-medium mb-3">Training Configuration</h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm text-gray-700">Epochs</label>
                                    <input
                                        type="number"
                                        value={trainingConfig.epochs}
                                        onChange={(e) => setTrainingConfig({ ...trainingConfig, epochs: parseInt(e.target.value) })}
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                        min="1"
                                        max="1000"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm text-gray-700">Batch Size</label>
                                    <input
                                        type="number"
                                        value={trainingConfig.batch_size}
                                        onChange={(e) => setTrainingConfig({ ...trainingConfig, batch_size: parseInt(e.target.value) })}
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                        min="1"
                                        max="128"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm text-gray-700">Learning Rate</label>
                                    <input
                                        type="number"
                                        value={trainingConfig.learning_rate}
                                        onChange={(e) => setTrainingConfig({ ...trainingConfig, learning_rate: parseFloat(e.target.value) })}
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                        step="0.001"
                                        min="0.0001"
                                        max="1"
                                    />
                                </div>
                                
                                <button
                                    onClick={handleStartTraining}
                                    disabled={guestTraining.loading || selectedProject.status === 'training'}
                                    className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
                                >
                                    {guestTraining.loading ? 'Starting Training...' : 'Start Training'}
                                </button>
                            </div>
                        </div>

                        {/* Training Status */}
                        <div>
                            <h3 className="font-medium mb-3">Training Status</h3>
                            <div className="bg-gray-50 rounded-lg p-4">
                                {guestTrainingStatus.loading ? (
                                    <div className="text-center py-4">Loading status...</div>
                                ) : guestTrainingStatus.error ? (
                                    <div className="text-red-600">{guestTrainingStatus.error}</div>
                                ) : guestTrainingStatus.data ? (
                                    <div className="space-y-2">
                                        <div><strong>Status:</strong> {guestTrainingStatus.data.status}</div>
                                        <div><strong>Progress:</strong> {guestTrainingStatus.data.progress || 0}%</div>
                                        <div><strong>Epoch:</strong> {guestTrainingStatus.data.current_epoch || 0}/{guestTrainingStatus.data.total_epochs || 0}</div>
                                        <div><strong>Loss:</strong> {guestTrainingStatus.data.loss?.toFixed(4) || 'N/A'}</div>
                                        <div><strong>Accuracy:</strong> {guestTrainingStatus.data.accuracy?.toFixed(2) || 'N/A'}%</div>
                                    </div>
                                ) : (
                                    <div className="text-fg/50">No training data available</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Examples Upload */}
                    <div className="mt-6">
                        <h3 className="font-medium mb-3">Upload Training Examples</h3>
                        <div className="space-y-3">
                            {examples.map((example, index) => (
                                <div key={index} className="flex space-x-2">
                                    <input
                                        type="text"
                                        placeholder="Example text"
                                        value={example.text}
                                        onChange={(e) => updateExample(index, 'text', e.target.value)}
                                        className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Label"
                                        value={example.label}
                                        onChange={(e) => updateExample(index, 'label', e.target.value)}
                                        className="w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeExample(index)}
                                        className="px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                            <div className="flex space-x-2">
                                <button
                                    type="button"
                                    onClick={addExample}
                                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                                >
                                    Add Example
                                </button>
                                <button
                                    type="button"
                                    onClick={handleUploadExamples}
                                    disabled={uploadGuestExamples.loading}
                                    className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50"
                                >
                                    {uploadGuestExamples.loading ? 'Uploading...' : 'Upload Examples'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Prediction */}
                    <div className="mt-6">
                        <h3 className="font-medium mb-3">Make Prediction</h3>
                        <div className="flex space-x-2">
                            <input
                                type="text"
                                placeholder="Enter text to classify"
                                value={predictionInput}
                                onChange={(e) => setPredictionInput(e.target.value)}
                                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            />
                            <button
                                onClick={handlePrediction}
                                disabled={guestPrediction.loading || !predictionInput.trim()}
                                className="px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:opacity-50"
                            >
                                {guestPrediction.loading ? 'Predicting...' : 'Predict'}
                            </button>
                        </div>
                        {guestPrediction.data && (
                            <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
                                <div><strong>Prediction:</strong> {guestPrediction.data.label}</div>
                                <div><strong>Confidence:</strong> {(guestPrediction.data.confidence * 100).toFixed(2)}%</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Error Messages */}
            {(createGuestProject.error || updateGuestProject.error || deleteGuestProject.error || guestTraining.error) && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                    <div className="text-red-800">
                        {createGuestProject.error && <div>Create Error: {createGuestProject.error}</div>}
                        {updateGuestProject.error && <div>Update Error: {updateGuestProject.error}</div>}
                        {deleteGuestProject.error && <div>Delete Error: {deleteGuestProject.error}</div>}
                        {guestTraining.error && <div>Training Error: {guestTraining.error}</div>}
                    </div>
                </div>
            )}
        </div>
    );
};

export default GuestProjectManager;
