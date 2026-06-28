import { db, collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, arrayUnion } from './firebase.js';
import { isFirestoreIndexError } from './ui.js';

const DEPARTMENT_BY_CATEGORY = {
  Infrastructure: 'Public Works',
  Safety: 'Safety & Traffic',
  Environment: 'Environment',
};

function sortIssuesNewestFirst(issues) {
  return [...issues].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() ?? a.createdAt?.seconds * 1000 ?? 0;
    const tb = b.createdAt?.toMillis?.() ?? b.createdAt?.seconds * 1000 ?? 0;
    return tb - ta;
  });
}

export async function submitIssue(issueData) {
  const issueId = issueData.issueId || `ISS-${Date.now()}`;
  const imageUrls = issueData.imageUrls || [];
  const primaryImage = imageUrls[0] || issueData.imageUrl || null;

  const newIssue = {
    issueId,
    title: issueData.title,
    description: issueData.description,
    category: issueData.category,
    location: issueData.location || '',
    severity: issueData.severity || 'medium',
    reporterName: issueData.reporterName ?? null,
    reporterEmail: issueData.reporterEmail ?? null,
    // Core GPS coordinates
    latitude: issueData.latitude ?? null,
    longitude: issueData.longitude ?? null,
    // Extended geolocation fields
    locationAccuracy: issueData.locationAccuracy ?? null,
    altitude: issueData.altitude ?? null,
    heading: issueData.heading ?? null,
    speed: issueData.speed ?? null,
    locationCapturedAt: issueData.locationCapturedAt ?? null,
    // Reverse geocoded address
    locationAddress: issueData.locationAddress ?? null,
    formattedAddress: issueData.formattedAddress ?? null,
    city: issueData.city ?? null,
    state: issueData.state ?? null,
    country: issueData.country ?? null,
    postalCode: issueData.postalCode ?? null,
    // Structured coordinates object
    coordinates: {
      latitude: issueData.latitude ?? null,
      longitude: issueData.longitude ?? null,
    },
    // Media & metadata
    imageUrl: primaryImage,
    imageUrls,
    videoUrls: issueData.videoUrls || [],
    audioUrls: issueData.audioUrls || [],
    status: 'Open',
    department: issueData.department || DEPARTMENT_BY_CATEGORY[issueData.category] || 'General',
    trustScore: issueData.trustScore ?? 5.0,
    escalationLevel: 1,
    createdBy: issueData.uid,
    activityHistory: [{
      action: 'submitted',
      by: issueData.uid,
      byRole: 'Citizen',
      note: 'Issue submitted to registry',
      timestamp: new Date().toISOString(),
    }],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, 'issues'), newIssue);
  return { docId: docRef.id, issueId };
}

export async function updateIssue(docId, updates) {
  const issueRef = doc(db, 'issues', docId);
  await updateDoc(issueRef, { ...updates, updatedAt: serverTimestamp() });
}

export async function updateIssueStatus(docId, newStatus, actorUid = null, actorRole = 'Administrator') {
  await appendIssueActivity(docId, {
    action: 'status_change',
    by: actorUid,
    byRole: actorRole,
    note: `Status changed to ${newStatus}`,
    status: newStatus,
  });
  return updateIssue(docId, { status: newStatus });
}

export async function assignIssueDepartment(docId, department, actorUid = null, actorRole = 'Administrator') {
  await appendIssueActivity(docId, {
    action: 'department_assigned',
    by: actorUid,
    byRole: actorRole,
    note: `Assigned to ${department}`,
    department,
  });
  return updateIssue(docId, { department });
}

export async function escalateIssue(docId, escalationLevel, actorUid = null, note = '') {
  await appendIssueActivity(docId, {
    action: 'escalation',
    by: actorUid,
    byRole: 'Administrator',
    note: note || `Escalated to level ${escalationLevel}`,
    escalationLevel,
  });
  return updateIssue(docId, { escalationLevel });
}

export async function appendIssueActivity(docId, entry) {
  const issueRef = doc(db, 'issues', docId);
  await updateDoc(issueRef, {
    activityHistory: arrayUnion({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    }),
    updatedAt: serverTimestamp(),
  });
}

export async function updateIssueMedia(docId, { imageUrls, videoUrls, audioUrls }) {
  const updates = {};
  if (imageUrls?.length) {
    updates.imageUrls = imageUrls;
    updates.imageUrl = imageUrls[0];
  }
  if (videoUrls?.length) updates.videoUrls = videoUrls;
  if (audioUrls?.length) updates.audioUrls = audioUrls;
  if (Object.keys(updates).length) await updateIssue(docId, updates);
}

export function useRealtimeIssues(callback, statusFilter = null) {
  let q = collection(db, 'issues');

  if (statusFilter) {
    q = query(q, where('status', '==', statusFilter));
  }

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const issues = sortIssuesNewestFirst(
      snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    );
    callback(issues, null);
  }, (err) => {
    callback([], isFirestoreIndexError(err)
      ? new Error('Firestore index required. See DEPLOYMENT.md.')
      : err);
  });

  return unsubscribe;
}

export function useUserIssues(uid, callback) {
  if (!uid) {
    callback([], null);
    return () => {};
  }

  const q = query(collection(db, 'issues'), where('createdBy', '==', uid));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const issues = sortIssuesNewestFirst(
      snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    );
    callback(issues, null);
  }, (err) => {
    callback([], isFirestoreIndexError(err)
      ? new Error('Firestore index required. See DEPLOYMENT.md.')
      : err);
  });

  return unsubscribe;
}

export { DEPARTMENT_BY_CATEGORY, sortIssuesNewestFirst };
