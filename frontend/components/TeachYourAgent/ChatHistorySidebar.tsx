'use client';

import React from 'react';

// Format date consistently to avoid hydration mismatches
const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${year}`;
};

interface Chat {
  chat_id: string;
  agent_id: string;
  session_id: string;
  messages: Array<{
    message_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
    metadata?: Record<string, unknown>;
  }>;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  title: string | null;
  message_count: number;
}

interface ChatHistorySidebarProps {
  ongoingChat: Chat | null;
  chatHistory: Chat[];
  viewingChat: Chat | null;
  onClose: () => void;
  onCreateNewChat: () => void;
  onLoadChat: (chatId: string) => void;
  onDeleteChat: (chatId: string, e: React.MouseEvent) => void;
}

export default function ChatHistorySidebar({
  ongoingChat,
  chatHistory,
  viewingChat,
  onClose,
  onCreateNewChat,
  onLoadChat,
  onDeleteChat
}: ChatHistorySidebarProps) {
  return (
    <div className="w-80 border-r border-raised bg-card flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 200px)', maxHeight: 'calc(100vh - 200px)' }}>
      <div className="p-4 border-b border-raised flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-fg font-semibold">Chat History</h3>
          <button
            onClick={onClose}
            className="text-fg/60 hover:text-fg transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <button
          onClick={onCreateNewChat}
          className="w-full px-4 py-2 bg-purple-brand text-white rounded-lg hover:bg-[#a855c7] transition-colors text-sm font-medium"
        >
          + New Chat
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 min-h-0 chat-history-scroll">
        {/* Ongoing Chat */}
        {ongoingChat && (
          <div className="group relative mb-1.5">
            <button
              onClick={() => onLoadChat(ongoingChat.chat_id)}
              className={`w-full text-left p-2.5 rounded-lg transition-colors flex-shrink-0 ${
                viewingChat?.chat_id === ongoingChat.chat_id
                  ? 'bg-purple-brand/20 border border-magenta-brand'
                  : 'bg-canvas hover:bg-card border border-raised'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-fg text-sm font-medium truncate flex-1 mr-2">
                  {ongoingChat.title || 'New Chat'}
                </span>
                <span className="text-purple-brand text-xs flex-shrink-0">Active</span>
              </div>
              <p className="text-fg/50 text-xs truncate pr-8">
                {ongoingChat.messages.length > 0 
                  ? ongoingChat.messages[0].content
                  : 'No messages yet'}
              </p>
              <div className="flex items-center mt-0.5">
                <p className="text-fg/30 text-xs">
                  {formatDate(ongoingChat.updated_at)}
                </p>
                <span className="text-fg/30 text-xs ml-auto">{ongoingChat.message_count} msgs</span>
              </div>
            </button>
            <button
              onClick={(e) => onDeleteChat(ongoingChat.chat_id, e)}
              className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 z-10"
              title="Delete chat"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
        
        {/* Chat History */}
        {chatHistory.map((chat, index) => (
          <div key={chat.chat_id} className="group relative mb-1.5">
            <button
              onClick={() => onLoadChat(chat.chat_id)}
              className={`w-full text-left p-2.5 rounded-lg transition-colors flex-shrink-0 ${
                viewingChat?.chat_id === chat.chat_id
                  ? 'bg-purple-brand/20 border border-magenta-brand'
                  : 'bg-canvas hover:bg-card border border-raised'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-fg text-sm font-medium truncate flex-1 mr-2">
                  {chat.title || `Chat ${chatHistory.length - index}`}
                </span>
              </div>
              <p className="text-fg/50 text-xs truncate pr-8">
                {chat.messages.length > 0 
                  ? chat.messages[0].content
                  : 'No messages'}
              </p>
              <div className="flex items-center mt-0.5">
                <p className="text-fg/30 text-xs">
                  {formatDate(chat.updated_at)}
                </p>
                <span className="text-fg/30 text-xs ml-auto">{chat.message_count} msgs</span>
              </div>
            </button>
            <button
              onClick={(e) => onDeleteChat(chat.chat_id, e)}
              className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 z-10"
              title="Delete chat"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        ))}
        
        {chatHistory.length === 0 && !ongoingChat && (
          <div className="text-center py-8 text-fg/50 text-sm">
            No chat history yet
          </div>
        )}
      </div>
    </div>
  );
}

