interface LoginButtonProps {
  className?: string;
  variant?: 'default' | 'mobile';
  text?: string;
  onClick?: () => void;
}

export default function LoginButton({ 
  className = '', 
  variant = 'default',
  text = 'Log in',
  onClick
}: LoginButtonProps) {
  const baseClasses = "text-fg hover:text-pink-brand px-3 py-2 rounded-md font-medium transition-all duration-300";
  
  const variantClasses = {
    default: "text-sm",
    mobile: "text-base"
  };

  return (
    <button 
      onClick={onClick}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
    >
      {text}
    </button>
  );
}
