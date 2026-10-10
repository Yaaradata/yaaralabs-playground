'use client';

import { useState, useEffect } from 'react';
import config from '../../lib/config';

interface ImageExample {
  image_url: string;
  label: string;
  filename: string;
}

interface ImageGalleryProps {
  images: ImageExample[];
  labels?: string[];
  onDelete?: (imageUrl: string) => void;
  onImageClick?: (imageUrl: string) => void;
  onDeleteLabel?: (label: string) => void;
  onDeleteAllExamples?: (label: string) => void;
  onDeleteSpecificExample?: (label: string, exampleIndex: number) => void;
  onDeleteEmptyLabel?: (label: string) => void;
  onUploadImages?: (files: File[], label: string) => void;
  isLoading?: boolean;
  sessionId?: string;
  projectId?: string;
  isDeletingLabel?: boolean;
  isDeletingExamples?: boolean;
  deletingLabelId?: string;
  deletingExampleId?: string;
}

export default function ImageGallery({ 
  images, 
  labels = [],
  onDelete, 
  onImageClick, 
  onDeleteLabel,
  onDeleteAllExamples,
  onDeleteSpecificExample,
  onDeleteEmptyLabel,
  onUploadImages,
  isLoading, 
  sessionId, 
  projectId,
  isDeletingLabel = false,
  isDeletingExamples = false,
  deletingLabelId = '',
  deletingExampleId = ''
}: ImageGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<ImageExample | null>(null);
  const [groupedImages, setGroupedImages] = useState<Record<string, ImageExample[]>>({});

  // Debug logging
  useEffect(() => {
    if (images.length > 0) {

    }
  }, [images]);

  // Group images by label and include empty labels
  useEffect(() => {

    
    const grouped: Record<string, ImageExample[]> = {};
    
    // Get all unique labels from both sources
    const labelsFromArray = labels || [];
    const labelsFromImages = [...new Set(images.map(img => img.label).filter(Boolean))];
    const allUniqueLabels = [...new Set([...labelsFromArray, ...labelsFromImages])];
    
    console.log('🖼️ Labels from array:', labelsFromArray);
    console.log('🖼️ Labels from images:', labelsFromImages);
    console.log('🖼️ All unique labels:', allUniqueLabels);
    
    // Initialize all labels with empty arrays
    allUniqueLabels.forEach(label => {
      grouped[label] = [];
    });
    
    // Add images to their respective labels
    images.forEach(image => {
      if (image.label && grouped[image.label]) {
        grouped[image.label].push(image);
      }
    });
    
    console.log('🖼️ Final grouped images:', grouped);
    setGroupedImages(grouped);
  }, [images, labels]);

  // Create a stable label order that preserves existing order and puts new labels at top
  const getStableLabelOrder = () => {
    const labelsFromArray = labels || [];
    const labelsFromImages = Object.keys(groupedImages || {});
    
    // Create ordered labels: labels array first (maintains order), then any additional labels from images
    const orderedLabels = [...labelsFromArray];
    labelsFromImages.forEach(label => {
      if (!orderedLabels.includes(label)) {
        // Add new labels at the top to maintain "newest first" ordering
        orderedLabels.unshift(label);
      }
    });

    
    return orderedLabels;
  };

  const getImageUrl = (gcsUrl: string) => {
    // Convert GCS URL to use our backend endpoint
    if (gcsUrl.startsWith('gs://') && sessionId && projectId) {
      // Extract the path after the bucket name
      // gs://playgroundai-470111-data/images/project_id/label/filename
      const parts = gcsUrl.split('/');
      const imagesIndex = parts.findIndex(part => part === 'images');
      if (imagesIndex !== -1 && imagesIndex < parts.length - 1) {
        // Get everything after 'images/project_id/' (skip the project_id part)
        const pathAfterImages = parts.slice(imagesIndex + 1);
        if (pathAfterImages.length > 1) {
          // Skip the first part (project_id) and join the rest (label/filename)
          const imagePath = pathAfterImages.slice(1).join('/');
          const backendUrl = `${config.apiBaseUrl}/api/guests/session/${sessionId}/projects/${projectId}/images/${imagePath}`;
          return backendUrl;
        }
      }
    }
    return gcsUrl;
  };

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-brand mx-auto"></div>
        <p className="text-fg/70 mt-2">Loading images...</p>
      </div>
    );
  }

  if (images.length === 0 && labels.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl text-fg/20 mb-4">📷</div>
        <p className="text-fg/70 text-lg">No images uploaded yet</p>
        <p className="text-fg/50 text-sm mt-2">Upload some images to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="bg-card rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-fg">Image Collection</h3>
            <p className="text-fg/70 text-sm">
              {images.length} image{images.length !== 1 ? 's' : ''} across {Object.keys(groupedImages).length} label{Object.keys(groupedImages).length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-fg/50">Labels:</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {getStableLabelOrder().filter(label => label && label.trim()).map(label => (
                <span
                  key={label}
                  className="bg-purple-brand text-white px-2 py-1 rounded text-xs font-medium"
                >
                  {label} ({groupedImages[label]?.length || 0})
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Images by Label */}
      {getStableLabelOrder().filter(label => label && label.trim()).map(label => {
        const labelImages = groupedImages[label] || [];
        return (
        <div key={label} className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-medium text-fg flex items-center">
              <span className="bg-purple-brand text-white px-3 py-1 rounded-full text-sm font-medium mr-3">
                {label}
              </span>
              <span className="text-fg/70 text-sm">
                {labelImages.length} image{labelImages.length !== 1 ? 's' : ''}
              </span>
              {(isDeletingLabel && deletingLabelId === label) && (
                <span className="ml-2 text-orange-400 text-sm font-normal">Deleting...</span>
              )}
              {(isDeletingExamples && deletingLabelId === label) && (
                <span className="ml-2 text-orange-400 text-sm font-normal">Clearing examples...</span>
              )}
            </h4>
            
            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {/* Add Examples button */}
              {onUploadImages && (
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-brand text-white rounded-lg hover:bg-purple-brand/90 transition-all duration-300 cursor-pointer text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Add Examples
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length > 0) {
                        onUploadImages(files, label);
                      }
                    }}
                    className="hidden"
                    disabled={isDeletingLabel || isDeletingExamples}
                  />
                </label>
              )}

              {/* Clear All button */}
              {labelImages.length > 0 && onDeleteAllExamples && (
                <button
                  onClick={() => onDeleteAllExamples(label)}
                  disabled={isDeletingLabel || isDeletingExamples}
                  className="text-orange-400 hover:text-orange-300 transition-all duration-300 text-xs px-2 py-1 rounded border border-orange-400/30 hover:border-orange-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Clear all images but keep the label"
                >
                  {isDeletingExamples && deletingLabelId === label ? 'Deleting...' : 'Clear All'}
                </button>
              )}

              {/* X button - Delete Entire Label */}
              {onDeleteLabel && labelImages.length > 0 && (
                <button
                  onClick={() => onDeleteLabel(label)}
                  disabled={isDeletingLabel || isDeletingExamples}
                  className="text-red-500 hover:text-red-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete entire label and all images"
                >
                  {isDeletingLabel && deletingLabelId === label ? (
                    <div className="w-4 h-4 border border-red-500/20 border-t-red-500 rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </button>
              )}

              {/* Delete Empty Label button */}
              {onDeleteEmptyLabel && labelImages.length === 0 && (
                <button
                  onClick={() => onDeleteEmptyLabel(label)}
                  disabled={isDeletingLabel || isDeletingExamples}
                  className="text-red-500 hover:text-red-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete empty label"
                >
                  {isDeletingLabel && deletingLabelId === label ? (
                    <div className="w-4 h-4 border border-red-500/20 border-t-red-500 rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {labelImages.length === 0 ? (
              <div className="col-span-full text-center py-8">
                <div className="text-4xl text-fg/20 mb-4">📷</div>
                <p className="text-fg/60 text-sm mb-4">No images for this label</p>
                {onUploadImages && (
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-purple-brand text-white rounded-lg hover:bg-purple-brand/90 transition-all duration-300 cursor-pointer text-sm font-medium">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                    </svg>
                    Upload Images
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0) {
                          onUploadImages(files, label);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            ) : (
              labelImages.map((image, index) => (
              <div
                key={`${image.label}-${index}`}
                className="relative group cursor-pointer"
                onClick={() => {
                  setSelectedImage(image);
                  onImageClick?.(image.image_url);
                }}
              >
                <div className="aspect-square rounded-lg overflow-hidden border border-magenta-brand/20 hover:border-pink-brand transition-colors">
                  <img
                    src={getImageUrl(image.image_url)}
                    alt={`${image.label} example`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Fallback for images that can't be loaded
                      const target = e.target as HTMLImageElement;
                      target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+SW1hZ2U8L3RleHQ+PC9zdmc+';
                    }}
                  />
                </div>
                
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-fg text-xs font-medium mb-1">View</p>
                    {onDeleteSpecificExample && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('🗑️ Delete button clicked for image:', image);
                          console.log('🗑️ Current groupedImages state:', groupedImages);
                          console.log('🗑️ Images for label:', groupedImages[image.label]);
                          
                          // Use the index from the map function directly since it should be correct
                          console.log('🗑️ Using index from map function:', index);
                          console.log('🗑️ Total images in this label group:', groupedImages[image.label]?.length || 0);
                          
                          onDeleteSpecificExample(image.label, index);
                        }}
                        disabled={isDeletingLabel || isDeletingExamples}
                        className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isDeletingExamples && deletingLabelId === image.label && deletingExampleId === `${image.label}-${index}` ? (
                          <div className="w-3 h-3 border border-red-400/20 border-t-red-400 rounded-full animate-spin"></div>
                        ) : (
                          'Delete'
                        )}
                      </button>
                    )}
                    {onDelete && !onDeleteSpecificExample && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(image.image_url);
                        }}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                
                <p className="text-xs text-fg/70 mt-1 truncate">
                  {image.filename}
                </p>
              </div>
              ))
            )}
          </div>
        </div>
        );
      })}

      {/* Image Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div className="max-w-4xl max-h-full bg-canvas rounded-lg overflow-hidden">
            <div className="p-4 border-b border-magenta-brand/20 flex items-center justify-between">
              <h3 className="text-lg font-medium text-fg">
                {selectedImage.label} - {selectedImage.filename}
              </h3>
              <button
                onClick={() => setSelectedImage(null)}
                className="text-fg/70 hover:text-fg text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <img
                src={getImageUrl(selectedImage.image_url)}
                alt={`${selectedImage.label} example`}
                className="max-w-full max-h-[70vh] object-contain mx-auto"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjIwMCIgeT0iMTUwIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiM2NjYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5JbWFnZSBVbmF2YWlsYWJsZTwvdGV4dD48L3N2Zz4=';
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
