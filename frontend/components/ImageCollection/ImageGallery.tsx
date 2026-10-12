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

const MIN_PER_LABEL = 5;
const FALLBACK =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+SW1hZ2U8L3RleHQ+PC9zdmc+';

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

  // Group images by label and include empty labels
  useEffect(() => {
    const grouped: Record<string, ImageExample[]> = {};
    const labelsFromImages = [...new Set(images.map(img => img.label).filter(Boolean))];
    [...new Set([...(labels || []), ...labelsFromImages])].forEach(label => {
      grouped[label] = [];
    });
    images.forEach(image => {
      if (image.label && grouped[image.label]) {
        grouped[image.label].push(image);
      }
    });
    setGroupedImages(grouped);
  }, [images, labels]);

  // Stable label order: the labels array first, then any label only seen on images (newest at top)
  const getStableLabelOrder = () => {
    const orderedLabels = [...(labels || [])];
    Object.keys(groupedImages || {}).forEach(label => {
      if (!orderedLabels.includes(label)) orderedLabels.unshift(label);
    });
    return orderedLabels;
  };

  const getImageUrl = (gcsUrl: string) => {
    // gs://bucket/images/project_id/label/filename -> our backend image endpoint (label/filename)
    if (gcsUrl.startsWith('gs://') && sessionId && projectId) {
      const parts = gcsUrl.split('/');
      const imagesIndex = parts.findIndex(part => part === 'images');
      if (imagesIndex !== -1 && imagesIndex < parts.length - 1) {
        const pathAfterImages = parts.slice(imagesIndex + 1);
        if (pathAfterImages.length > 1) {
          const imagePath = pathAfterImages.slice(1).join('/');
          return `${config.apiBaseUrl}/api/guests/session/${sessionId}/projects/${projectId}/images/${imagePath}`;
        }
      }
    }
    return gcsUrl;
  };

  const busy = isDeletingLabel || isDeletingExamples;

  if (isLoading && images.length === 0) {
    return (
      <div className="grid grid-cols-4 sm:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-2" aria-busy="true" aria-label="Loading images">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-[3/4] rounded-md bg-fg/5 animate-pulse" />
        ))}
      </div>
    );
  }

  if (images.length === 0 && labels.length === 0) {
    return (
      <div className="text-center py-10 rounded-lg border border-dashed border-fg/15">
        <svg className="w-10 h-10 mx-auto text-fg/25" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-fg/70 mt-2">No images yet</p>
        <p className="text-fg/50 text-sm mt-1">Add images on the left, or use the sample data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {getStableLabelOrder().filter(label => label && label.trim()).map(label => {
        const labelImages = groupedImages[label] || [];
        const enough = labelImages.length >= MIN_PER_LABEL;
        return (
          <section key={label} className="rounded-lg border border-fg/10 bg-canvas p-3" aria-label={`${label} images`}>
            <div className="flex flex-wrap items-center gap-2 mb-2.5">
              <h4 className="font-semibold text-fg text-sm">{label}</h4>
              <span className={`text-xs tabular-nums rounded-full px-2 py-0.5 ${enough ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-fg/5 text-fg/60'}`}>
                {labelImages.length} image{labelImages.length !== 1 ? 's' : ''}
                {enough ? '' : ` · needs ${MIN_PER_LABEL - labelImages.length} more`}
              </span>
              {isDeletingLabel && deletingLabelId === label && <span className="text-orange-400 text-xs">Deleting…</span>}
              {isDeletingExamples && deletingLabelId === label && <span className="text-orange-400 text-xs">Clearing…</span>}
              <span className="flex-1" />
              {onUploadImages && (
                <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-magenta-brand/40 text-fg hover:bg-purple-brand/10 cursor-pointer text-xs font-medium">
                  <span aria-hidden="true">+</span> Add
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length > 0) onUploadImages(files, label);
                      e.target.value = '';
                    }}
                    className="hidden"
                    disabled={busy}
                  />
                </label>
              )}
              {labelImages.length > 0 && onDeleteAllExamples && (
                <button
                  onClick={() => onDeleteAllExamples(label)}
                  disabled={busy}
                  className="text-orange-500 hover:text-orange-400 text-xs px-2 py-1 rounded-md border border-orange-400/30 disabled:opacity-50"
                  title="Clear all images but keep the label"
                >
                  {isDeletingExamples && deletingLabelId === label ? 'Deleting…' : 'Clear all'}
                </button>
              )}
              {((onDeleteLabel && labelImages.length > 0) || (onDeleteEmptyLabel && labelImages.length === 0)) && (
                <button
                  onClick={() => (labelImages.length > 0 ? onDeleteLabel?.(label) : onDeleteEmptyLabel?.(label))}
                  disabled={busy}
                  className="text-red-500 hover:text-red-600 p-1 disabled:opacity-50"
                  title={labelImages.length > 0 ? 'Delete the label and all its images' : 'Delete empty label'}
                  aria-label={`Delete label ${label}`}
                >
                  {isDeletingLabel && deletingLabelId === label ? (
                    <div className="w-4 h-4 border border-red-500/20 border-t-red-500 rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </button>
              )}
            </div>

            {labelImages.length === 0 ? (
              <p className="text-sm text-fg/50 py-3">No images in this label yet.</p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-2">
                {labelImages.map((image, index) => (
                  <div key={`${image.label}-${index}`} className="relative group">
                    <button
                      type="button"
                      className="block w-full aspect-[3/4] rounded-md overflow-hidden border border-fg/10 hover:border-pink-brand bg-white transition-colors"
                      onClick={() => {
                        setSelectedImage(image);
                        onImageClick?.(image.image_url);
                      }}
                      title={image.filename}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getImageUrl(image.image_url)}
                        alt={`${image.label}: ${image.filename}`}
                        className="w-full h-full object-cover object-top"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK; }}
                      />
                    </button>
                    {(onDeleteSpecificExample || onDelete) && (
                      <button
                        onClick={() => (onDeleteSpecificExample ? onDeleteSpecificExample(image.label, index) : onDelete?.(image.image_url))}
                        disabled={busy}
                        className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-30"
                        aria-label={`Delete ${image.filename}`}
                        title="Delete this image"
                      >
                        {isDeletingExamples && deletingLabelId === image.label && deletingExampleId === `${image.label}-${index}` ? '…' : '×'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* Image Modal */}
      {selectedImage && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setSelectedImage(null)}>
          <div className="max-w-4xl max-h-full bg-canvas rounded-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-magenta-brand/20 flex items-center justify-between gap-4">
              <h3 className="font-medium text-fg">
                {selectedImage.label} · {selectedImage.filename}
              </h3>
              <button onClick={() => setSelectedImage(null)} className="text-fg/70 hover:text-fg text-2xl leading-none" aria-label="Close">
                ×
              </button>
            </div>
            <div className="p-4 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getImageUrl(selectedImage.image_url)}
                alt={`${selectedImage.label}: ${selectedImage.filename}`}
                className="max-w-full max-h-[75vh] object-contain mx-auto"
                onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK; }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
