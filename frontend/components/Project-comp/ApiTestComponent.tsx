'use client';

import React, { useState } from 'react';
import { apiService } from '../../lib/api-service';

const ApiTestComponent: React.FC = () => {
  const [sessionId, setSessionId] = useState('session_d3d9d68234d34cda');
  const [projectId, setProjectId] = useState('e9028dae-81d9-4731-b849-9e6aecb04015');
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const testGetProject = async () => {
    setLoading(true);
    setResult('Testing GET project...');
    
    try {
      console.log('Testing GET request to:', `/api/guests/session/${sessionId}/projects/${projectId}`);
      
      const response = await apiService.getGuestProject(sessionId, projectId);
      
      console.log('GET response:', response);
      setResult(`GET Project Result: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      console.error('GET Project Error:', error);
      setResult(`GET Project Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const testCreateProject = async () => {
    setLoading(true);
    setResult('Testing POST create project...');
    
    try {
      console.log('Testing POST request to:', `/api/guests/session/${sessionId}/projects`);
      
      const response = await apiService.createGuestProject(sessionId, {
        name: 'Test Project',
        description: 'Test Description',
        type: 'text-recognition'
      });
      
      console.log('POST response:', response);
      setResult(`POST Create Project Result: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      console.error('POST Create Project Error:', error);
      setResult(`POST Create Project Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const testUpdateProject = async () => {
    setLoading(true);
    setResult('Testing PUT update project...');
    
    try {
      console.log('Testing PUT request to:', `/api/guests/session/${sessionId}/projects/${projectId}`);
      
      const response = await apiService.updateGuestProject(sessionId, projectId, {
        name: 'Updated Test Project',
        description: 'Updated Test Description'
      });
      
      console.log('PUT response:', response);
      setResult(`PUT Update Project Result: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      console.error('PUT Update Project Error:', error);
      setResult(`PUT Update Project Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const testDeleteProject = async () => {
    setLoading(true);
    setResult('Testing DELETE project...');
    
    try {
      console.log('Testing DELETE request to:', `/api/guests/session/${sessionId}/projects/${projectId}`);
      
      const response = await apiService.deleteGuestProject(sessionId, projectId);
      
      console.log('DELETE response:', response);
      setResult(`DELETE Project Result: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      console.error('DELETE Project Error:', error);
      setResult(`DELETE Project Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const testGetProjects = async () => {
    setLoading(true);
    setResult('Testing GET all projects...');
    
    try {
      console.log('Testing GET request to:', `/api/guests/session/${sessionId}/projects`);
      
      const response = await apiService.getGuestProjects(sessionId);
      
      console.log('GET all projects response:', response);
      setResult(`GET All Projects Result: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      console.error('GET All Projects Error:', error);
      setResult(`GET All Projects Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6">API Test Component</h2>
      
      <div className="mb-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Session ID:</label>
          <input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md"
            placeholder="Enter session ID"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Project ID:</label>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md"
            placeholder="Enter project ID"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <button
          onClick={testGetProject}
          disabled={loading}
          className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 disabled:opacity-50"
        >
          Test GET Project
        </button>
        
        <button
          onClick={testCreateProject}
          disabled={loading}
          className="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 disabled:opacity-50"
        >
          Test POST Create
        </button>
        
        <button
          onClick={testUpdateProject}
          disabled={loading}
          className="bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 disabled:opacity-50"
        >
          Test PUT Update
        </button>
        
        <button
          onClick={testDeleteProject}
          disabled={loading}
          className="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 disabled:opacity-50"
        >
          Test DELETE
        </button>
        
        <button
          onClick={testGetProjects}
          disabled={loading}
          className="bg-purple-500 text-white px-4 py-2 rounded-md hover:bg-purple-600 disabled:opacity-50 col-span-2"
        >
          Test GET All Projects
        </button>
      </div>

      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Test Results:</h3>
        <div className="bg-gray-100 p-4 rounded-md">
          <pre className="text-sm overflow-auto max-h-96">
            {result || 'No test results yet. Click a test button above.'}
          </pre>
        </div>
      </div>

      <div className="text-sm text-gray-600">
        <p><strong>Note:</strong> Check the browser console for detailed request/response logs.</p>
        <p><strong>Expected:</strong> GET requests should work, POST/PUT/DELETE should work for valid operations.</p>
      </div>
    </div>
  );
};

export default ApiTestComponent;
