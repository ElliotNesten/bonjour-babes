import type { FirebaseOptions } from 'firebase/app';

/**
 * 🔧 FIREBASE-KONFIGURATION
 *
 * Klistra in konfigurationen från Firebase Console:
 *   Projektinställningar (kugghjulet) → Allmänt → "Dina appar" → Webbapp → "SDK setup and configuration" → Config
 *
 * Exempel:
 *   export const firebaseConfig: FirebaseOptions | null = {
 *     apiKey: 'AIza…',
 *     authDomain: 'bonjour-babes.firebaseapp.com',
 *     databaseURL: 'https://bonjour-babes-default-rtdb.europe-west1.firebasedatabase.app',
 *     projectId: 'bonjour-babes',
 *     appId: '1:123:web:abc',
 *   };
 *
 * Värdena är inte hemliga – de identifierar bara projektet. Säkerheten sköts av
 * reglerna i database.rules.json.
 *
 * Så länge värdet är null körs sidan i DEMOLÄGE: allt sparas bara i den här
 * webbläsaren (bra för att prova, men alla mobiler ser inte samma spel).
 */
export const firebaseConfig: FirebaseOptions | null = null;
