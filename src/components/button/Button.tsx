import React from 'react';
import './Button.scss';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon';
  size?: 'small' | 'medium' | 'large';
  children: React.ReactNode;
}

export function Button({ 
  variant = 'primary',
  size = 'medium',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`
        inline-flex items-center justify-center gap-2 rounded-lg
        ${variant === 'primary' ? 'bg-indigo-500 hover:bg-indigo-600 text-white' : ''}
        ${variant === 'secondary' ? 'bg-gray-200 hover:bg-gray-300 text-gray-800' : ''}
        ${variant === 'icon' ? 'bg-transparent hover:bg-gray-100 text-gray-600' : ''}
        ${size === 'small' ? 'px-3 py-1.5 text-sm' : ''}
        ${size === 'medium' ? 'px-4 py-2' : ''}
        ${size === 'large' ? 'px-6 py-3 text-lg' : ''}
        transition-colors
        ${props.className || ''}
      `}
    >
      {children}
    </button>
  );
}
