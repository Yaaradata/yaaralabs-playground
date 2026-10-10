interface ProjectHeaderProps {
  title?: string;
  className?: string;
}

export default function ProjectHeader({ 
  title = "Your machine learning projects",
  className = ""
}: ProjectHeaderProps) {
  return (
    <div className={`text-center mb-8 ${className}`}>
      <h1 className="text-3xl md:text-4xl font-semibold text-gray-800 mb-4">
        {title}
      </h1>
    </div>
  );
}
