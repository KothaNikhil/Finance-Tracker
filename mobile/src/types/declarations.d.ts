// Ambient declarations for non-code imports (CSS, images) so `tsc` is happy.
//
// Expo normally provides these through `expo/types`, but this project pins
// `compilerOptions.types` (to make Jest's globals resolve under TS 6), which turns off
// TypeScript's automatic inclusion of those ambient types. So we declare them here.

declare module '*.css';
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.webp';
declare module '*.svg';
