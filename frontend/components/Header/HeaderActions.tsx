import LoginButton from './LoginButton';
import LanguageSelector from './LanguageSelector';

interface HeaderActionsProps {
  className?: string;
  showLogin?: boolean;
  showLanguageSelector?: boolean;
  onLanguageChange?: (value: string) => void;
  onLoginClick?: () => void;
}

export default function HeaderActions({ 
  className = '',
  showLogin = true,
  showLanguageSelector = true,
  onLanguageChange,
  onLoginClick
}: HeaderActionsProps) {
  return (
    <div className={`flex items-center space-x-4 ${className}`}>
      {showLogin && (
        <LoginButton onClick={onLoginClick} />
      )}
      {showLanguageSelector && (
        <LanguageSelector onChange={onLanguageChange} />
      )}
    </div>
  );
}
