'use client';

import { useState, useRef } from 'react';

interface ImageUploadProps {
  onUpload: (files: File[], label: string) => Promise<void>;
  isUploading: boolean;
  projectType: string;
}

interface UploadedImage {
  file: File;
  preview: string;
  id: string;
}


export default function ImageUpload({ onUpload, isUploading, projectType }: ImageUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<UploadedImage[]>([]);
  const [label, setLabel] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const labelReady = label.trim().length > 0;
  const canPickFiles = labelReady && !isUploading;

  const handleFiles = (files: File[]) => {
    if (!label.trim()) {
      alert('Enter a label first, then add images.');
      return;
    }
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    if (imageFiles.length !== files.length) {
      alert('Some files are not images and were skipped.');
    }
    if (selectedFiles.length + imageFiles.length > 20) {
      alert('Maximum 20 images can be uploaded at once.');
      return;
    }
    const newImages: UploadedImage[] = imageFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      id: Math.random().toString(36).slice(2, 11)
    }));
    setSelectedFiles(prev => [...prev, ...newImages]);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canPickFiles) return;
    const over = e.type === 'dragenter' || e.type === 'dragover';
    setDragActive(over);
    setIsDragOver(over);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setIsDragOver(false);
    if (!canPickFiles) return;
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeImage = (id: string) => {
    setSelectedFiles(prev => {
      const image = prev.find(img => img.id === id);
      if (image) URL.revokeObjectURL(image.preview);
      return prev.filter(img => img.id !== id);
    });
  };

  const clearSelected = () => {
    selectedFiles.forEach(img => URL.revokeObjectURL(img.preview));
    setSelectedFiles([]);
  };

  const handleUpload = async () => {
    if (!label.trim() || selectedFiles.length === 0) return;
    try {
      await onUpload(selectedFiles.map(img => img.file), label.trim());
      clearSelected();
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  if (projectType !== 'image-recognition') {
    return (
      <div className="text-center py-8">
        <p className="text-fg/70">Image upload is only available for Image Recognition projects.</p>
      </div>
    );
  }

  const primary = 'w-full bg-purple-brand text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-purple-brand/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="space-y-4">
      {/* Label Input */}
      <div>
        <label htmlFor="image-label" className="block text-sm font-medium text-fg mb-1.5">
          Label
        </label>
        <input
          id="image-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Invoice"
          className="w-full px-3 py-2 bg-canvas border border-magenta-brand/30 rounded-lg text-sm text-fg placeholder-fg/50 focus:border-pink-brand focus:outline-none"
          disabled={isUploading}
        />
      </div>

      {/* Upload Area — only after a label is entered */}
      <div
        className={`relative border-2 border-dashed rounded-lg px-4 py-6 text-center transition-colors ${
          !canPickFiles
            ? 'border-magenta-brand/20 opacity-50 cursor-not-allowed'
            : isDragOver
              ? 'border-pink-brand bg-purple-brand/10 cursor-pointer'
              : 'border-magenta-brand/30 hover:border-magenta-brand/60 hover:bg-purple-brand/5 cursor-pointer'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => canPickFiles && fileInputRef.current?.click()}
        role="button"
        tabIndex={canPickFiles ? 0 : -1}
        aria-disabled={!canPickFiles}
        onKeyDown={(e) => {
          if (!canPickFiles) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        aria-label={canPickFiles ? 'Choose images to upload' : 'Enter a label before adding images'}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => {
            if (e.target.files) handleFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
          className="hidden"
          disabled={!canPickFiles}
        />
        <svg className="w-8 h-8 mx-auto text-purple-brand/70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sm font-medium text-fg mt-2">
          {!labelReady
            ? 'Enter a label first'
            : dragActive
              ? 'Drop images here'
              : 'Drop images or click to browse'}
        </p>
        <p className="text-xs text-fg/50 mt-1">JPEG, PNG, GIF, WebP · up to 20 at once · 10 MB each</p>
      </div>

      {/* Selected images */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-fg">{selectedFiles.length} selected</span>
            <button onClick={clearSelected} className="text-pink-brand hover:underline text-xs" disabled={isUploading}>
              Clear all
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {selectedFiles.map((image) => (
              <div key={image.id} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.preview} alt={image.file.name} title={image.file.name} className="w-full aspect-square object-cover rounded-md border border-magenta-brand/20" />
                <button
                  onClick={() => removeImage(image.id)}
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  disabled={isUploading}
                  aria-label={`Remove ${image.file.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={handleUpload} disabled={isUploading || !label.trim() || selectedFiles.length === 0} className={primary}>
        {isUploading
          ? 'Uploading…'
          : selectedFiles.length > 0
            ? `Upload ${selectedFiles.length} image${selectedFiles.length > 1 ? 's' : ''}${label.trim() ? ` to ${label.trim()}` : ''}`
            : 'Upload'}
      </button>
      {selectedFiles.length > 0 && !label.trim() && <p className="text-xs text-pink-brand -mt-2">Enter a label first.</p>}
    </div>
  );
}
