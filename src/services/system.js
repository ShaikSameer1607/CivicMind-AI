import { db, collection, onSnapshot, query, addDoc, serverTimestamp, limit, where, updateDoc, doc } from './firebase.js';
import { isFirestoreIndexError } from './ui.js';

function sortLogsNewestFirst(logs) {
  return [...logs].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() ?? a.createdAt?.seconds * 1000 ?? a.timestamp?.toMillis?.() ?? a.timestamp?.seconds * 1000 ?? 0;
    const tb = b.createdAt?.toMillis?.() ?? b.createdAt?.seconds * 1000 ?? b.timestamp?.toMillis?.() ?? b.timestamp?.seconds * 1000 ?? 0;
    return tb - ta;
  });
}

function normalizeFirestoreError(err) {
  if (isFirestoreIndexError(err)) {
    return new Error(
      'Firestore index required. Create it in Firebase Console (link in browser devtools) or see DEPLOYMENT.md.'
    );
  }
  return err;
}

export function useAgentLogs(callback, maxLimit = 50) {
  const q = query(collection(db, 'agent_logs'), limit(maxLimit));

  return onSnapshot(q, (snapshot) => {
    const logs = sortLogsNewestFirst(
      snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    );
    callback(logs, null);
  }, (err) => {
    callback([], normalizeFirestoreError(err));
  });
}

export async function createAgentLog(issueId, agentName, status, confidence, output, executionTime = null, structuredOutput = null, aiData = null) {
  const newLog = {
    issueId,
    agentName,
    status,
    confidence,
    output: typeof output === 'string' ? output : JSON.stringify(output),
    executionTime: executionTime ?? null,
    structuredOutput: structuredOutput ?? null,
    timestamp: serverTimestamp(),
  };

  if (aiData) {
    if (aiData.provider) newLog.provider = aiData.provider;
    if (aiData.model) newLog.model = aiData.model;
    if (aiData.latency !== undefined) newLog.latency = aiData.latency;
    if (aiData.tokenUsage) newLog.tokenUsage = aiData.tokenUsage;
    if (aiData.providerSwitch) newLog.providerSwitch = aiData.providerSwitch;
    if (aiData.fallbackReason) newLog.fallbackReason = aiData.fallbackReason;
  }

  await addDoc(collection(db, 'agent_logs'), newLog);
}

export async function createNotification({ userId, role = 'Citizen', issueId, type, message, department = null }) {
  const payload = {
    userId,
    role,
    issueId: issueId || null,
    type,
    message,
    read: false,
    createdAt: serverTimestamp(),
  };
  if (department) payload.department = department;
  await addDoc(collection(db, 'notifications'), payload);
}

export async function markNotificationRead(notificationId) {
  await updateDoc(doc(db, 'notifications', notificationId), { read: true });
}

export async function markAllNotificationsRead(notifications) {
  const unread = notifications.filter(n => !n.read);
  await Promise.all(unread.map(n => markNotificationRead(n.id)));
}

/** Notifications scoped to the signed-in user's userId only */
export function useNotifications(uid, callback) {
  if (!uid) {
    callback([], null);
    return () => {};
  }

  const q = query(collection(db, 'notifications'), where('userId', '==', uid), limit(30));

  return onSnapshot(q, (snapshot) => {
    callback(
      sortLogsNewestFirst(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
      null
    );
  }, (err) => {
    callback([], normalizeFirestoreError(err));
  });
}

export { sortLogsNewestFirst };
