interface ProjectCardProps {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  lastModified?: string;
  onClick?: () => void;
  className?: string;
}

export default function ProjectCard({
  title,
  description,
  thumbnail,
  lastModified,
  onClick,
  className = ""
}: ProjectCardProps) {
  return (
    <div 
      onClick={onClick}
      className={`bg-white border border-gray-200 rounded-lg p-6 hover:border-gray-300 hover:shadow-md transition-all duration-200 cursor-pointer ${className}`}
    >
      {thumbnail && (
        <div className="w-full h-32 bg-gray-100 rounded-md mb-4 flex items-center justify-center">
          <img 
            src={thumbnail} 
            alt={title}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}
      
      <h3 className="text-lg font-semibold text-gray-800 mb-2">{title}</h3>
      
      {description && (
        <p className="text-gray-600 text-sm mb-3">{description}</p>
      )}
      
      {lastModified && (
        <p className="text-fg/60 text-xs">
          Last modified: {lastModified}
        </p>
      )}
    </div>
  );
}
