'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '../components/Header';
import config from '../lib/config';
import { 
  getOrCreateMaskedId
} from '../lib/session-utils';
import { cleanupSessionWithReason, SessionCleanupReason } from '../lib/session-cleanup';
import { logNetworkError } from '../lib/log-network-error';

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

export default function Home() {
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [userSessionId, setUserSessionId] = useState<string>('');
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  // Function to clean up session and reset local state
  const handleSessionCleanup = async (reason: SessionCleanupReason, sessionId?: string) => {
    await cleanupSessionWithReason(reason, sessionId);
    
    // Reset local state
    setHasActiveSession(false);
    setUserSessionId('');
  };

  const checkExistingSession = async () => {
    console.log('🔍 Checking for existing session...');
    
    try {
      const storedSessionId = localStorage.getItem('yaaralabs_playground_session_id');
      const sessionCreatedAt = localStorage.getItem('yaaralabs_playground_session_created');
      
      console.log('📋 Session check details:', {
        hasSessionId: !!storedSessionId,
        sessionId: storedSessionId?.substring(0, 8) + '...',
        hasCreatedTime: !!sessionCreatedAt,
        createdTime: sessionCreatedAt ? new Date(parseInt(sessionCreatedAt)).toISOString() : null
      });
      
      if (!storedSessionId) {
        console.log('❌ No session ID found in localStorage');
        setIsCheckingSession(false);
        return;
      }

      // Check if session is expired based on 7-day rule
      const sessionExpiresAt = localStorage.getItem('yaaralabs_playground_session_expires');
      const now = Date.now();
      
      // First check explicit expiry time if available
      if (sessionExpiresAt) {
        const expiryTime = parseInt(sessionExpiresAt);
        if (now > expiryTime) {
          console.log('⏰ Session expired based on explicit expiry time, cleaning up');
          await handleSessionCleanup(SessionCleanupReason.EXPIRED_7_DAYS, storedSessionId);
          setIsCheckingSession(false);
          return;
        }
        console.log(`📅 Session expires at: ${new Date(expiryTime).toISOString()}`);
      } else if (sessionCreatedAt) {
        // Fallback to creation time check for older sessions
        const createdDate = new Date(parseInt(sessionCreatedAt));
        const daysDiff = (now - createdDate.getTime()) / (1000 * 3600 * 24);
        
        console.log(`📅 Session age: ${daysDiff.toFixed(1)} days (fallback check)`);
        
        if (daysDiff >= 7) {
          console.log('⏰ Session expired after 7 days (fallback), cleaning up');
          await handleSessionCleanup(SessionCleanupReason.EXPIRED_7_DAYS, storedSessionId);
          setIsCheckingSession(false);
          return;
        }
      }

      // Validate session with backend
      console.log('🌐 Validating session with backend API...');
      const response = await fetch(`${config.apiBaseUrl}${config.api.guests.sessionById(storedSessionId)}`);
      
      console.log('📡 API Response:', {
        status: response.status,
        ok: response.ok,
        url: response.url
      });
      
      if (response.ok) {
        const sessionResponse: GuestSessionResponse = await response.json();
        console.log('📄 Session response:', {
          success: sessionResponse.success,
          active: sessionResponse.data?.active,
          expiresAt: sessionResponse.data?.expiresAt
        });
        
        if (sessionResponse.success && sessionResponse.data.active) {
          const now = new Date();
          const expiresAt = new Date(sessionResponse.data.expiresAt);
          
          console.log('⏱️ Time check:', {
            now: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            isValid: now < expiresAt
          });
          
          if (now < expiresAt) {
            // Session is valid, generate masked ID and set state
            // Get or create masked ID (reuses existing if available)
            const maskedId = getOrCreateMaskedId(storedSessionId);
            
            // Update last activity time
            localStorage.setItem('yaaralabs_playground_session_last_activity', Date.now().toString());
            
            setUserSessionId(maskedId);
            setHasActiveSession(true);
            console.log('✅ Session is valid! Setting hasActiveSession to true');
            console.log('🔗 Using masked ID:', maskedId);
            console.log('⏰ Updated last activity time');
          } else {
            // Session expired on backend
            console.log('⏰ Session expired on backend');
            await handleSessionCleanup(SessionCleanupReason.EXPIRED_BACKEND, storedSessionId);
          }
        } else {
          // Session inactive
          console.log('❌ Session inactive on backend');
          await handleSessionCleanup(SessionCleanupReason.INACTIVE_BACKEND, storedSessionId);
        }
      } else {
        // Session not found on server
        console.log('❌ Session not found on server, status:', response.status);
        
        // Get error details
        try {
          const errorText = await response.text();
          console.log('Error details:', errorText);
        } catch {
          console.log('Could not read error response');
        }
        
        await handleSessionCleanup(SessionCleanupReason.NOT_FOUND_BACKEND, storedSessionId);
      }
    } catch (error) {
      logNetworkError('Could not validate the guest session', error);
    }
    
    // Final state will be logged after state updates
    setIsCheckingSession(false);
  };

  useEffect(() => {
    checkExistingSession();
  }, []);

  // Add useEffect to log final state changes
  useEffect(() => {
    if (!isCheckingSession) {
      console.log('🏁 Session check complete. Final state:', { 
        hasActiveSession, 
        userSessionId: userSessionId ? userSessionId.substring(0, 8) + '...' : null,
        buttonText: hasActiveSession ? 'Go to Projects →' : 'Get Started →'
      });
    }
  }, [isCheckingSession, hasActiveSession, userSessionId]);

  const getProjectsUrl = () => {
    if (hasActiveSession && userSessionId) {
      return `/projects/${userSessionId}`;
    }
    return '/projects';
  };

  const getButtonText = () => {
    console.log('🔘 Button text check:', { isCheckingSession, hasActiveSession, userSessionId });
    
    if (isCheckingSession) {
      return 'Loading…';
    }
    if (hasActiveSession) {
      return 'Go to your projects →';
    }
    return 'Get started →';
  };

  const steps = [
    {
      title: 'Collect examples',
      description:
        'Gather examples from real work (client messages, documents, images) of what you want the model to recognise.',
    },
    {
      title: 'Train a model',
      description:
        'Train it in minutes, then test it on examples it has never seen and look closely at where it goes wrong.',
    },
    {
      title: 'Put it to work',
      description:
        'Build the trained model into a working prototype, and decide when it should hand over to a person.',
    },
  ];

  const pillars = [
    {
      letter: 'M',
      title: 'Measured',
      description: 'Every lab ends with numbers you can check: accuracy, mistakes, cost. Not a feeling that it worked.',
    },
    {
      letter: 'P',
      title: 'Practitioner-built',
      description: 'Designed by people who have shipped AI to production, around the decisions real teams face.',
    },
    {
      letter: 'U',
      title: 'Use-case-led',
      description: 'Built on scenarios from your own industry, so what you learn maps straight back to your work.',
    },
  ];

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <Header showAboutLink={true} />

      {/* Hero */}
      <section className="hero-radial pt-36 pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-pink-brand mb-5">
            The YaaraLabs AI fluency lab
          </p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Learn AI by <span className="text-brand-gradient">building it.</span>
          </h1>
          <p className="text-lg md:text-xl text-fg/75 mb-8 max-w-3xl mx-auto leading-relaxed">
            The hands-on playground behind every YaaraLabs cohort. Collect examples from your own
            workflows, train a model, and see exactly where it works and where it breaks.
          </p>

          {isCheckingSession && (
            <p className="text-base text-pink-brand mb-6">Setting up your workspace…</p>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href={getProjectsUrl()}
              aria-disabled={isCheckingSession}
              className={`px-8 py-4 rounded-full text-base font-semibold transition-all duration-300 text-center ${
                isCheckingSession
                  ? 'bg-fg/10 text-fg/50 cursor-not-allowed pointer-events-none'
                  : 'brand-gradient text-white hover:brightness-110'
              }`}
            >
              {getButtonText()}
            </Link>
            <Link
              href="/about"
              className="border border-magenta-brand/60 text-fg px-8 py-4 rounded-full text-base font-semibold hover:bg-magenta-brand/10 transition-all duration-300 text-center"
            >
              About the playground
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold uppercase tracking-widest text-pink-brand mb-3">How it works</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">From examples to a working model</h2>
            <p className="text-lg text-fg/70 max-w-2xl mx-auto">
              Three steps, the same way production AI gets built.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {steps.map((step, index) => (
              <div
                key={step.title}
                className="brand-gradient-soft border border-magenta-brand/30 rounded-2xl p-8 h-full"
              >
                <div className="brand-gradient w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg mb-6">
                  {index + 1}
                </div>
                <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                <p className="text-fg/70 leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Approach */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold uppercase tracking-widest text-pink-brand mb-3">Our approach</p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Measured. Practitioner-built. Use-case-led.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="bg-surface border border-fg/10 rounded-2xl p-8">
                <div className="text-brand-gradient text-4xl font-extrabold mb-4">{pillar.letter}</div>
                <h3 className="text-xl font-bold mb-3 text-purple-brand">{pillar.title}</h3>
                <p className="text-fg/70 leading-relaxed">{pillar.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center brand-gradient-soft border border-magenta-brand/30 rounded-3xl px-6 py-14">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to build your first model?</h2>
          <p className="text-lg text-fg/70 mb-10 max-w-2xl mx-auto">
            No sign-up needed. Your workspace stays private to this browser and is kept for 7 days.
          </p>
          <Link
            href={getProjectsUrl()}
            aria-disabled={isCheckingSession}
            className={`px-10 py-4 rounded-full text-base font-semibold transition-all duration-300 inline-block text-center ${
              isCheckingSession
                ? 'bg-fg/10 text-fg/50 cursor-not-allowed pointer-events-none'
                : 'brand-gradient text-white hover:brightness-110'
            }`}
          >
            {hasActiveSession ? 'Go to your projects →' : 'Start building →'}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-surface border-t border-fg/10 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-fg/60">
          <p>© {new Date().getFullYear()} YaaraLabs. AI fluency, measured.</p>
          <a
            href="https://www.yaaralabs.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-pink-brand transition-colors"
          >
            yaaralabs.ai ↗
          </a>
        </div>
      </footer>
    </div>
  );
}
