'use client';

import { useState, useRef, useCallback } from 'react';

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

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
      setIsDragOver(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const handleFiles = (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length !== files.length) {
      alert('Some files are not images and were skipped.');
    }

    if (imageFiles.length > 20) {
      alert('Maximum 20 images can be uploaded at once.');
      return;
    }

    const newImages: UploadedImage[] = imageFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      id: Math.random().toString(36).substr(2, 9)
    }));

    setSelectedFiles(prev => [...prev, ...newImages]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const removeImage = (id: string) => {
    setSelectedFiles(prev => {
      const image = prev.find(img => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.preview);
      }
      return prev.filter(img => img.id !== id);
    });
  };

  const handleUpload = async () => {
    if (!label.trim()) {
      alert('Please enter a label for these images.');
      return;
    }

    if (selectedFiles.length === 0) {
      alert('Please select some images to upload.');
      return;
    }

    try {
      await onUpload(selectedFiles.map(img => img.file), label.trim());
      setSelectedFiles([]);
      setLabel('');
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  if (projectType !== 'image-recognition') {
    return (
      <div className="text-center py-8">
        <p className="text-fg/70">Image upload is only available for Image Recognition projects.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Label Input */}
      <div>
        <label htmlFor="image-label" className="block text-sm font-medium text-fg mb-2">
          Label for these images
        </label>
        <input
          id="image-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g., cats, dogs, cars..."
          className="w-full px-4 py-2 bg-card border border-magenta-brand/30 rounded-lg text-fg placeholder-fg/50 focus:border-pink-brand focus:outline-none"
          disabled={isUploading}
        />
      </div>

      {/* Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-all duration-300 ${
          isDragOver
            ? 'border-pink-brand bg-purple-brand/10'
            : 'border-magenta-brand/30 hover:border-magenta-brand/50'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileInput}
          className="hidden"
          disabled={isUploading}
        />
        
        <div className="space-y-4">
          <div className="text-6xl text-purple-brand/50">
            📷
          </div>
          <div>
            <p className="text-lg font-medium text-fg mb-2">
              {dragActive ? 'Drop images here' : 'Upload Images'}
            </p>
            <p className="text-fg/70 mb-4">
              Drag and drop images here, or click to select files
            </p>
            <button
              onClick={openFileDialog}
              disabled={isUploading}
              className="bg-purple-brand text-white px-6 py-2 rounded-lg font-medium hover:bg-purple-brand/90 transition-colors disabled:opacity-50"
            >
              Choose Images
            </button>
          </div>
          <p className="text-sm text-fg/50">
            Supports JPEG, PNG, GIF, WebP • Max 20 images • 10MB per image
          </p>
        </div>
      </div>

      {/* Selected Images Preview */}
      {selectedFiles.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-fg">
              Selected Images ({selectedFiles.length})
            </h3>
            <button
              onClick={() => {
                selectedFiles.forEach(img => URL.revokeObjectURL(img.preview));
                setSelectedFiles([]);
              }}
              className="text-red-400 hover:text-red-300 text-sm"
              disabled={isUploading}
            >
              Clear All
            </button>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {selectedFiles.map((image) => (
              <div key={image.id} className="relative group">
                <img
                  src={image.preview}
                  alt="Preview"
                  className="w-full h-24 object-cover rounded-lg border border-magenta-brand/20"
                />
                <button
                  onClick={() => removeImage(image.id)}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                  disabled={isUploading}
                >
                  ×
                </button>
                <p className="text-xs text-fg/70 mt-1 truncate">
                  {image.file.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Button */}
      {selectedFiles.length > 0 && label.trim() && (
        <div className="flex justify-center">
          <button
            onClick={handleUpload}
            disabled={isUploading || !label.trim()}
            className="bg-purple-brand text-white px-8 py-3 rounded-lg font-medium hover:bg-purple-brand/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? 'Uploading...' : `Upload ${selectedFiles.length} Image${selectedFiles.length > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
