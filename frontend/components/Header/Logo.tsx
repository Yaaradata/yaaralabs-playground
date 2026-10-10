interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  theme?: 'dark' | 'light';
}

export default function Logo({ className = '', size = 'md', theme = 'dark' }: LogoProps) {
  const markSize = {
    sm: 'h-7 w-7',
    md: 'h-9 w-9',
    lg: 'h-12 w-12'
  };
  const textSize = size === 'sm' ? 'text-base' : size === 'md' ? 'text-lg' : 'text-2xl';

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img
        src="/yaaralogo.jpg"
        alt="YaaraLabs"
        className={`${markSize[size]} rounded-full`}
      />
      <span className={`${textSize} leading-none`}>
        <span className={`font-extrabold tracking-wide ${theme === 'dark' ? 'text-fg' : 'text-ink'}`}>
          YAARALABS
        </span>{' '}
        <span className={`font-medium ${theme === 'dark' ? 'text-fg/60' : 'text-ink/60'}`}>
          Playground
        </span>
      </span>
    </div>
  );
}
