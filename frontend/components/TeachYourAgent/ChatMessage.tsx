'use client';

import React from 'react';
import { formatContent } from './formatContent';

// Format time consistently to avoid hydration mismatches
const formatTime = (date: Date): string => {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = String(minutes).padStart(2, '0');
  return `${displayHours}:${displayMinutes} ${period}`;
};

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  intent?: string;
  preview?: {
    type: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
    changes?: Array<{ field?: string; old?: unknown; new?: unknown; action?: string }>;
  };
  changeId?: string;
  requiresApproval?: boolean;
  extractedConfig?: Record<string, unknown>;
  isNewAction?: boolean;
}

interface ChatMessageProps {
  message: Message;
  agentAvatar?: string;
  onApprove?: (changeId: string) => void;
  onReject?: (changeId: string) => void;
  isProcessing?: boolean;
}

export default function ChatMessage({ 
  message, 
  agentAvatar,
  onApprove,
  onReject,
  isProcessing = false
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  
  // escaped first, then **bold** and line breaks (formatContent.ts)

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-4`}>
      {/* Avatar */}
      {!isUser && (
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-brand to-[#9147b3] flex items-center justify-center overflow-hidden">
            {agentAvatar ? (
              <img src={agentAvatar} alt="Agent" className="w-full h-full object-cover" />
            ) : (
              <svg className="w-6 h-6 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )}
          </div>
        </div>
      )}
      
      {/* Message Content */}
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[80%]`}>
        <div 
          className={`px-4 py-3 rounded-2xl ${
            isUser 
              ? 'bg-gradient-to-r from-[#5e5ce6] to-[#7c6ee6] text-white rounded-br-md' 
              : 'bg-card text-fg/90 rounded-bl-md border border-raised'
          }`}
        >
          <div 
            className="text-sm leading-relaxed"
            style={{ lineHeight: '1.6' }}
            dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
          />
        </div>
        
        {/* Preview Section for Changes */}
        {message.preview && message.preview.type && (
          <div className="mt-3 w-full">
            {/* New Action Added Badge */}
            {message.isNewAction && (
              <div className="flex items-center gap-2 mb-2 text-emerald-400 text-sm">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>New action added</span>
              </div>
            )}
            
            {/* Action Preview Card */}
            {message.preview.type === 'action_create' && message.extractedConfig && (
              <div className="bg-[#1e3a4f] border border-[#2a5a7a] rounded-lg p-4 text-sm">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[#5bb5f0] font-semibold">WHEN</span>
                    <span className="text-fg">
                      {(message.extractedConfig.conditions as Array<{type: string; value: string}>)?.[0]?.type || 'Condition'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#f0b95b] font-semibold">MENTION</span>
                    <span className="text-fg">
                      {(message.extractedConfig.actions as Array<{value: string}>)?.[0]?.value || 'Action'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#5bb5f0] font-semibold">CHANNELS</span>
                    <span className="bg-[#3a5a6a] px-2 py-0.5 rounded text-white text-xs">All Channels</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Persona Preview Card */}
            {message.preview.type === 'persona_update' && (
              <div className="space-y-3">
                {/* Before */}
                {message.preview.before && Object.keys(message.preview.before).length > 0 && (
                  <div className="relative">
                    <div className="absolute -left-6 top-0 bottom-0 flex items-center">
                      <span className="text-fg/40 text-xs font-medium writing-mode-vertical transform -rotate-180" style={{ writingMode: 'vertical-rl' }}>BEFORE</span>
                    </div>
                    <div className="bg-card border border-raised rounded-lg p-3">
                      <div className="text-fg/60 text-sm font-medium mb-2">Persona</div>
                      <div className="bg-fg/5 rounded border border-fg/10 p-2 max-h-48 overflow-y-auto">
                        {(() => {
                          const guidelines = message.preview.before?.guidelines;
                          if (!guidelines) return <div className="text-fg/60 text-sm">No guidelines</div>;
                          const guidelinesList = String(guidelines).split('\n').filter(g => g.trim());
                          if (guidelinesList.length === 0) return <div className="text-fg/60 text-sm">No guidelines</div>;
                          return (
                            <div className="space-y-1">
                              {guidelinesList.map((g, idx) => (
                                <div key={idx} className="text-fg/90 text-sm leading-relaxed">• {g.trim()}</div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}
                
                {/* After */}
                {message.preview.after && (
                  <div className="relative">
                    <div className="absolute -left-6 top-0 bottom-0 flex items-center">
                      <span className="text-[#5bb5f0] text-xs font-medium writing-mode-vertical transform -rotate-180" style={{ writingMode: 'vertical-rl' }}>AFTER</span>
                    </div>
                    <div className="bg-[#1e3a4f] border border-[#2a5a7a] rounded-lg p-3">
                      <div className="text-fg font-medium mb-2">Updated Persona</div>
                      <div className="bg-blue-500/10 rounded border border-blue-500/30 p-2 max-h-48 overflow-y-auto">
                        {(() => {
                          const guidelines = message.preview.after?.guidelines;
                          if (!guidelines) return <div className="text-fg/60 text-sm">No guidelines</div>;
                          const guidelinesList = String(guidelines).split('\n').filter(g => g.trim());
                          if (guidelinesList.length === 0) return <div className="text-fg/60 text-sm">No guidelines</div>;
                          return (
                            <div className="space-y-1">
                              {guidelinesList.map((g, idx) => (
                                <div key={idx} className="text-fg text-sm leading-relaxed">• {g.trim()}</div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Knowledge Preview Card */}
            {message.preview.type === 'knowledge_add' && message.extractedConfig && (
              <div className="bg-[#1e4f3a] border border-[#2a7a5a] rounded-lg p-4 text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  <span className="text-emerald-400 font-semibold">Knowledge Added</span>
                </div>
                <div className="text-fg">
                  {message.extractedConfig.content as string || 'New knowledge item'}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Approval Buttons */}
        {message.requiresApproval && message.changeId && onApprove && onReject && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onApprove(message.changeId!)}
              disabled={isProcessing}
              className="px-4 py-2 bg-gradient-to-r from-[#5bb5f0] to-[#4a9fd9] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-fg/30 border-t-fg rounded-full animate-spin"></div>
                  Applying...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Yes, Proceed
                </>
              )}
            </button>
            <button
              onClick={() => onReject(message.changeId!)}
              disabled={isProcessing}
              className="px-4 py-2 bg-raised text-fg/70 rounded-lg text-sm font-medium hover:bg-raised-2 hover:text-fg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        )}
        
        {/* Timestamp */}
        <span className={`text-xs text-fg/40 mt-1 ${isUser ? 'text-right' : 'text-left'}`}>
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

