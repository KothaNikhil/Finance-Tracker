// Screens now import the edit-session UI (via ScreenHeader), which reaches AsyncStorage-backed hooks.
// Jest has no native module, so use the library's in-memory mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// ...and the Drive service, which imports Google Sign-In's native module. Nothing signs in under test.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    hasPreviousSignIn: jest.fn(() => false),
    getCurrentUser: jest.fn(() => null),
    signIn: jest.fn(async () => ({ type: 'cancelled', data: null })),
    signInSilently: jest.fn(async () => ({ type: 'noSavedCredentialFound', data: null })),
    getTokens: jest.fn(async () => ({ accessToken: '', idToken: '' })),
    signOut: jest.fn(async () => null),
    revokeAccess: jest.fn(async () => null),
    addScopes: jest.fn(async () => null),
  },
  statusCodes: {},
  isSuccessResponse: () => false,
  isErrorWithCode: () => false,
  isCancelledResponse: () => true,
  isNoSavedCredentialFoundResponse: () => true,
}));
