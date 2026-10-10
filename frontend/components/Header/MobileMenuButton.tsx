interface MobileMenuButtonProps {
  isOpen: boolean;
  onClick: () => void;
  className?: string;
}

export default function MobileMenuButton({ 
  isOpen, 
  onClick, 
  className = '' 
}: MobileMenuButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`text-fg hover:text-fg/80 focus:outline-none focus:text-fg/80 transition-colors duration-200 ${className}`}
      aria-label="Toggle mobile menu"
      aria-expanded={isOpen}
    >
      <svg 
        className="h-6 w-6" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        {isOpen ? (
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M6 18L18 6M6 6l12 12" 
          />
        ) : (
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M4 6h16M4 12h16M4 18h16" 
          />
        )}
      </svg>
    </button>
  );
}
