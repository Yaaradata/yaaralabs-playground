'use client';

import React from 'react';

interface ChangePreviewProps {
  type: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  changes?: Array<{ field?: string; old?: unknown; new?: unknown; action?: string; content?: unknown; rule?: unknown }>;
  onApprove?: () => void;
  onReject?: () => void;
  isProcessing?: boolean;
}

export default function ChangePreview({
  type,
  before,
  after,
  changes,
  onApprove,
  onReject,
  isProcessing = false
}: ChangePreviewProps) {
  const renderPersonaPreview = () => (
    <div className="space-y-4">
      {/* Before Section */}
      {before && Object.keys(before).length > 0 && (
        <div className="relative pl-8">
          <div className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center">
            <span className="text-fg/40 text-xs font-medium transform -rotate-90 whitespace-nowrap">BEFORE</span>
          </div>
          <div className="bg-card border border-raised rounded-lg p-4">
            <div className="text-fg/60 text-sm font-medium mb-3">Persona</div>
            <div className="space-y-2">
              {Object.entries(before)
                .filter(([, value]) => value)
                .map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2 text-sm">
                    <span className="text-fg/50">•</span>
                    <span className="text-fg/70 capitalize">{key}:</span>
                    <span className="text-fg/90">{String(value)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
      
      {/* After Section */}
      <div className="relative pl-8">
        <div className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center">
          <span className="text-[#5bb5f0] text-xs font-medium transform -rotate-90 whitespace-nowrap">AFTER</span>
        </div>
        <div className="bg-gradient-to-r from-[#1e3a4f] to-[#1a3040] border border-[#2a5a7a] rounded-lg p-4">
          <div className="text-fg font-medium mb-3">Updated Persona</div>
          <div className="space-y-2">
            {Object.entries(after)
              .filter(([, value]) => value)
              .map(([key, value]) => (
                <div key={key} className="flex items-start gap-2 text-sm">
                  <span className="text-[#5bb5f0]">•</span>
                  <span className="text-fg/70 capitalize">{key}:</span>
                  <span className="text-fg">{String(value)}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
      
      {/* Changes Summary */}
      {changes && changes.length > 0 && (
        <div className="bg-card border border-raised rounded-lg p-3">
          <div className="text-fg/60 text-xs font-medium mb-2">Changes</div>
          <div className="space-y-1">
            {changes.map((change, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="text-pink-brand">→</span>
                <span className="text-fg/70 capitalize">{change.field}:</span>
                <span className="text-fg/50 line-through">{String(change.old || 'none')}</span>
                <span className="text-fg">→</span>
                <span className="text-pink-brand">{String(change.new)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderActionPreview = () => (
    <div className="bg-gradient-to-r from-[#1e3a4f] to-[#1a3040] border border-[#2a5a7a] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-[#5bb5f0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="text-fg font-medium">New Action</span>
      </div>
      
      <div className="space-y-3">
        {/* Conditions */}
        {(after.conditions as Array<{type: string; value: string}>)?.map((condition, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-[#5bb5f0] font-semibold text-sm min-w-[60px]">WHEN</span>
            <span className="bg-[#2a5a7a]/50 px-2 py-1 rounded text-white text-sm">
              {condition.type}
            </span>
            {condition.value && (
              <span className="text-fg/80 text-sm">&quot;{condition.value}&quot;</span>
            )}
          </div>
        ))}
        
        {/* Actions */}
        {(after.actions as Array<{type: string; value: string}>)?.map((action, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-[#f0b95b] font-semibold text-sm min-w-[60px]">DO</span>
            <span className="bg-[#7a5a2a]/50 px-2 py-1 rounded text-white text-sm">
              {action.type}
            </span>
            <span className="text-fg/80 text-sm">&quot;{action.value}&quot;</span>
          </div>
        ))}
        
        {/* Channels */}
        <div className="flex items-center gap-2">
          <span className="text-[#5bb5f0] font-semibold text-sm min-w-[60px]">CHANNELS</span>
          <span className="bg-[#3a5a6a] px-2 py-1 rounded text-white text-xs">All Channels</span>
        </div>
      </div>
    </div>
  );

  const renderKnowledgePreview = () => (
    <div className="bg-gradient-to-r from-[#1e4f3a] to-[#1a403a] border border-[#2a7a5a] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <span className="text-fg font-medium">New Knowledge</span>
      </div>
      
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-emerald-400 font-semibold text-sm">TYPE</span>
          <span className="bg-[#2a7a5a]/50 px-2 py-1 rounded text-white text-sm capitalize">
            {(after.type as string) || 'text'}
          </span>
        </div>
        
        {(after.type as string) === 'qna' ? (
          <>
            <div className="mt-2">
              <span className="text-emerald-400 font-semibold text-sm">Q:</span>
              <p className="text-fg/90 text-sm mt-1">{after.question as string}</p>
            </div>
            <div>
              <span className="text-emerald-400 font-semibold text-sm">A:</span>
              <p className="text-fg/90 text-sm mt-1">{after.answer as string}</p>
            </div>
          </>
        ) : (
          <div className="mt-2">
            <span className="text-emerald-400 font-semibold text-sm">CONTENT</span>
            <p className="text-fg/90 text-sm mt-1">{after.content as string}</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="bg-canvas rounded-xl border border-raised overflow-hidden">
      {/* Header */}
      <div className="bg-card px-4 py-3 border-b border-raised">
        <h3 className="text-fg font-medium flex items-center gap-2">
          <svg className="w-5 h-5 text-pink-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Preview Changes
        </h3>
      </div>
      
      {/* Content */}
      <div className="p-4">
        {type === 'persona_update' && renderPersonaPreview()}
        {type === 'action_create' && renderActionPreview()}
        {type === 'knowledge_add' && renderKnowledgePreview()}
      </div>
      
      {/* Action Buttons */}
      {onApprove && onReject && (
        <div className="px-4 pb-4 flex gap-3 justify-end">
          <button
            onClick={onReject}
            disabled={isProcessing}
            className="px-4 py-2 bg-raised text-fg/70 rounded-lg text-sm font-medium hover:bg-raised-2 hover:text-fg transition-all duration-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            disabled={isProcessing}
            className="px-5 py-2 bg-gradient-to-r from-purple-brand to-pink-brand text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-all duration-200 disabled:opacity-50 flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-canvas/30 border-t-ink rounded-full animate-spin"></div>
                Applying...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Apply Changes
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

