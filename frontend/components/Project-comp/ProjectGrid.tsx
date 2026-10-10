import ProjectCard from './ProjectCard';

interface Project {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  lastModified?: string;
}

interface ProjectGridProps {
  projects: Project[];
  onProjectClick?: (project: Project) => void;
  className?: string;
}

export default function ProjectGrid({
  projects,
  onProjectClick,
  className = ""
}: ProjectGridProps) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 ${className}`}>
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          id={project.id}
          title={project.title}
          description={project.description}
          thumbnail={project.thumbnail}
          lastModified={project.lastModified}
          onClick={() => onProjectClick?.(project)}
        />
      ))}
    </div>
  );
}
