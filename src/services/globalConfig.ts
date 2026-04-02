import { fs } from '../configs/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export interface GlobalRebuildRules {
  protectedWords: string;
  separatedWords: string;
}

const GLOBAL_RULES_DOC = 'globalSettings/rebuildRules';

export async function getGlobalRebuildRules(): Promise<GlobalRebuildRules | null> {
  try {
    const snap = await getDoc(doc(fs, GLOBAL_RULES_DOC));
    if (snap.exists()) {
      return snap.data() as GlobalRebuildRules;
    }
  } catch (err) {
    console.error('Failed to fetch global rebuild rules:', err);
  }
  return null;
}

export async function saveGlobalRebuildRules(rules: GlobalRebuildRules): Promise<void> {
  try {
    await setDoc(doc(fs, GLOBAL_RULES_DOC), rules);
  } catch (err) {
    console.error('Failed to save global rebuild rules:', err);
    throw err;
  }
}
