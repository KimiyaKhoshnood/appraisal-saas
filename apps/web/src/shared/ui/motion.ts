import type { Transition, Variants } from 'motion/react';

/** One motion vocabulary for the whole product: quick, soft, never in the way. */
export const spring: Transition = { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 };
export const ease: Transition = { duration: 0.28, ease: [0.22, 1, 0.36, 1] };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: ease },
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 6 },
  show: { opacity: 1, scale: 1, y: 0, transition: spring },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: { duration: 0.15 } },
};
