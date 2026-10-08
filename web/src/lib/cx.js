// Joins class names, skipping falsy values.
export const cx = (...parts) => parts.filter(Boolean).join(' ');
