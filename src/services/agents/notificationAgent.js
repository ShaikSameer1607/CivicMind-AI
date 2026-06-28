import { db, collection, addDoc, serverTimestamp } from '../firebase.js';

import { AGENT_NAMES, AGENT_STATUS } from './constants.js';

import { clamp } from './utils.js';

import { generateJSON, isGeminiAvailable, finalizeAgentResult } from './aiProvider.js';



async function runHeuristic(context) {

  const start = performance.now();

  const { issue, agentResults } = context;



  const resolution = agentResults[AGENT_NAMES.RESOLUTION]?.data || {};

  const verification = agentResults[AGENT_NAMES.VERIFICATION]?.data || {};

  const department = resolution.responsibleDepartment || resolution.department || issue.department || 'General';



  const notificationsCreated = [];



  const reporterMsg = `Your report ${issue.issueId} was processed. Trust: ${verification.trustScore ?? '—'}/10. Assigned to ${department}.`;

  await addDoc(collection(db, 'notifications'), {

    userId: issue.createdBy,

    role: 'Citizen',

    issueId: issue.issueId,

    type: 'reporter_update',

    message: reporterMsg,

    read: false,

    createdAt: serverTimestamp(),

  });

  notificationsCreated.push({ target: 'Reporter', message: reporterMsg });



  const adminMsg = `New issue ${issue.issueId}: ${issue.title}. Priority ${resolution.priority || 'Medium'}, escalation L${resolution.escalationLevel || resolution.escalation || 1}.`;

  await addDoc(collection(db, 'notifications'), {

    userId: issue.createdBy,

    role: 'Administrator',

    issueId: issue.issueId,

    type: 'admin_alert',

    message: adminMsg,

    read: false,

    createdAt: serverTimestamp(),

  });

  notificationsCreated.push({ target: 'Admin', message: adminMsg });



  const deptMsg = `Department ${department}: issue ${issue.issueId} requires review (${resolution.priority || 'Medium'} priority).`;

  await addDoc(collection(db, 'notifications'), {

    userId: issue.createdBy,

    role: 'Department',

    department,

    issueId: issue.issueId,

    type: 'department_assignment',

    message: deptMsg,

    read: false,

    createdAt: serverTimestamp(),

  });

  notificationsCreated.push({ target: 'Department', message: deptMsg });



  const confidence = clamp(85 + notificationsCreated.length * 3, 80, 99);

  const output = `Created ${notificationsCreated.length} notifications (reporter, admin, department).`;



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.NOTIFICATION,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output,

    data: { notificationsCreated, count: notificationsCreated.length },

  }, { source: 'heuristic', latencyMs: Math.round(performance.now() - start) }, start);

}



async function runWithGemini(context) {

  const start = performance.now();

  const { issue, agentResults } = context;



  const resolution = agentResults[AGENT_NAMES.RESOLUTION]?.data || {};

  const verification = agentResults[AGENT_NAMES.VERIFICATION]?.data || {};

  const vision = agentResults[AGENT_NAMES.VISION]?.data || {};

  const department = resolution.responsibleDepartment || resolution.department || issue.department || 'General';



  const { data, aiMetrics } = await generateJSON({

    agentName: AGENT_NAMES.NOTIFICATION,

    requiredKeys: ['citizenMessage', 'adminMessage', 'departmentMessage'],

    prompt: `Write natural language notification messages for a civic issue platform.



Issue: ${issue.issueId} — ${issue.title}

Category: ${issue.category}

Vision summary: ${vision.summary || issue.description}

Trust score: ${verification.trustScore}/10 (${verification.verificationLevel})

Department: ${department}

Priority: ${resolution.priority}

ETA: ${resolution.eta || resolution.estimatedResolutionHours + 'h'}

Escalation: L${resolution.escalationLevel || resolution.escalation}



Return JSON with three concise, professional messages:

- citizenMessage (for the reporter)

- adminMessage (for administrators)

- departmentMessage (for the assigned department)`,

  });



  const notificationsCreated = [];



  await addDoc(collection(db, 'notifications'), {

    userId: issue.createdBy,

    role: 'Citizen',

    issueId: issue.issueId,

    type: 'reporter_update',

    message: String(data.citizenMessage),

    read: false,

    createdAt: serverTimestamp(),

  });

  notificationsCreated.push({ target: 'Reporter', message: data.citizenMessage });



  await addDoc(collection(db, 'notifications'), {

    userId: issue.createdBy,

    role: 'Administrator',

    issueId: issue.issueId,

    type: 'admin_alert',

    message: String(data.adminMessage),

    read: false,

    createdAt: serverTimestamp(),

  });

  notificationsCreated.push({ target: 'Admin', message: data.adminMessage });



  await addDoc(collection(db, 'notifications'), {

    userId: issue.createdBy,

    role: 'Department',

    department,

    issueId: issue.issueId,

    type: 'department_assignment',

    message: String(data.departmentMessage),

    read: false,

    createdAt: serverTimestamp(),

  });

  notificationsCreated.push({ target: 'Department', message: data.departmentMessage });



  const confidence = clamp(88, 80, 99);

  const output = `Created ${notificationsCreated.length} Gemini-authored notifications.`;



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.NOTIFICATION,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output,

    data: { notificationsCreated, count: notificationsCreated.length },

  }, aiMetrics, start);

}



export async function run(context) {

  if (isGeminiAvailable()) {

    try {

      return await runWithGemini(context);

    } catch (err) {

      console.warn('[Notification Agent] Gemini fallback:', err.message);

    }

  }

  return runHeuristic(context);

}



export { runHeuristic };


