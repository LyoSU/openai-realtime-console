import React from 'react';
import * as FeatherIcons from 'react-feather';

type IconProps = {
  name: keyof typeof FeatherIcons;
  size?: number;
  className?: string;
};

export function Icon({ name, size = 24, className = '' }: IconProps) {
  const IconComponent = FeatherIcons[name];
  
  return (
    <IconComponent 
      size={size}
      className={className}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}
