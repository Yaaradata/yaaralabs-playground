// Project components exports
export { default as ProjectHeader } from './ProjectHeader';
export { default as ActionButtons } from './ActionButtons';
export { default as EmptyState } from './EmptyState';
export { default as ProjectCard } from './ProjectCard';
export { default as ProjectGrid } from './ProjectGrid';

// Types
export interface Project {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  lastModified?: string;
}
