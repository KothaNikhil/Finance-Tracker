module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src', '<rootDir>/../packages/core'],
  // Test files live next to the code they cover, in __tests__ folders.
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // `theme.ts` imports the web font stylesheet; native/Jest treats it as an empty side effect.
  moduleNameMapper: {
    '^@/core/(.*)$': '<rootDir>/../packages/core/src/$1',
    '\\.css$': '<rootDir>/test/style-mock.js',
  },
};
