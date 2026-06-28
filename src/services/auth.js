import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail, 
  signOut,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp
} from './firebase.js';

let currentUser = null;
let profileData = null;
const authListeners = new Set();

// Internal updates broadcaster
function notifyListeners() {
  authListeners.forEach(listener => listener(currentUser, profileData));
}

// Fetch Profile from Firestore
async function fetchUserProfile(uid) {
  // Guard against missing UID (e.g., unauthenticated state)
  if (!uid) {
    return null;
  }
  try {
    const userDoc = await getDoc(doc(db, 'users', uid));
    if (userDoc.exists()) {
      return userDoc.data();
    }
  } catch (error) {
    // Suppress permission errors for unauthenticated fetch
    console.error("Error fetching profile:", error);
    return null;
  }
  return null;
}


// Listen to Global Auth Changes
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    profileData = await fetchUserProfile(user.uid);
  } else {
    profileData = null;
  }
  notifyListeners();
});

// useAuth Hook Alternative for Vanilla JS
export function useAuth(callback) {
  // immediately call with current state
  callback(currentUser, profileData);
  // add listener
  authListeners.add(callback);
  // return an unsubscribe function
  return () => authListeners.delete(callback);
}

// --- Auth Operations ---

export async function loginWithEmail(email, password, rememberMe = true) {
  // BrowserLocalPersistence is default. If rememberMe is false, we could use browserSessionPersistence, 
  // but to keep it simple, we just log in.
  const userCred = await signInWithEmailAndPassword(auth, email, password);
  return userCred.user;
}

export async function loginWithGoogle() {
  const userCred = await signInWithPopup(auth, googleProvider);
  const user = userCred.user;
  
  // Check if user exists in Firestore
  const profile = await fetchUserProfile(user.uid);
  
  // If no profile exists (first time Google sign in), create one
  if (!profile) {
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      name: user.displayName || "Google User",
      email: user.email,
      role: 'Citizen', // Default to Citizen
      citizenScore: 100, // Initial Score
      badges: ['pioneer'],
      createdAt: serverTimestamp()
    });
  }
  return user;
}

export async function registerUser({ name, email, password, role }) {
  const userCred = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCred.user;

  // Enforce schema
  const newProfile = {
    uid: user.uid,
    name: name,
    email: email,
    role: role || 'Citizen',
    citizenScore: (role === 'Administrator') ? 1000 : 100,
    badges: [],
    createdAt: serverTimestamp()
  };

  await setDoc(doc(db, 'users', user.uid), newProfile);
  return user;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logOut() {
  await signOut(auth);
}

export function getCurrentUser() {
  return currentUser;
}
export function getProfileData() {
  return profileData;
}

export async function updateCitizenScore(uid, newScore) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { citizenScore: newScore });
}
