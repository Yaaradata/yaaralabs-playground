interface NavigationProps {
  links?: string[];
  className?: string;
  isMobile?: boolean;
  theme?: 'dark' | 'light';
}

const defaultLinks = ['About'];

export default function Navigation({ 
  links = defaultLinks, 
  className = '', 
  isMobile = false,
  theme = 'dark'
}: NavigationProps) {
  const baseClasses = theme === 'dark' 
    ? "text-fg hover:text-pink-brand px-3 py-2 rounded-md font-medium transition-all duration-300"
    : "text-gray-700 hover:text-pink-brand px-3 py-2 rounded-md font-medium transition-all duration-300";
  
  const desktopClasses = "text-sm";
  const mobileClasses = "text-base block";
  
  const containerClasses = isMobile 
    ? "space-y-1" 
    : "flex items-baseline justify-center";

  const getLinkHref = (link: string) => {
    if (link === 'About') return '/about';
    return '#';
  };

  return (
    <div className={`${containerClasses} ${className}`}>
      {links.map((link) => (
        <a
          key={link}
          href={getLinkHref(link)}
          className={`${baseClasses} ${isMobile ? mobileClasses : desktopClasses}`}
        >
          {link}
        </a>
      ))}
    </div>
  );
}
