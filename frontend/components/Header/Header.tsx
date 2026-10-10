'use client';

import { useState, type ReactNode } from 'react';
import Logo from './Logo';
import Navigation from './Navigation';
import MobileMenuButton from './MobileMenuButton';
import MobileMenu from './MobileMenu';
import ThemeToggle from './ThemeToggle';

interface HeaderProps {
  className?: string;
  logoSize?: 'sm' | 'md' | 'lg';
  navigationLinks?: string[];
  showMobileMenu?: boolean;
  fixed?: boolean;
  transparent?: boolean;
  theme?: 'dark' | 'light';
  showAboutLink?: boolean;
  /** Optional content rendered to the left of the brand (same row). */
  leading?: ReactNode;
  /** Optional content rendered at the far right of the bar. */
  trailing?: ReactNode;
  /** 'yaara' shows a link to yaaralabs.ai on the right; others show nothing extra. */
  rightBrand?: 'yaara' | 'neural' | 'none';
  /** Where to place the YaaraLabs Playground logo. Default left. */
  brandPosition?: 'left' | 'right';
  /** Shorter bar, less padding — used by Rule Based Process. */
  dense?: boolean;
}

export default function Header({
  className = '',
  logoSize = 'md',
  showMobileMenu = true,
  fixed = true,
  transparent = false,
  theme = 'dark',
  showAboutLink = false,
  leading,
  trailing,
  rightBrand = 'yaara',
  brandPosition = 'left',
  dense = false,
}: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navLinks = showAboutLink ? ['About'] : [];

  const headerClasses = `
    ${fixed ? 'fixed top-0' : 'relative'} 
    w-full z-50 
    ${transparent ? 'bg-transparent' : className.includes('bg-white') ? className : 'bg-canvas'} 
    ${className.includes('border-gray-200') ? className.includes('border-b') ? '' : 'border-b border-gray-200' : 'border-b border-fg/10'} 
    backdrop-blur-sm
    ${className}
  `.trim();


  const brandLogo = <Logo size={logoSize} theme={theme} />;

  return (
    <header className={headerClasses} suppressHydrationWarning>
      <nav className={dense ? 'px-3' : 'px-4 sm:px-6 lg:px-8'}>
        <div
          className={`flex items-center justify-between ${dense ? 'h-11' : 'h-16'}`}
        >
          {/* Left: optional leading (+ brand when left-aligned) */}
          <div className={`flex items-center flex-shrink-0 min-w-0 ${dense ? 'gap-2' : 'gap-4'}`}>
            {leading}
            {brandPosition === 'left' ? brandLogo : null}
          </div>
          
          {/* Center: only when there are links — empty flex-1 creates a large dead spacer */}
          {navLinks.length > 0 ? (
            <div className="hidden md:block flex-1 flex justify-center">
              <Navigation links={navLinks} theme={theme} />
            </div>
          ) : null}
          
          {/* Right: brand (when right-aligned) or a link back to yaaralabs.ai */}
          <div className={`flex items-center flex-shrink-0 ${dense ? 'gap-1.5' : 'gap-2'}`}>
            {brandPosition === 'right' ? brandLogo : null}
            {brandPosition === 'left' && rightBrand === 'yaara' && (
              <a
                href="https://www.yaaralabs.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:inline-flex items-center gap-1 text-sm font-medium text-fg/70 hover:text-pink-brand transition-colors mr-2"
              >
                yaaralabs.ai <span aria-hidden>↗</span>
              </a>
            )}
            <ThemeToggle />
            {trailing}
          </div>
          
          {/* Mobile menu button */}
          {showMobileMenu && (
            <div className="md:hidden">
              <MobileMenuButton
                isOpen={mobileMenuOpen}
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              />
            </div>
          )}
        </div>

        {/* Mobile menu */}
        {showMobileMenu && (
          <MobileMenu
            isOpen={mobileMenuOpen}
            links={navLinks}
          />
        )}
      </nav>
    </header>
  );
}
