/**
 * Biometric / device-PIN app lock (Step 1). Pure wrappers over expo-local-authentication — no
 * secrets stored; this is a local "prove it's you" gate each time the app is opened.
 */

import * as LocalAuthentication from 'expo-local-authentication';

/** True if the device has biometric hardware AND the user has enrolled something (or a PIN). */
export async function canUseAppLock(): Promise<boolean> {
  const [hasHardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && enrolled;
}

/** Prompt for biometrics (falling back to the device PIN). Resolves true when the user passes. */
export async function authenticate(): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock Finance Tracker',
    fallbackLabel: 'Use device PIN',
  });
  return res.success;
}
