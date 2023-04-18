import { createClassName, type ClassName } from '@/lib/utils/element';

import baseStyles from '../styles.module.css';
import styles from './styles.module.css';

export function CameraIcon({ className }: { className?: ClassName }) {
  return (
    <svg className={createClassName(baseStyles.svg, styles.svg, className)} viewBox="0 0 701 451">
      <path d="M38 38h375v375H38zM438 163 663 38v375L438 288" />
    </svg>
  );
}
