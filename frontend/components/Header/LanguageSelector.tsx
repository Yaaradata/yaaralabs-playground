interface LanguageOption {
  value: string;
  label: string;
}

interface LanguageSelectorProps {
  className?: string;
  options?: LanguageOption[];
  defaultValue?: string;
  onChange?: (value: string) => void;
}

const defaultOptions: LanguageOption[] = [
  { value: 'en', label: 'EN' },
  { value: 'es', label: 'ES' },
  { value: 'fr', label: 'FR' }
];

export default function LanguageSelector({ 
  className = '', 
  options = defaultOptions,
  defaultValue = 'en',
  onChange
}: LanguageSelectorProps) {
  return (
    <select 
      className={`bg-transparent text-fg border border-magenta-brand/40 rounded px-2 py-1 text-sm focus:outline-none focus:border-pink-brand ${className}`}
      defaultValue={defaultValue}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {options.map((option) => (
        <option 
          key={option.value} 
          value={option.value} 
          className="bg-canvas text-fg"
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}
