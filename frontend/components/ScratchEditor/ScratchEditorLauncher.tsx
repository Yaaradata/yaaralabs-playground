'use client';

import React, { useState, useEffect, useRef } from 'react';
import Header from '../Header/Header';
import config from '../../lib/config';
import { SCRATCH_EDITOR_CONFIG } from '@/config/scratch-editor';

interface ScratchEditorLauncherProps {
  projectId?: string;
  sessionId?: string;
  onClose?: () => void;
}

export default function ScratchEditorLauncher({ 
  projectId, 
  sessionId, 
  onClose 
}: ScratchEditorLauncherProps) {
  const [isStarting, setIsStarting] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scratchContainerRef = useRef<HTMLDivElement>(null);
  const [scratchPort, setScratchPort] = useState<number | null>(null);

  useEffect(() => {
    startScratchEditor();
  }, []);

  const startScratchEditor = async () => {
    try {
      setIsStarting(true);
      setError(null);

      // Start scratch-gui service
      console.log('🚀 Starting Scratch GUI service...');
      
      // For now, we'll use a placeholder approach
      // In production, this would make an API call to start the services
      await startScratchServices();
      
      // Simulate service startup time
      setTimeout(() => {
        setIsStarting(false);
        setIsReady(true);
        loadScratchEditor();
      }, 3000);

    } catch (err) {
      console.error('Failed to start Scratch editor:', err);
      setError('Failed to start Scratch editor services');
      setIsStarting(false);
    }
  };

  const startScratchServices = async () => {
    try {
      console.log('📡 Starting all Scratch services...');
      
                     // Start all services at once
        const response = await fetch(`${config.apiBaseUrl}/scratch/start-all`, { 
          method: 'POST' 
        });
      
      if (!response.ok) {
        throw new Error(`Failed to start services: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('✅ Scratch services started:', result);
      
      // Store the GUI URL for later use
      if (result.gui_url) {
        setScratchPort(parseInt(result.gui_url.split(':').pop() || '8601'));
      }
      
    } catch (err) {
      console.error('Failed to start Scratch services:', err);
      throw new Error('Failed to start Scratch services');
    }
  };

  const loadScratchEditor = () => {
    if (!scratchContainerRef.current) return;

    // Create iframe to load the actual Scratch editor
    const iframe = document.createElement('iframe');
    
    // Point to the running scratch-gui service with session and project IDs
    const guiUrl = scratchPort ? `http://localhost:${scratchPort}` : SCRATCH_EDITOR_CONFIG.PRODUCTION_URL;
    
    // Add session and project IDs as URL parameters for the ML extension
    const urlParams = new URLSearchParams();
    if (sessionId) urlParams.set('sessionId', sessionId);
    if (projectId) urlParams.set('projectId', projectId);
    
    const finalUrl = `${guiUrl}?${urlParams.toString()}`;
    iframe.src = finalUrl;
    
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';
    
    // Add iframe to container
    scratchContainerRef.current.appendChild(iframe);
    
    iframe.onload = () => {
      console.log('🎮 Scratch editor loaded successfully from:', finalUrl);
      console.log('📊 ML Extension should be available with session:', sessionId, 'project:', projectId);
      
      // Try to inject ML extension if it's not already loaded
      setTimeout(() => {
        injectMLExtension(iframe);
      }, 2000);
    };

    iframe.onerror = () => {
      setError('Failed to load Scratch editor interface');
    };
  };

  const injectMLExtension = (iframe: HTMLIFrameElement) => {
    try {
      // Try to access the iframe content to inject ML extension
      const iframeWindow = iframe.contentWindow;
      if (iframeWindow && iframeWindow.location.origin === window.location.origin) {
        console.log('🔧 Attempting to inject ML extension...');
        
        // This would inject the ML extension if needed
        // In a real implementation, you might need to communicate with the Scratch editor
        iframeWindow.postMessage({
          type: 'LOAD_ML_EXTENSION',
          sessionId: sessionId,
          projectId: projectId
        }, '*');
      }
    } catch (error) {
      console.log('⚠️ Could not inject ML extension (this is normal for cross-origin iframes):', error);
    }
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      window.close();
    }
  };

  if (isStarting) {
    return (
      <div className="min-h-screen bg-canvas text-fg">
        <Header />
        <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="mb-8">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-pink-brand mx-auto mb-6"></div>
              <h1 className="text-3xl font-bold text-fg mb-4">
                Starting Scratch Editor...
              </h1>
              <p className="text-lg text-fg/80 mb-6">
                Initializing scratch-gui and scratch-vm services
              </p>
              
              <div className="space-y-3 text-left max-w-md mx-auto">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-purple-brand rounded-full animate-pulse"></div>
                  <span className="text-sm">Starting scratch-gui service...</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-purple-brand rounded-full animate-pulse"></div>
                  <span className="text-sm">Starting scratch-vm service...</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-purple-brand rounded-full animate-pulse"></div>
                  <span className="text-sm">Loading editor interface...</span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-canvas text-fg">
        <Header />
        <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-8">
              <h1 className="text-3xl font-bold text-red-400 mb-4">
                Failed to Start Scratch Editor
              </h1>
              <p className="text-lg text-fg/80 mb-6">{error}</p>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={startScratchEditor}
                  className="bg-purple-brand text-white px-6 py-3 rounded-lg font-medium hover:bg-purple-brand/90 transition-all duration-300"
                >
                  Try Again
                </button>
                <button
                  onClick={handleClose}
                  className="border border-fg/30 text-fg px-6 py-3 rounded-lg font-medium hover:bg-fg/10 transition-all duration-300"
                >
                  Close
                </button>
              </div>
            </div>
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
          {/* Header with project info */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-fg">
                🎮 Scratch Editor
              </h1>
              <p className="text-fg/70">
                Project: {projectId} | Session: {sessionId}
              </p>
            </div>
            
            <button
              onClick={handleClose}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-300"
            >
              Close Editor
            </button>
          </div>

          {/* Scratch Editor Container */}
          <div 
            ref={scratchContainerRef}
            className="w-full h-[600px] bg-white rounded-lg overflow-hidden shadow-2xl"
          >
            {/* This will be replaced by the actual Scratch editor iframe */}
            <div className="w-full h-full flex items-center justify-center bg-gray-100">
              <div className="text-center text-gray-600">
                <div className="text-6xl mb-4">🎮</div>
                <h2 className="text-2xl font-bold mb-2">Scratch Editor Ready!</h2>
                <p className="text-lg">The Scratch editor interface will appear here.</p>
                <p className="text-sm mt-2">Services: scratch-gui ✅ | scratch-vm ✅</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
