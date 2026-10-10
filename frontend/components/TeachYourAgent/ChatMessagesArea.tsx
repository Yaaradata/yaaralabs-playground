'use client';

import React, { useRef, useEffect } from 'react';
import ChatMessage, { Message } from './ChatMessage';

interface ChatMessagesAreaProps {
  messages: Message[];
  inputValue: string;
  isLoading: boolean;
  isInitializing: boolean;
  isReadOnly: boolean;
  editingMessageId: string | null;
  editContent: string;
  agentAvatar?: string;
  onInputChange: (value: string) => void;
  onEditContentChange: (value: string) => void;
  onSendMessage: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onApprove: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onEditMessage: (messageId: string, newContent: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onStartEditMessage: (messageId: string, content: string) => void;
  onCancelEditMessage: () => void;
  onToggleHistory: () => void;
  onCreateNewChat: () => void;
  onRestart: () => void;
  isProcessingApproval: boolean;
}

export default function ChatMessagesArea({
  messages,
  inputValue,
  isLoading,
  isInitializing,
  isReadOnly,
  editingMessageId,
  editContent,
  agentAvatar,
  onInputChange,
  onEditContentChange,
  onSendMessage,
  onKeyDown,
  onApprove,
  onReject,
  onEditMessage,
  onDeleteMessage,
  onStartEditMessage,
  onCancelEditMessage,
  onToggleHistory,
  onCreateNewChat,
  onRestart,
  isProcessingApproval
}: ChatMessagesAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0" style={{ height: 'calc(100vh - 200px)', maxHeight: 'calc(100vh - 200px)' }}>
      {/* Header */}
      <div className="bg-card px-6 py-4 border-b border-raised flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-brand to-[#9147b3] flex items-center justify-center">
            <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div>
            <h2 className="text-fg font-semibold">Teach Your Agent</h2>
            <p className="text-fg/50 text-sm">Prepare your Agent by simply talking</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleHistory}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-raised text-fg/70 hover:text-fg hover:border-[#5a5a5a] transition-all duration-200"
            title="Chat History"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm">History</span>
          </button>
          
          <button
            onClick={onCreateNewChat}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-brand text-white hover:bg-[#a855c7] transition-all duration-200"
            title="New Chat"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm">New Chat</span>
          </button>
          
          <button
            onClick={onRestart}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-raised text-fg/70 hover:text-fg hover:border-[#5a5a5a] transition-all duration-200"
            title="Restart conversation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-sm">Restart</span>
          </button>
        </div>
      </div>
      
      {/* Messages Area - Scrollable with visible scrollbar */}
      <div className="flex-1 px-6 py-1 space-y-4 min-h-0 messages-area-scrollbar" ref={messagesEndRef}>
        {isInitializing ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-3 text-fg/50">
              <div className="w-6 h-6 border-2 border-magenta-brand/30 border-t-magenta-brand rounded-full animate-spin"></div>
              <span>Loading...</span>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div key={message.id} className="group relative">
                {editingMessageId === message.id ? (
                  // Edit mode
                  <div className="bg-card rounded-lg p-4 border border-magenta-brand">
                    <textarea
                      value={editContent}
                      onChange={(e) => onEditContentChange(e.target.value)}
                      className="w-full bg-canvas text-fg rounded-lg p-3 border border-raised focus:outline-none focus:border-magenta-brand resize-none"
                      rows={3}
                    />
                    <div className="flex justify-end gap-2 mt-3">
                      <button
                        onClick={onCancelEditMessage}
                        className="px-3 py-1.5 text-fg/60 hover:text-fg text-sm transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => onEditMessage(message.id, editContent)}
                        className="px-4 py-1.5 bg-purple-brand text-white rounded-lg text-sm hover:bg-[#a855c7] transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <ChatMessage
                      message={message}
                      agentAvatar={agentAvatar}
                      onApprove={onApprove}
                      onReject={onReject}
                      isProcessing={isProcessingApproval}
                    />
                    
                    {/* Edit button - show on hover for user messages (only if not read-only) */}
                    {message.role === 'user' && !isReadOnly && (
                      <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <button
                          onClick={() => onStartEditMessage(message.id, message.content)}
                          className="p-1.5 bg-card border border-raised rounded text-fg/60 hover:text-fg hover:border-[#5a5a5a] transition-all"
                          title="Edit message"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-brand to-[#9147b3] flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="bg-card rounded-2xl rounded-bl-md border border-raised px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-brand rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-purple-brand rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-purple-brand rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
      
      {/* Input Area */}
      <div className="p-4 border-t border-raised bg-card flex-shrink-0">
        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type here"
              disabled={isLoading}
              className="w-full px-4 py-3 bg-canvas border border-raised rounded-xl text-fg placeholder-fg/40 focus:outline-none focus:border-magenta-brand resize-none min-h-[48px] max-h-[120px] pr-12"
              rows={1}
            />
          </div>
          
          <button
            onClick={onSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="w-12 h-12 rounded-xl bg-gradient-to-r from-purple-brand to-[#9147b3] flex items-center justify-center text-white hover:opacity-90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-fg/30 border-t-fg rounded-full animate-spin"></div>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

