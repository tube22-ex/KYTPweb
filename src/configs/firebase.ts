import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBhrGsKwYXArwqNMjxr2OKZyIbF4Ty1H4s",
  authDomain: "kayouty-fa1b1.firebaseapp.com",
  databaseURL: "https://kayouty-fa1b1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kayouty-fa1b1",
  storageBucket: "kayouty-fa1b1.firebasestorage.app",
  messagingSenderId: "557869824826",
  appId: "1:557869824826:web:64d795e2e1dd6e94f3ae03",
  measurementId: "G-61E1Q6RJVY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);



