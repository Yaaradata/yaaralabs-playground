import Navigation from './Navigation';

interface MobileMenuProps {
  isOpen: boolean;
  links?: string[];
  className?: string;
}

export default function MobileMenu({ 
  isOpen, 
  links,
  className = ''
}: MobileMenuProps) {
  if (!isOpen) return null;

  return (
    <div className={`md:hidden ${className}`}>
      <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-canvas border-t border-magenta-brand/20">
        <Navigation links={links} isMobile={true} />
        
        <a
          href="https://www.yaaralabs.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 px-3 py-2 border-t border-magenta-brand/20 mt-4 pt-4 text-sm font-medium text-fg/70 hover:text-pink-brand"
        >
          yaaralabs.ai <span aria-hidden>↗</span>
        </a>
      </div>
    </div>
  );
}
