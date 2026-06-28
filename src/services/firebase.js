import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, onSnapshot, query, where, orderBy, addDoc, serverTimestamp, updateDoc, limit, arrayUnion } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "****",
  authDomain: "civicmindai-e5397.firebaseapp.com",
  projectId: "civicmindai-e5397",
  storageBucket: "civicmindai-e5397.firebasestorage.app",
  messagingSenderId: "726082983379",
  appId: "1:726082983379:web:faeeb686fdf59fb9ff4b26",
  measurementId: "G-4425EZB46V"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence);

// Initialize Firestore
const db = getFirestore(app);

// Auth Providers
const googleProvider = new GoogleAuthProvider();

export { 
  app, 
  auth, 
  db, 
  googleProvider,
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail, 
  signOut, 
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  serverTimestamp, 
  updateDoc,
  limit,
  arrayUnion
};
