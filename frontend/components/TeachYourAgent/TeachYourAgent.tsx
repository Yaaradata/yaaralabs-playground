'use client';

import React, { useState, useEffect, useCallback } from 'react';
import config from '../../lib/config';
import ChatMessage, { Message } from './ChatMessage';
import ChatHistorySidebar from './ChatHistorySidebar';
import ChatMessagesArea from './ChatMessagesArea';

interface TeachYourAgentProps {
  agentId: string;
  sessionId: string;
  agentName?: string;
  agentAvatar?: string;
  onPersonaUpdated?: () => void;
  onKnowledgeAdded?: () => void;
  onActionCreated?: () => void;
}

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

// Global cache to persist chat state between section navigation
const chatCache: Map<string, Message[]> = new Map();

export default function TeachYourAgent({
  agentId,
  sessionId,
  agentName = 'AI Agent',
  agentAvatar,
  onPersonaUpdated,
  onKnowledgeAdded,
  onActionCreated
}: TeachYourAgentProps) {
  // Chat management state
  const [ongoingChat, setOngoingChat] = useState<Chat | null>(null);
  const [viewingChat, setViewingChat] = useState<Chat | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<Chat[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  
  // Message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingApproval, setIsProcessingApproval] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Convert Chat messages to Message format
  const convertChatMessagesToMessages = (chatMessages: Chat['messages']): Message[] => {
    return chatMessages.map((msg) => ({
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
  };

  // Load all chats and initialize
  const loadChats = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.getChats(agentId)}`
      );
      
      if (response.ok) {
        const data = await response.json();
        
        // Set chat history (archived chats) - always update this first
        if (data.chats) {
          setChatHistory(data.chats);
        } else {
          setChatHistory([]);
        }
        
        // Set ongoing chat
        if (data.ongoing_chat) {
          setOngoingChat(data.ongoing_chat);
          // Only update viewing chat if we're not already viewing a specific archived chat
          if (!viewingChat || viewingChat.chat_id === data.ongoing_chat.chat_id || viewingChat.is_active) {
            setViewingChat(data.ongoing_chat);
            setCurrentChatId(data.ongoing_chat.chat_id);
            setIsReadOnly(false);
            
            // Convert and set messages
            const convertedMessages = convertChatMessagesToMessages(data.ongoing_chat.messages);
            
            // Check cache - if we have cached messages, only update if API has more messages
            const cacheKey = `${agentId}-${data.ongoing_chat.chat_id}`;
            const cachedMessages = chatCache.get(cacheKey);
            
            if (cachedMessages && cachedMessages.length > 0 && convertedMessages.length <= cachedMessages.length) {
              // Keep cached messages if they're more recent or same length
              // This preserves state when switching tabs
              setMessages(cachedMessages);
            } else {
              // Use API messages if they're newer or cache is empty
              setMessages(convertedMessages);
              chatCache.set(cacheKey, convertedMessages);
            }
          }
        } else {
          // No ongoing chat, create one
          await createNewChatInBackend();
        }
      } else {
        // Error loading chats, create new one
        await createNewChatInBackend();
      }
    } catch (error) {
      console.error('Error loading chats:', error);
      await createNewChatInBackend();
    } finally {
      setIsInitializing(false);
    }
  }, [agentId, sessionId]);

  // Actually create a new chat in the backend
  const createNewChatInBackend = async () => {
    try {
      // Archive current chat if it exists and is active
      // Wait for archive to complete before creating new chat
      if (ongoingChat && ongoingChat.is_active) {
        try {
          const archiveResponse = await fetch(
            `${config.apiBaseUrl}${config.api.agents.training.archiveChat(ongoingChat.chat_id)}`,
            { method: 'POST' }
          );
          if (!archiveResponse.ok) {
            console.error('Failed to archive chat:', await archiveResponse.text());
          }
        } catch (error) {
          console.error('Error archiving chat:', error);
        }
      }
      
      const response = await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.createChat}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: agentId,
            session_id: sessionId
          })
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        const newChat = data.chat;
        
        // Reload chats FIRST to get updated history (including archived chat)
        await loadChats();
        
        // Then set the new chat as viewing
        setOngoingChat(newChat);
        setViewingChat(newChat);
        setCurrentChatId(newChat.chat_id);
        setIsReadOnly(false);
        
        // Convert and set messages
        const convertedMessages = convertChatMessagesToMessages(newChat.messages);
        setMessages(convertedMessages);
        
        // Cache messages
        const cacheKey = `${agentId}-${newChat.chat_id}`;
        chatCache.set(cacheKey, convertedMessages);
      }
    } catch (error) {
      console.error('Error creating new chat:', error);
    }
  };

  // Create a new chat in the same window
  const createNewChat = async () => {
    await createNewChatInBackend();
  };

  // Save messages to cache whenever they change
  useEffect(() => {
    if (agentId && messages.length > 0) {
      const cacheKey = `${agentId}-${sessionId}`;
      chatCache.set(cacheKey, messages);
    }
  }, [messages, agentId, sessionId]);

  // Initialize on mount - check cache first
  useEffect(() => {
    if (agentId) {
      // Check cache first
      const cacheKey = `${agentId}-${sessionId}`;
      const cachedMessages = chatCache.get(cacheKey);
      
      if (cachedMessages && cachedMessages.length > 0) {
        // Restore from cache immediately to preserve state when switching tabs
        setMessages(cachedMessages);
        setIsInitializing(false);
      }
      
      // Always load chats to get latest state from API (will merge intelligently in loadChats)
      loadChats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, sessionId]); // loadChats is memoized with agentId and sessionId, so it's safe to call

  // Switch to ongoing chat
  const switchToOngoingChat = async () => {
    if (ongoingChat) {
      setViewingChat(ongoingChat);
      setCurrentChatId(ongoingChat.chat_id);
      setIsReadOnly(false);
      
      const convertedMessages = convertChatMessagesToMessages(ongoingChat.messages);
      setMessages(convertedMessages);
      
      // Cache messages
      const cacheKey = `${agentId}-${ongoingChat.chat_id}`;
      chatCache.set(cacheKey, convertedMessages);
    } else {
      await loadChats();
    }
  };
  
  // Load a specific chat from history
  const loadChat = async (chatId: string) => {
    try {
      const response = await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.getChat(chatId)}`
      );
      
      if (response.ok) {
        const data = await response.json();
        const targetChat = data.chat;
        
        if (targetChat) {
          setViewingChat(targetChat);
          setCurrentChatId(targetChat.chat_id);
          // Make it editable - users can continue conversations
          setIsReadOnly(false);
          
          const convertedMessages = convertChatMessagesToMessages(targetChat.messages);
          setMessages(convertedMessages);
          
          // Cache messages
          const cacheKey = `${agentId}-${targetChat.chat_id}`;
          chatCache.set(cacheKey, convertedMessages);
          
          // Close history sidebar
          setShowChatHistory(false);
        }
      }
    } catch (error) {
      console.error('Error loading chat:', error);
    }
  };

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the chat load
    
    if (!confirm('Are you sure you want to delete this chat? This action cannot be undone.')) {
      return;
    }
    
    try {
      const response = await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.deleteChat(chatId)}`,
        { method: 'DELETE' }
      );
      
      if (response.ok) {
        // If we're viewing the deleted chat, switch to ongoing chat
        if (viewingChat?.chat_id === chatId) {
          if (ongoingChat && ongoingChat.chat_id !== chatId) {
            // Switch to ongoing chat
            await switchToOngoingChat();
          } else {
            // No ongoing chat, reload chats (will create a new one if needed)
            await loadChats();
          }
        }
        
        // Remove from cache
        const cacheKey = `${agentId}-${chatId}`;
        chatCache.delete(cacheKey);
        
        // Reload chats to update the list
        await loadChats();
      } else {
        const errorData = await response.json();
        alert(`Failed to delete chat: ${errorData.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting chat:', error);
      alert('Failed to delete chat. Please try again.');
    }
  };


  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading || isReadOnly) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Build context from all messages in the current chat (for context-aware follow-ups)
      const context = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Use current chat's session_id, or create new chat if none exists
      const chatId = currentChatId || viewingChat?.chat_id;
      const sessionIdToUse = viewingChat?.session_id || sessionId;

      const response = await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.message}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: agentId,
            session_id: sessionIdToUse,
            message: inputValue.trim(),
            context,
            chat_id: chatId // Pass chat_id to save messages to chat
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.response,
          timestamp: new Date(),
          intent: data.intent,
          preview: data.preview,
          changeId: data.change_id,
          requiresApproval: data.requires_approval,
          extractedConfig: data.extracted_config,
          isNewAction: data.intent === 'action_create' && data.preview
        };

        setMessages(prev => [...prev, assistantMessage]);
        
        // Update cache
        if (chatId) {
          const cacheKey = `${agentId}-${chatId}`;
          const cachedMessages = chatCache.get(cacheKey) || [];
          cachedMessages.push(userMessage, assistantMessage);
          chatCache.set(cacheKey, cachedMessages);
        }
        
        // Reload chats to get updated message count
        await loadChats();
        
        // Update ongoing chat messages
        if (ongoingChat && viewingChat?.chat_id === ongoingChat.chat_id) {
          const updatedChat = {
            ...ongoingChat,
            messages: [...ongoingChat.messages, 
              {
                message_id: assistantMessage.id,
                role: 'user' as const,
                content: userMessage.content,
                created_at: userMessage.timestamp.toISOString(),
                metadata: {}
              },
              {
                message_id: assistantMessage.id,
                role: 'assistant' as const,
                content: assistantMessage.content,
                created_at: assistantMessage.timestamp.toISOString(),
                metadata: {
                  intent: assistantMessage.intent,
                  change_id: assistantMessage.changeId,
                  requires_approval: assistantMessage.requiresApproval,
                  preview: assistantMessage.preview,
                  extracted_config: assistantMessage.extractedConfig
                }
              }
            ]
          };
          setOngoingChat(updatedChat);
          setViewingChat(updatedChat);
        }
        
        // Trigger callbacks if changes were auto-applied
        if (data.applied_change) {
          if (data.applied_change.type === 'persona_update') {
            onPersonaUpdated?.();
          } else if (data.applied_change.type === 'knowledge_add') {
            onKnowledgeAdded?.();
          } else if (data.applied_change.type === 'action_create') {
            onActionCreated?.();
          }
        }
      } else {
        const errorData = await response.json();
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `I encountered an error: ${errorData.detail || 'Please try again.'}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'I encountered a network error. Please check your connection and try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (changeId: string) => {
    setIsProcessingApproval(true);
    
    try {
      const response = await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.apply}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: agentId,
            change_id: changeId
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        
        // Update message to show approval
        setMessages(prev => prev.map(msg => {
          if (msg.changeId === changeId) {
            return {
              ...msg,
              requiresApproval: false,
              content: msg.content + '\n\n✅ Changes applied successfully!'
            };
          }
          return msg;
        }));

        // Add confirmation message
        const confirmMessage: Message = {
          id: `confirm-${Date.now()}`,
          role: 'assistant',
          content: `Great! ${data.message || 'Changes have been applied.'} What would you like to do next?`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, confirmMessage]);

        // Trigger appropriate callback
        if (data.type === 'persona_update') {
          onPersonaUpdated?.();
        } else if (data.type === 'knowledge_add') {
          onKnowledgeAdded?.();
        } else if (data.type === 'action_create') {
          onActionCreated?.();
        }
      } else {
        const errorData = await response.json();
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Failed to apply changes: ${errorData.detail || 'Please try again.'}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('Error applying change:', error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Failed to apply changes due to a network error. Please try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessingApproval(false);
    }
  };

  const handleReject = async (changeId: string) => {
    try {
      await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.reject(changeId)}`,
        { method: 'POST' }
      );

      // Update message to remove approval buttons
      setMessages(prev => prev.map(msg => {
        if (msg.changeId === changeId) {
          return {
            ...msg,
            requiresApproval: false
          };
        }
        return msg;
      }));

      // Add cancellation message
      const cancelMessage: Message = {
        id: `cancel-${Date.now()}`,
        role: 'assistant',
        content: 'Got it, I\'ve cancelled those changes. What would you like to do instead?',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, cancelMessage]);
    } catch (error) {
      console.error('Error rejecting change:', error);
    }
  };


  const handleRestart = async () => {
    if (!confirm('Are you sure you want to restart? This will archive the current chat and start a new one.')) {
      return;
    }
    
    // Archive current ongoing chat
    if (ongoingChat) {
      try {
        await fetch(
          `${config.apiBaseUrl}${config.api.agents.training.archiveChat(ongoingChat.chat_id)}`,
          { method: 'POST' }
        );
      } catch (error) {
        console.error('Error archiving chat:', error);
      }
    }
    
    // Create new chat
    await createNewChat();
    await loadChats();
  };

  const handleEditMessage = async (messageId: string, newContent: string) => {
    if (isReadOnly) return; // Can't edit in read-only mode
    
    try {
      const response = await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.editMessage(messageId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newContent })
        }
      );

      if (response.ok) {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId ? { ...msg, content: newContent } : msg
        ));
        setEditingMessageId(null);
        setEditContent('');
      }
    } catch (error) {
      console.error('Error editing message:', error);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (isReadOnly) return; // Can't delete in read-only mode
    if (!confirm('Are you sure you want to delete this message?')) {
      return;
    }
    
    try {
      const response = await fetch(
        `${config.apiBaseUrl}${config.api.agents.training.deleteMessage(messageId)}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        setMessages(prev => prev.filter(msg => msg.id !== messageId));
      }
    } catch (error) {
      console.error('Error deleting message:', error);
    }
  };

  const startEditMessage = (messageId: string, content: string) => {
    if (isReadOnly) return;
    setEditingMessageId(messageId);
    setEditContent(content);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };


  return (
    <div className="flex h-full bg-canvas rounded-xl border border-raised overflow-hidden">
      {/* Chat History Sidebar */}
      {showChatHistory && (
        <ChatHistorySidebar
          ongoingChat={ongoingChat}
          chatHistory={chatHistory}
          viewingChat={viewingChat}
          onClose={() => setShowChatHistory(false)}
          onCreateNewChat={createNewChat}
          onLoadChat={loadChat}
          onDeleteChat={handleDeleteChat}
        />
      )}
      
      {/* Main Chat Area */}
      <ChatMessagesArea
        messages={messages}
        inputValue={inputValue}
        isLoading={isLoading}
        isInitializing={isInitializing}
        isReadOnly={isReadOnly}
        editingMessageId={editingMessageId}
        editContent={editContent}
        agentAvatar={agentAvatar}
        onInputChange={setInputValue}
        onEditContentChange={setEditContent}
        onSendMessage={handleSendMessage}
        onKeyDown={handleKeyDown}
        onApprove={handleApprove}
        onReject={handleReject}
        onEditMessage={handleEditMessage}
        onDeleteMessage={handleDeleteMessage}
        onStartEditMessage={startEditMessage}
        onCancelEditMessage={cancelEditMessage}
        onToggleHistory={() => setShowChatHistory(!showChatHistory)}
        onCreateNewChat={createNewChat}
        onRestart={handleRestart}
        isProcessingApproval={isProcessingApproval}
      />
    </div>
  );
}
