'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Header from '../../components/Header';
import config from '../../lib/config';
import { generateMaskedId, storeMaskedIdMapping, getCurrentMaskedId } from '../../lib/session-utils';
import { logNetworkError } from '../../lib/log-network-error';

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

export default function ProjectsPage() {
  const [guestSession, setGuestSession] = useState<GuestSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  const checkExistingSession = useCallback(async () => {
    try {
      const sessionId = localStorage.getItem('yaaralabs_playground_session_id');
      if (sessionId) {
        // Validate session with backend API
        const response = await fetch(`${config.apiBaseUrl}${config.api.guests.sessionById(sessionId)}`);
        if (response.ok) {
          const sessionResponse: GuestSessionResponse = await response.json();
          if (sessionResponse.success && sessionResponse.data.active) {
            // Check if session is still valid
            const now = new Date();
            const expiresAt = new Date(sessionResponse.data.expiresAt);
            
            if (now < expiresAt) {
              setGuestSession(sessionResponse.data);
            } else {
              localStorage.removeItem('yaaralabs_playground_session_id');
              localStorage.removeItem('yaaralabs_playground_session_created');
            }
          } else {
            localStorage.removeItem('yaaralabs_playground_session_id');
            localStorage.removeItem('yaaralabs_playground_session_created');
          }
        } else {
          localStorage.removeItem('yaaralabs_playground_session_id');
          localStorage.removeItem('yaaralabs_playground_session_created');
        }
      }
    } catch (error) {
      logNetworkError('Could not validate the guest session', error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    setHasMounted(true);
    void checkExistingSession();
  }, [checkExistingSession]);

  const createGuestSession = async (): Promise<string | null> => {
    try {
      setIsCreatingSession(true);
      
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.session}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const sessionResponse: GuestSessionResponse = await response.json();
        if (sessionResponse.success) {
          // Generate masked ID for URL
          const maskedId = generateMaskedId(sessionResponse.data.session_id);
          
          // Store session ID, creation timestamp, and masked ID mapping
          const now = Date.now();
          const sevenDaysFromNow = now + (7 * 24 * 60 * 60 * 1000); // 7 days in milliseconds
          
          localStorage.setItem('yaaralabs_playground_session_id', sessionResponse.data.session_id);
          localStorage.setItem('yaaralabs_playground_session_created', now.toString());
          localStorage.setItem('yaaralabs_playground_session_expires', sevenDaysFromNow.toString());
          localStorage.setItem('yaaralabs_playground_session_last_activity', now.toString());
          storeMaskedIdMapping(maskedId, sessionResponse.data.session_id);
          
          setGuestSession(sessionResponse.data);
          return maskedId; // Return masked ID instead of session ID
        }
      }
      
      throw new Error('Failed to create guest session');
    } catch (error) {
      logNetworkError('Could not create a guest session', error);
      return null;
    } finally {
      setIsCreatingSession(false);
    }
  };



  const handleTryNow = async () => {
    if (guestSession) {
      // User has existing session, get or generate masked ID
      const currentMaskedId = getCurrentMaskedId();
      if (currentMaskedId) {
        window.location.href = `/projects/${currentMaskedId}`;
      } else {
        // Generate new masked ID for existing session
        const maskedId = generateMaskedId(guestSession.session_id);
        storeMaskedIdMapping(maskedId, guestSession.session_id);
        window.location.href = `/projects/${maskedId}`;
      }
    } else {
      // Check localStorage for existing session first
      const existingSessionId = localStorage.getItem('yaaralabs_playground_session_id');
      if (existingSessionId) {
        // Check if we have a masked ID for this session
        const currentMaskedId = getCurrentMaskedId();
        if (currentMaskedId) {
          window.location.href = `/projects/${currentMaskedId}`;
        } else {
          // Generate masked ID for existing session
          const maskedId = generateMaskedId(existingSessionId);
          storeMaskedIdMapping(maskedId, existingSessionId);
          window.location.href = `/projects/${maskedId}`;
        }
        return;
      }
      
      // Create new session and redirect
      const maskedId = await createGuestSession();
      if (maskedId) {
        window.location.href = `/projects/${maskedId}`;
      } else {
        alert('Failed to create session. Please try again.');
      }
    }
  };

  if (!hasMounted) {
    return (
      <div className="min-h-screen bg-canvas text-fg" suppressHydrationWarning>
        <Header />
        <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl md:text-6xl font-bold mb-8" suppressHydrationWarning>
              Your AI workspace
            </h1>
            <button
              type="button"
              disabled
              className="brand-gradient text-white px-10 py-4 rounded-full text-lg font-semibold opacity-50 cursor-not-allowed"
              suppressHydrationWarning
            >
              Loading...
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-fg">
      {/* Header Component */}
      <Header />

      {/* Main Content */}
      <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div>
          {/* Back Button */}
          <div className="flex justify-start mb-8">
            <Link
              href="/"
              className="p-2 text-fg/70 hover:text-white hover:bg-purple-brand/10 rounded-lg transition-all duration-300 flex items-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Home
            </Link>
          </div>
          
          <div className="text-center">
            {/* Main Heading */}
            <h1 className="text-4xl md:text-6xl font-bold mb-8">
              Your AI workspace
            </h1>
          
          
          {/* Try It Now / Go to Projects Button */}
          <button 
            onClick={handleTryNow}
            disabled={isLoading || isCreatingSession}
            className="brand-gradient text-white px-10 py-4 rounded-full text-lg font-semibold hover:brightness-110 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Loading...' : isCreatingSession ? 'Setting up your workspace…' : guestSession ? 'Go to your projects →' : 'Open my workspace →'}
          </button>
          
          {guestSession && (
            <p className="text-sm text-fg mt-4">
              Welcome back. Your workspace is kept until{' '}
              {new Date(guestSession.expiresAt).toLocaleDateString()} at{' '}
              {new Date(guestSession.expiresAt).toLocaleTimeString()}
            </p>
          )}
          
          <div className="mt-20 max-w-5xl mx-auto">
            <div className="grid md:grid-cols-3 gap-6 text-left">
              {[
                { title: 'Train a model', body: 'Teach a model to recognise text or images from examples you provide.' },
                { title: 'Test it honestly', body: 'Try it on new inputs and see where it is confident, unsure or wrong.' },
                { title: 'Build with it', body: 'Use your model in a working prototype with Scratch blocks.' },
              ].map((card) => (
                <div key={card.title} className="brand-gradient-soft border border-magenta-brand/30 rounded-2xl p-6">
                  <h3 className="text-lg font-bold mb-2 text-fg">{card.title}</h3>
                  <p className="text-fg/70 leading-relaxed">{card.body}</p>
                </div>
              ))}
            </div>
          </div>
            </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-surface border-t border-fg/10 py-8 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="text-sm text-fg/60">
            © {new Date().getFullYear()} YaaraLabs. AI fluency, measured.
          </p>
        </div>
      </footer>
    </div>
  );
}
