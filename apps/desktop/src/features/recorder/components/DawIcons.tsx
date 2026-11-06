import type { SVGProps } from "react";

/**
 * Smart Controls icon matching GarageBand's header button (Image 3):
 * an analog dial with tick notches around it and a central indicator.
 */
export function SmartControlsIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Outer ticks / notches */}
      <circle cx="12" cy="12" r="5" strokeWidth={1.8} />
      <line x1="12" y1="2" x2="12" y2="4" strokeWidth={1.8} />
      <line x1="12" y1="20" x2="12" y2="22" strokeWidth={1.8} />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" strokeWidth={1.8} />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" strokeWidth={1.8} />
      <line x1="2" y1="12" x2="4" y2="12" strokeWidth={1.8} />
      <line x1="20" y1="12" x2="22" y2="12" strokeWidth={1.8} />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" strokeWidth={1.8} />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" strokeWidth={1.8} />
      {/* Center notch / pointer */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <line x1="12" y1="12" x2="14.5" y2="9.5" strokeWidth={1.8} />
    </svg>
  );
}

/**
 * Input monitoring: a loudspeaker with sound leaving to the right.
 * A speaker reads as "hear this input". Stacked arcs over a dot read as a wifi mark.
 */
export function InputMonitoringIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="M2.5 7.25h2.4L8.75 4.25v11.5L4.9 12.75H2.5a.9.9 0 0 1-.9-.9v-3.7a.9.9 0 0 1 .9-.9z" fill="currentColor" stroke="none" />
      <path d="M11.4 7.4c1.15 1.05 1.15 4.15 0 5.2" />
      <path d="M13.7 5.5c2.05 1.9 2.05 7.1 0 9" />
    </svg>
  );
}
