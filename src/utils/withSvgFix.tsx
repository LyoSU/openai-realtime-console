import React from 'react';
import { IconProps } from 'react-feather';

export function withSvgFix<P extends IconProps>(
  WrappedIcon: React.ComponentType<P>
) {
  return function WithSvgFix(props: P) {
    return (
      <WrappedIcon 
        {...props}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  };
}

/* Приклад використання:
import { Zap, MessageCircle } from 'react-feather';

export const FixedZap = withSvgFix(Zap);
export const FixedMessageCircle = withSvgFix(MessageCircle);
*/
