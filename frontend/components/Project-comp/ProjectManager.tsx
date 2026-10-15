'use client';

import React, { useState, useEffect } from 'react';
import { 
    useProjects, 
    useCreateProject, 
    useUpdateProject, 
    useDeleteProject,
    useTraining,
    useTrainingStatus,
    useFileUpload
} from '../../lib/use-api';
import { Project } from '../../lib/api-service';

interface ProjectFormData {
    name: string;
    description: string;
    type: string;  // Changed from type to type
}

const ProjectManager: React.FC = () => {
    const [formData, setFormData] = useState<ProjectFormData>({
        name: '',
        description: '',
        type: 'text-recognition'
    });
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [trainingConfig, setTrainingConfig] = useState({
        epochs: 100,
        batch_size: 32,
        learning_rate: 0.001
    });

    // API hooks
    const projects = useProjects();
    const createProject = useCreateProject();
    const updateProject = useUpdateProject();
    const deleteProject = useDeleteProject();
    const training = useTraining();
    const trainingStatus = useTrainingStatus(selectedProject?.id || '');
    const fileUpload = useFileUpload();

    // Load projects on component mount
    useEffect(() => {
        projects.execute();
    }, []);

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedProject) {
            await updateProject.execute(selectedProject.id, formData);
        } else {
            await createProject.execute(formData);
        }
        
        // Reset form and reload projects
        setFormData({ name: '', description: '', type: 'text-recognition' });
        setSelectedProject(null);
        projects.execute();
    };

    // Handle project selection
    const handleProjectSelect = (project: Project) => {
        setSelectedProject(project);
        setFormData({
            name: project.name,
            description: project.description || '',
            type: project.type || 'text'
        });
    };

    // Handle project deletion
    const handleDeleteProject = async (projectId: string) => {
        if (confirm('Are you sure you want to delete this project?')) {
            await deleteProject.execute(projectId);
            projects.execute();
        }
    };

    // Handle training start
    const handleStartTraining = async () => {
        if (selectedProject) {
            await training.execute(selectedProject.id, trainingConfig);
            // Start monitoring training status
            trainingStatus.execute();
        }
    };

    // Handle file upload
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && selectedProject) {
            await fileUpload.execute(selectedProject.id, file);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-3xl font-bold text-gray-900">Project Manager</h1>
            
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
                        <label className="block text-sm font-medium text-gray-700">Model Type</label>
                        <select
                            value={formData.type}
                            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        >
                            <option value="text">Text Classification</option>
                            <option value="image">Image Classification</option>
                            <option value="audio">Audio Classification</option>
                            <option value="tabular">Tabular Data</option>
                        </select>
                    </div>
                    
                    <div className="flex space-x-3">
                        <button
                            type="submit"
                            disabled={createProject.loading || updateProject.loading}
                            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                        >
                            {createProject.loading || updateProject.loading ? 'Saving...' : 'Save Project'}
                        </button>
                        
                        {selectedProject && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedProject(null);
                                    setFormData({ name: '', description: '', type: 'text-recognition' });
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
                <h2 className="text-xl font-semibold mb-4">Your Projects</h2>
                
                {projects.loading ? (
                    <div className="text-center py-4">Loading projects...</div>
                ) : projects.error ? (
                    <div className="text-red-600 text-center py-4">{projects.error}</div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-3">
                        {projects.data?.map((project) => (
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
                                        {project.type || 'Unknown'}
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
                                    disabled={training.loading || selectedProject.status === 'training'}
                                    className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
                                >
                                    {training.loading ? 'Starting Training...' : 'Start Training'}
                                </button>
                            </div>
                        </div>

                        {/* Training Status */}
                        <div>
                            <h3 className="font-medium mb-3">Training Status</h3>
                            <div className="bg-gray-50 rounded-lg p-4">
                                {trainingStatus.loading ? (
                                    <div className="text-center py-4">Loading status...</div>
                                ) : trainingStatus.error ? (
                                    <div className="text-red-600">{trainingStatus.error}</div>
                                ) : trainingStatus.data ? (
                                    <div className="space-y-2">
                                        <div><strong>Status:</strong> {trainingStatus.data.status}</div>
                                        <div><strong>Progress:</strong> {trainingStatus.data.progress || 0}%</div>
                                        <div><strong>Epoch:</strong> {trainingStatus.data.current_epoch || 0}/{trainingStatus.data.total_epochs || 0}</div>
                                        <div><strong>Loss:</strong> {trainingStatus.data.loss?.toFixed(4) || 'N/A'}</div>
                                        <div><strong>Accuracy:</strong> {trainingStatus.data.accuracy?.toFixed(2) || 'N/A'}%</div>
                                    </div>
                                ) : (
                                    <div className="text-fg/50">No training data available</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* File Upload */}
                    <div className="mt-6">
                        <h3 className="font-medium mb-3">Upload Training Data</h3>
                        <input
                            type="file"
                            onChange={handleFileUpload}
                            accept=".csv,.json,.txt"
                            className="block w-full text-sm text-fg/50 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                        {fileUpload.loading && <div className="mt-2 text-sm text-gray-600">Uploading...</div>}
                    </div>
                </div>
            )}

            {/* Error Messages */}
            {(createProject.error || updateProject.error || deleteProject.error || training.error) && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                    <div className="text-red-800">
                        {createProject.error && <div>Create Error: {createProject.error}</div>}
                        {updateProject.error && <div>Update Error: {updateProject.error}</div>}
                        {deleteProject.error && <div>Delete Error: {deleteProject.error}</div>}
                        {training.error && <div>Training Error: {training.error}</div>}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectManager;
