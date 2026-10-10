'use client';

import React, { useState, useEffect } from 'react';
import { Message } from './ChatMessage';
import config from '../../lib/config';

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

interface ChatHistoryProps {
  agentId: string;
  ongoingChat: Chat | null;
  onClose: () => void;
  onSwitchToOngoing: () => void;
  onSwitchToPrevious: (chatId: string) => void;
  onEditMessage?: (messageId: string, content: string) => void;
  onDeleteMessage?: (messageId: string) => void;
}

export default function ChatHistory({ 
  agentId,
  ongoingChat,
  onClose,
  onSwitchToOngoing,
  onSwitchToPrevious,
  onEditMessage,
  onDeleteMessage
}: ChatHistoryProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [view, setView] = useState<'chats' | 'messages'>('chats');

  // Load all chats when component mounts
  useEffect(() => {
    if (agentId) {
      loadChats();
    }
  }, [agentId]);

  // Load messages when a chat is selected
  useEffect(() => {
    if (selectedChat && view === 'messages') {
      loadMessages(selectedChat);
    }
  }, [selectedChat, view]);

  const loadChats = async () => {
    setIsLoadingChats(true);
    try {
      const response = await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.getChats(agentId)}`
      );
      
      if (response.ok) {
        const data = await response.json();
        setChats(data.chats || []);
      }
    } catch (error) {
      console.error('Error loading chats:', error);
    } finally {
      setIsLoadingChats(false);
    }
  };

  const loadMessages = async (chat: Chat) => {
    setIsLoadingMessages(true);
    try {
      // Convert chat messages to Message format
      const convertedMessages: Message[] = chat.messages.map((msg) => ({
        id: msg.message_id,
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.created_at),
        intent: msg.metadata?.intent as string | undefined,
        changeId: msg.metadata?.change_id as string | undefined,
        requiresApproval: msg.metadata?.requires_approval as boolean | undefined,
        preview: msg.metadata?.preview as Message['preview'] | undefined,
        extractedConfig: msg.metadata?.extracted_config as Record<string, unknown> | undefined
      }));
      
      setMessages(convertedMessages);
    } catch (error) {
      console.error('Error loading messages:', error);
      setMessages([]);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  const handleOngoingChatClick = () => {
    onSwitchToOngoing();
    onClose();
  };

  const handlePreviousChatClick = (chat: Chat) => {
    setSelectedChat(chat);
    setView('messages');
  };

  const handleBackToChats = () => {
    setView('chats');
    setSelectedChat(null);
    setMessages([]);
  };

  const getLastMessagePreview = (chat: Chat): string => {
    if (chat.messages && chat.messages.length > 0) {
      const lastMsg = chat.messages[chat.messages.length - 1];
      return lastMsg.content.substring(0, 100) + (lastMsg.content.length > 100 ? '...' : '');
    }
    return 'No messages';
  };

  return (
    <div className="w-full h-full flex flex-col bg-canvas rounded-xl border border-raised overflow-hidden">
      {/* Header */}
      <div className="bg-card px-6 py-4 border-b border-raised flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-purple-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-fg font-semibold text-lg">
            {view === 'chats' ? 'Chat History' : 'Chat Messages'}
          </h2>
          {view === 'chats' && (
            <span className="text-fg/40 text-sm">({chats.length} previous chats)</span>
          )}
          {view === 'messages' && (
            <span className="text-fg/40 text-sm">({messages.length} messages)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {view === 'messages' && (
            <button
              onClick={handleBackToChats}
              className="flex items-center gap-2 px-3 py-1.5 text-fg/70 hover:text-fg text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back
            </button>
          )}
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-1.5 text-fg/70 hover:text-fg text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Close
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 p-6 overflow-y-auto">
        {view === 'chats' ? (
          <>
            {/* Ongoing Chat Option */}
            {ongoingChat && (
              <div
                onClick={handleOngoingChatClick}
                className="mb-4 p-4 bg-purple-brand/10 border border-magenta-brand/30 rounded-lg cursor-pointer hover:bg-purple-brand/20 hover:border-magenta-brand/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-brand to-[#9147b3] flex items-center justify-center">
                    <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-fg font-medium">Ongoing Chat</h3>
                      <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Active</span>
                    </div>
                    <p className="text-fg/60 text-sm mt-1">
                      {getLastMessagePreview(ongoingChat)}
                    </p>
                    <p className="text-fg/40 text-xs mt-1">
                      {ongoingChat.message_count} message{ongoingChat.message_count !== 1 ? 's' : ''} • {formatTimeAgo(ongoingChat.updated_at)}
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-fg/40 group-hover:text-fg transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            )}

            {/* Previous Chats List */}
            {isLoadingChats ? (
              <div className="text-center py-12">
                <svg className="w-8 h-8 text-fg/20 mx-auto mb-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-fg/40 text-sm">Loading chats...</p>
              </div>
            ) : chats.length === 0 ? (
              <div className="text-center py-12">
                <svg className="w-16 h-16 text-fg/20 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-fg/40 text-sm">No previous chats found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {chats.map((chat) => (
                  <div
                    key={chat.chat_id}
                    onClick={() => handlePreviousChatClick(chat)}
                    className="p-4 bg-card border border-raised rounded-lg cursor-pointer hover:bg-raised hover:border-magenta-brand/30 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-raised flex items-center justify-center">
                        <svg className="w-5 h-5 text-fg/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-fg/90 text-sm font-medium truncate">
                            {getLastMessagePreview(chat)}
                          </p>
                          <span className="text-fg/40 text-xs">
                            {chat.message_count} message{chat.message_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <p className="text-fg/50 text-xs">
                          {formatTimeAgo(chat.updated_at)}
                        </p>
                      </div>
                      <svg className="w-5 h-5 text-fg/40 group-hover:text-fg transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Messages View */
          isLoadingMessages ? (
            <div className="text-center py-12">
              <svg className="w-8 h-8 text-fg/20 mx-auto mb-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-fg/40 text-sm">Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-fg/40 text-sm">No messages in this chat</p>
            </div>
          ) : (
            <>
              {/* Switch to Ongoing Chat Banner (if viewing previous chat) */}
              {selectedChat && !selectedChat.is_active && ongoingChat && (
                <div className="mb-4 p-4 bg-purple-brand/10 border border-magenta-brand/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-fg font-medium text-sm mb-1">Viewing previous chat</p>
                      <p className="text-fg/60 text-xs">This is a read-only view. Switch to ongoing chat to continue the conversation.</p>
                    </div>
                    <button
                      onClick={() => {
                        onSwitchToOngoing();
                        onClose();
                      }}
                      className="px-4 py-2 bg-purple-brand text-white rounded-lg text-sm font-medium hover:bg-[#a855c7] transition-colors"
                    >
                      Switch to Ongoing Chat
                    </button>
                  </div>
                </div>
              )}
              
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${
                      message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* Avatar */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      message.role === 'user' 
                        ? 'bg-[#5e5ce6]' 
                        : 'bg-gradient-to-br from-purple-brand to-[#9147b3]'
                    }`}>
                      {message.role === 'user' ? (
                        <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      )}
                    </div>
                    {/* Message Content */}
                    <div className={`flex-1 min-w-0 ${
                      message.role === 'user' ? 'items-end' : 'items-start'
                    } flex flex-col`}>
                      <div className={`p-3 rounded-lg ${
                        message.role === 'user'
                          ? 'bg-[#5e5ce6]/20 border border-[#5e5ce6]/30'
                          : 'bg-card border border-raised'
                      }`}>
                        <p className={`text-sm whitespace-pre-wrap ${
                          message.role === 'user' ? 'text-fg' : 'text-fg/90'
                        }`}>
                          {message.content}
                        </p>
                      </div>
                      <span className="text-fg/30 text-xs mt-1 px-1">
                        {message.timestamp.toLocaleString([], { 
                          month: 'short', 
                          day: 'numeric', 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
