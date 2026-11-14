import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
export const firebaseConfig: FirebaseAppletConfig = JSON.parse(
  fs.readFileSync(configPath, 'utf-8')
);

let adminApp: App;

if (getApps().length === 0) {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    try {
      const serviceAccount = JSON.parse(saJson);
      adminApp = initializeApp({
        credential: cert(serviceAccount),
        projectId: firebaseConfig.projectId,
      });
    } catch {
      adminApp = initializeApp({ projectId: firebaseConfig.projectId });
    }
  } else {
    adminApp = initializeApp({ projectId: firebaseConfig.projectId });
  }
} else {
  adminApp = getApps()[0]!;
}

export const adminAuth = getAuth(adminApp);

export interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedUser> {
  const decoded = await adminAuth.verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email || '',
    emailVerified: Boolean(decoded.email_verified),
  };
}

export const PLATFORM_OWNER_EMAIL = 'brokengg.exe@gmail.com';
