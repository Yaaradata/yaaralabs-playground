interface EmptyStateProps {
  message?: string;
  subMessage?: string;
  className?: string;
}

export default function EmptyState({ 
  message = "Click the 'plus' button on the right to create your first project.",
  subMessage = "→",
  className = ""
}: EmptyStateProps) {
  return (
    <div className={`bg-blue-50 border border-blue-200 rounded-lg p-6 text-center ${className}`}>
      <p className="text-blue-700 text-lg">
        {message} <span className="ml-2">{subMessage}</span>
      </p>
    </div>
  );
}
