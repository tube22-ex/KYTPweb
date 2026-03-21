import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const fs = getFirestore(app);




// import { doc, getDoc } from "firebase/firestore";

// const snap = await getDoc(doc(fs, 'mapCache', '593'));
// const data = snap.data() as any;

// const sets = data.displaySets;
// console.log('総セット数:', sets.length);
// sets.slice(-5).forEach((set: any, i: number) => {
//   const idx = sets.length - 5 + i;
//   console.log(`SET ${idx + 1} (${set.timeMs}ms):`);
//   set.lines.forEach((line: any) => {
//     console.log(`  absLineIdx=${line.absLineIdx} timeMs=${line.timeMs}`, line.chunks.map((c: any) => c.text).join('|'));
//   });
// });

// console.log('\n全部 (lines):');
// data.lines.forEach((l: any) => {
//   console.log(`  absLineIdx=${l.absLineIdx} timeMs=${l.timeMs} isEnd=${l.isEnd} lyrics=${l.lyrics}`);
// });