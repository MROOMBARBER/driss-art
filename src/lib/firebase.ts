import { initializeApp, getApps } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

const requiredConfiguration = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const configuration = {
  ...requiredConfiguration,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};
const emulatorRequested = import.meta.env.DEV
  && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
const safeEmulatorProject = typeof configuration.projectId === 'string'
  && configuration.projectId.startsWith('demo-');

// Public Firebase web configuration identifies the project. Database rules and
// authentication enforce access; an absent project leaves the public site usable.
export const firebaseConfigured = Object.values(requiredConfiguration).every(
  (value) => typeof value === 'string' && value.trim().length > 0,
) && (!emulatorRequested || safeEmulatorProject);

let configuredAuth: Auth | null = null;
let configuredDb: Firestore | null = null;

if (firebaseConfigured) {
  const app = getApps()[0] ?? initializeApp(configuration);
  configuredAuth = getAuth(app);
  configuredDb = getFirestore(app);

  // Never point a production build at development emulators.
  if (emulatorRequested && safeEmulatorProject) {
    connectAuthEmulator(configuredAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(configuredDb, '127.0.0.1', 8080);
  }
}

export const auth: Auth | null = configuredAuth;
export const db: Firestore | null = configuredDb;
