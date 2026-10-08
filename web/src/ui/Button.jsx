import { cx } from '../lib/cx.js';

export function Spinner({ size = 16, className }) {
  return (
    <svg className={cx('animate-spin', className)} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const VARIANTS = {
  primary: 'bg-gray-1000 text-background-100 border-gray-1000 hover:opacity-85',
  secondary: 'bg-background-100 text-gray-1000 border-gray-400 hover:bg-gray-100 hover:border-gray-500 active:bg-gray-200',
  tertiary: 'bg-transparent text-gray-1000 border-transparent hover:bg-gray-alpha-200 active:bg-gray-alpha-300',
  error: 'bg-red text-background-100 border-red hover:opacity-85',
};

const SIZES = {
  sm: 'h-8 px-3 gap-1.5 copy-13 max-md:min-h-11',
  md: 'h-10 px-4 gap-2 copy-14 max-md:min-h-11',
  lg: 'h-12 px-5 gap-2 text-[16px] leading-6',
};

const BASE =
  'relative inline-flex shrink-0 items-center justify-center rounded-sm border font-medium whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,opacity,transform] duration-[120ms] ease-standard active:scale-[0.98] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 aria-disabled:opacity-50';

// `as` lets a router Link or anchor take the button's appearance.
export function Button({
  as: Tag = 'button',
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  trailingIcon: Trailing,
  loading = false,
  disabled,
  className,
  children,
  ...props
}) {
  const isButton = Tag === 'button';
  return (
    <Tag
      {...(isButton ? { type: 'button', disabled: disabled || loading } : {})}
      aria-busy={loading || undefined}
      className={cx(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {/* The label keeps its space while loading, so the width never jumps. */}
      <span className={cx('inline-flex items-center', SIZES[size].includes('gap-1.5') ? 'gap-1.5' : 'gap-2', loading && 'invisible')}>
        {Icon && <Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
        {children}
        {Trailing && <Trailing size={16} strokeWidth={1.5} aria-hidden="true" />}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner />
        </span>
      )}
    </Tag>
  );
}

// Square icon-only button. `label` is required: it is the accessible name.
export function IconButton({ icon: Icon, label, size = 'sm', variant = 'tertiary', className, ...props }) {
  const box = size === 'sm' ? 'h-8 w-8 max-md:h-11 max-md:w-11' : 'h-10 w-10 max-md:h-11 max-md:w-11';
  return (
    <button
      type="button"
      aria-label={label}
      className={cx(BASE, VARIANTS[variant], box, 'px-0 text-gray-900 hover:text-gray-1000', className)}
      {...props}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
