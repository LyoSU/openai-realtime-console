import { withSvgFix } from '../../utils/withSvgFix';
import { 
  Zap, 
  MessageCircle,
  Play,
  Pause,
  // інші іконки які ви використовуєте
} from 'react-feather';

export const FixedZap = withSvgFix(Zap);
export const FixedMessageCircle = withSvgFix(MessageCircle);
export const FixedPlay = withSvgFix(Play);
export const FixedPause = withSvgFix(Pause);
// і т.д.
