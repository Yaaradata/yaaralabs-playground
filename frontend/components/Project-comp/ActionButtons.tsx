interface ActionButtonsProps {
  onAddProject?: () => void;
  onCopyTemplate?: () => void;
  className?: string;
}

export default function ActionButtons({ 
  onAddProject,
  onCopyTemplate,
  className = ""
}: ActionButtonsProps) {
  return (
    <div className={`flex gap-4 ${className}`}>
      <button
        onClick={onAddProject}
        className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 transition-colors duration-200 font-medium"
      >
        <span className="text-xl">+</span>
        Add a new project
      </button>
      
      <button
        onClick={onCopyTemplate}
        className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 transition-colors duration-200 font-medium"
      >
        <span className="text-lg">📋</span>
        Copy template
      </button>
    </div>
  );
}
