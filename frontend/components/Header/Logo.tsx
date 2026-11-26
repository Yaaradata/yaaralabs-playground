interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  theme?: 'dark' | 'light';
}

export default function Logo({ className = '', size = 'md' }: LogoProps) {
  const markSize = {
    sm: 'h-7 w-7',
    md: 'h-9 w-9',
    lg: 'h-11 w-11',
  };
  const wordmarkSize = {
    sm: 'h-3.5',
    md: 'h-[22px]',
    lg: 'h-7',
  };
  const playgroundSize = size === 'sm' ? 'text-[11px]' : size === 'md' ? 'text-[13px]' : 'text-sm';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src="/brand/yaaralabs-mark.svg"
        alt=""
        className={`${markSize[size]} shrink-0`}
      />
      <span className="flex min-w-0 flex-col justify-center leading-none">
        <span className="inline-flex items-center">
          <img
            src="/brand/yaaralabs-wordmark.svg"
            alt="YaaraLabs"
            className={`brand-wordmark-light ${wordmarkSize[size]} w-auto`}
          />
          <img
            src="/brand/yaaralabs-wordmark-dark.svg"
            alt=""
            aria-hidden="true"
            className={`brand-wordmark-dark ${wordmarkSize[size]} w-auto`}
          />
        </span>
        <span className={`font-serif italic text-purple-brand ${playgroundSize} mt-0.5`}>
          Playground
        </span>
      </span>
    </div>
  );
}
