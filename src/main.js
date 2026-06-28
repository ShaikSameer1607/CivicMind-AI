import './style.css';
import { useAuth, loginWithEmail, loginWithGoogle, registerUser, logOut, resetPassword, updateCitizenScore } from './services/auth.js';
import { useRealtimeIssues, useUserIssues, submitIssue, updateIssue, assignIssueDepartment, updateIssueStatus, escalateIssue, updateIssueMedia, appendIssueActivity, DEPARTMENT_BY_CATEGORY } from './services/issues.js';
import { useAgentLogs, createAgentLog, useNotifications, createNotification, markNotificationRead, markAllNotificationsRead } from './services/system.js';
import { resolveReportMedia, isStorageEnabled, getStorageInfoMessage } from './services/storage.js';
import { showSuccess, showError, showWarning, showInfo, handleAppError } from './services/ui.js';
import { refreshDashboardMap, MAP_FILTERS_DEFAULT, renderMediaGallery, getIssueMediaUrls, mapZoomIn, mapZoomOut, initReportMap, destroyReportMap } from './services/mapController.js';
import { runIssueAgentPipeline, AGENT_NAMES, PIPELINE_ORDER } from './services/agents/index.js';
import { askCopilot } from './services/copilot.js';
import { captureFullLocation, EMPTY_LOCATION, reverseGeocode } from './services/geolocation.js';

// ============================================================
// CivicMind AI — Main Application
// Client-side SPA with hash routing & Firebase Backend
// ============================================================

// --- Startup Diagnostics (Development Only) ---
if (import.meta.env.DEV) {
  console.log('--- CivicMind AI Environment Diagnostics ---');
  const varsToCheck = [
    'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID',
    'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_GEMINI_API_KEY', 'VITE_GROQ_API_KEY',
    'VITE_DEFAULT_AI_PROVIDER'
  ];
  varsToCheck.forEach(v => {
    console.log(`[ENV] ${v}: ${import.meta.env[v] ? '✅ Present' : '❌ Missing'}`);
  });
  console.log('--------------------------------------------');
}


const app = document.getElementById('app');

// Global State
let currentUser = null;
let currentProfile = null;
let globalIssues = [];
let globalUserIssues = [];
let globalAgentLogs = [];
let globalNotifications = [];
let copilotMessages = [];
let pendingReportMedia = { images: [], video: null, audio: null };
let capturedLocation = { ...EMPTY_LOCATION };
let mapFilters = { ...MAP_FILTERS_DEFAULT };
let dataLoading = { issues: true, logs: true, notifications: true };
let firestoreError = null;
let notificationPanelOpen = false;
let commandPaletteOpen = false;
let commandPaletteQuery = '';
let rerenderTimer = null;
let currentReportUploadTab = 'images';

const DEPARTMENTS = ['Public Works', 'Safety & Traffic', 'Waste Management', 'Environment', 'General'];

const BADGE_CATALOG = {
  pioneer: { icon: '🏅', name: 'Pioneer' },
  road_guardian: { icon: '🛡️', name: 'Road Guardian' },
  civic_hero: { icon: '🏅', name: 'Civic Hero' },
  eco_champion: { icon: '🌱', name: 'Eco Champion' },
};

const AGENT_META = {
  [AGENT_NAMES.VISION]: { role: 'Image & Text Analysis', icon: '🔍' },
  [AGENT_NAMES.GEO]: { role: 'Location & Hotspot Analysis', icon: '🌍' },
  [AGENT_NAMES.DUPLICATE]: { role: 'Similarity Detection', icon: '📋' },
  [AGENT_NAMES.VERIFICATION]: { role: 'Community Trust', icon: '✅' },
  [AGENT_NAMES.PREDICTION]: { role: 'Infrastructure Forecasting', icon: '📊' },
  [AGENT_NAMES.RESOLUTION]: { role: 'Routing & Escalation', icon: '💡' },
  [AGENT_NAMES.NOTIFICATION]: { role: 'Alert Dispatch', icon: '🔔' },
  Input: { role: 'Report Intake', icon: '📥' },
  Output: { role: 'Legacy Dispatch', icon: '📤' },
  'Geo Intel': { role: 'Location Analysis', icon: '🌍' },
  Verify: { role: 'Community Consensus', icon: '✅' },
  Predict: { role: 'Trend Forecasting', icon: '📊' },
  Vision: { role: 'Image Classification', icon: '🔍' },
};

// ---------- Router Definition ----------
const routes = {
  '': renderLanding,
  'login': renderLogin,
  'signup': renderSignup,
  'forgot-password': renderForgotPassword,
  'dashboard': renderDashboard,
  'report': renderReport,
  'intelligence': renderIntelligence,
  'agents': renderAgents,
  'admin': renderAdmin,
};

// Guarded routes that require authentication
const protectedRoutes = ['dashboard', 'report', 'intelligence', 'agents', 'admin'];
const adminRoutes = ['admin', 'agents'];



function navigate(path) {
  window.location.hash = path;
}

function getRoute() {
  return window.location.hash.replace('#/', '').replace('#', '');
}

function handleRoute() {
  const route = getRoute();
  
  // Route Guards
  if (protectedRoutes.includes(route) && !currentUser) {
    return navigate('login');
  }
  if (adminRoutes.includes(route) && currentProfile?.role !== 'Administrator') {
    return navigate('dashboard');
  }
  if ((route === 'login' || route === 'signup') && currentUser) {
    return navigate('dashboard');
  }

  const render = routes[route] || renderLanding;
  destroyReportMap();
  render();
}

function maybeRerender(route) {
  const r = route || getRoute();
  if (!['dashboard', 'admin', 'intelligence', 'report', 'agents'].includes(r)) return;
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    if (getRoute() === r) handleRoute();
  }, 120);
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', handleRoute);

window.navigate = navigate;

// ---------- Shared Functions & Handlers ----------
window.handleLogout = async () => {
  window._userIssuesUnsub?.();
  window._notificationsUnsub?.();
  window._issuesUnsub?.();
  window._agentLogsUnsub?.();
  await logOut();
  navigate('login');
};

window.handleGoogleLogin = async () => {
  try {
    const errorEl = document.getElementById('auth-error');
    if(errorEl) errorEl.style.display = 'none';
    await loginWithGoogle();
    navigate('dashboard');
  } catch (err) {
    const errorEl = document.getElementById('auth-error');
    if(errorEl) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    }
  }
};

// ---------- Icons (SVG Inline) ----------
const icons = {
  dashboard: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  report: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  intelligence: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27,6.96 12,12.01 20.73,6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  agents: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
  admin: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  bell: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>`,
  sparkle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>`,
  upload: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  camera: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  video: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23,7 16,12 23,17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  mic: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>`,
  eye: `👁️`, vision: `🔍`, geo: `🌍`, duplicate: `📋`, verify: `✅`, predict: `📊`, resolve: `💡`,
  arrowUp: `↑`, arrowDown: `↓`, check: `✓`, chevron: `›`,
};

// ---------- Shared Components ----------
function sidebar(activeRoute) {
  const isAdmin = currentProfile?.role === 'Administrator';
  return isAdmin ? govSidebar(activeRoute) : citizenSidebar(activeRoute);
}

function citizenSidebar(activeRoute) {
  const repPct = reputationPercent(currentProfile?.citizenScore ?? 0, 500);
  return `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-icon">C</div>
        <div class="sidebar-logo-text">Civic<span>Mind</span> AI</div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">My City</div>
        <nav class="sidebar-nav">
          <a class="sidebar-link ${activeRoute === 'dashboard' ? 'active' : ''}" onclick="navigate('dashboard')">
            <span class="icon">${icons.dashboard}</span> Dashboard
          </a>
          <a class="sidebar-link ${activeRoute === 'report' ? 'active' : ''}" onclick="navigate('report')">
            <span class="icon">${icons.report}</span> Report Issue
          </a>
          <a class="sidebar-link ${activeRoute === 'intelligence' ? 'active' : ''}" onclick="navigate('intelligence')">
            <span class="icon">🏘️</span> Community
          </a>
        </nav>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Tools</div>
        <nav class="sidebar-nav">
          <a class="sidebar-link" onclick="navigate('intelligence')">
            <span class="icon">${icons.sparkle}</span> AI Assistant
          </a>
          <a class="sidebar-link" onclick="toggleNotificationPanel()">
            <span class="icon">${icons.bell}</span> Notifications ${unreadNotificationCount() ? `<span class="sidebar-badge">${unreadNotificationCount()}</span>` : ''}
          </a>
        </nav>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Account</div>
        <nav class="sidebar-nav">
          <a class="sidebar-link" onclick="handleLogout()"><span class="icon">🚪</span> Sign Out</a>
        </nav>
      </div>
      <div class="sidebar-reputation glass-card">
        <div class="label-sm" style="color:var(--text-dim);margin-bottom:var(--space-2)">Civic Reputation</div>
        <div class="sidebar-reputation-value">${currentProfile?.citizenScore ?? 0} <span>pts</span></div>
        <div class="progress-bar" style="margin-top:var(--space-2)">
          <div class="progress-bar-fill" style="width:${repPct}%;background:linear-gradient(90deg,var(--primary),var(--secondary))"></div>
        </div>
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-avatar">${currentProfile?.name?.charAt(0) || 'U'}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${currentProfile?.name || 'User'}</div>
            <div class="sidebar-user-role">Civic Hero</div>
          </div>
        </div>
      </div>
    </aside>`;
}

function govSidebar(activeRoute) {
  return `
    <aside class="sidebar sidebar-gov" id="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-icon sidebar-logo-icon-gov">G</div>
        <div class="sidebar-logo-text">Civic<span>Mind</span> Gov</div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Operations</div>
        <nav class="sidebar-nav">
          <a class="sidebar-link ${activeRoute === 'dashboard' ? 'active' : ''}" onclick="navigate('dashboard')">
            <span class="icon">${icons.dashboard}</span> Dashboard
          </a>
          <a class="sidebar-link ${activeRoute === 'admin' ? 'active' : ''}" onclick="navigate('admin')">
            <span class="icon">${icons.admin}</span> Issue Management
          </a>
          <a class="sidebar-link ${activeRoute === 'agents' ? 'active' : ''}" onclick="navigate('agents')">
            <span class="icon">${icons.agents}</span> Agent Command
          </a>
        </nav>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Analytics</div>
        <nav class="sidebar-nav">
          <a class="sidebar-link ${activeRoute === 'intelligence' ? 'active' : ''}" onclick="navigate('intelligence')">
            <span class="icon">${icons.intelligence}</span> City Intelligence
          </a>
          <a class="sidebar-link ${activeRoute === 'report' ? 'active' : ''}" onclick="navigate('report')">
            <span class="icon">${icons.report}</span> Submit Report
          </a>
        </nav>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">System</div>
        <nav class="sidebar-nav">
          <a class="sidebar-link" onclick="toggleNotificationPanel()">
            <span class="icon">${icons.bell}</span> Notifications ${unreadNotificationCount() ? `<span class="sidebar-badge">${unreadNotificationCount()}</span>` : ''}
          </a>
          <a class="sidebar-link" onclick="handleLogout()"><span class="icon">🚪</span> Sign Out</a>
        </nav>
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-avatar sidebar-avatar-gov">${currentProfile?.name?.charAt(0) || 'A'}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${currentProfile?.name || 'Admin'}</div>
            <div class="sidebar-user-role">Gov Administrator</div>
          </div>
        </div>
      </div>
    </aside>`;
}

function loadingBanner() {
  if (!dataLoading.issues && !firestoreError) return '';
  if (firestoreError) {
    return `<div class="app-banner app-banner-error">Firestore sync issue: ${escapeHtml(friendlyFirestoreError(firestoreError))} <button class="btn btn-ghost btn-sm" onclick="location.reload()">Retry</button></div>`;
  }
  if (dataLoading.issues) {
    return `<div class="app-banner app-banner-loading"><span class="spinner"></span> Syncing live data from Firestore…</div>`;
  }
  return '';
}

function friendlyFirestoreError(err) {
  const msg = err?.message || String(err);
  if (/permission/i.test(msg)) return 'Missing or insufficient permissions — deploy firestore.rules';
  return msg;
}

function unreadNotificationCount() {
  return globalNotifications.filter(n => !n.read).length;
}

function renderNotificationPanel() {
  if (!notificationPanelOpen) return '';
  const items = globalNotifications.slice(0, 15);
  return `
    <div class="notification-panel" id="notification-panel">
      <div class="notification-panel-header">
        <span class="headline-sm">Notifications</span>
        <div style="display:flex;gap:var(--space-2)">
          ${unreadNotificationCount() ? `<button class="btn btn-ghost btn-sm" onclick="markAllNotificationsReadHandler()">Mark all read</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="toggleNotificationPanel()">✕</button>
        </div>
      </div>
      <div class="notification-list">
        ${items.length ? items.map(n => `
          <div class="notification-item ${n.read ? 'read' : 'unread'}" onclick="openNotification('${n.id}')">
            <div class="notification-item-type">● ${escapeHtml(n.type || 'update')}</div>
            <div class="notification-item-msg">${escapeHtml(n.message || '')}</div>
            <div class="notification-item-meta mono">${escapeHtml(n.issueId || '')} · ${formatLogTime(n.createdAt)}</div>
          </div>
        `).join('') : '<div class="empty-state" style="padding:var(--space-5)">No notifications yet</div>'}
      </div>
    </div>`;
}

function topbar(title, breadcrumb) {
  const unread = unreadNotificationCount();
  return `
    <header class="topbar">
      <div class="topbar-left">
        <div class="topbar-breadcrumb">${breadcrumb} › <span>${title}</span></div>
      </div>
      <div class="topbar-search" onclick="toggleCommandPalette()" style="cursor:pointer">${icons.search} Search incidents, zones, or insights... <span class="topbar-kbd">⌘K</span></div>
      <div class="topbar-right">
        <div class="notification-wrap" id="notification-mount">
          <button class="topbar-icon-btn" title="Notifications" onclick="toggleNotificationPanel()">${icons.bell}${unread ? `<span class="badge">${unread > 9 ? '9+' : unread}</span>` : ''}</button>
          ${renderNotificationPanel()}
        </div>
        <button class="topbar-icon-btn" title="AI Copilot" onclick="navigate('intelligence')">${icons.sparkle}</button>
        <div class="topbar-user">
          <div class="topbar-user-info">
            <div class="topbar-user-name">${currentProfile?.name || 'User'}</div>
            <div class="topbar-user-role">${currentProfile?.role === 'Administrator' ? 'Gov Admin' : 'Civic Hero'}</div>
          </div>
          <div class="sidebar-avatar">${currentProfile?.name?.charAt(0) || 'U'}</div>
        </div>
        <div class="pill pill-active" style="font-size:11px"><span class="dot"></span> Online</div>
      </div>
    </header>`;
}

function dashboardLayout(activeRoute, title, breadcrumb, content) {
  return `
    <div class="app-layout">
      ${sidebar(activeRoute)}
      <main class="main-content">
        ${topbar(title, breadcrumb)}
        ${loadingBanner()}
        <div class="page-content">${content}</div>
      </main>
    </div>
    <div id="command-palette-mount">${renderCommandPalette()}</div>
  `;
}

function sparkline(values, color = 'var(--primary)') {
  if(!values || values.length === 0) return '';
  const max = Math.max(...values);
  return `<div class="sparkline">${values.map(v =>
    `<div class="sparkline-bar" style="height:${(v / max) * 100}%;background:${color}"></div>`
  ).join('')}</div>`;
}

function progressRing(value, max, size = 100, color = 'var(--primary)') {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / max) * c;
  return `
    <div class="progress-ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="5"
          stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
          style="transition:stroke-dashoffset 1.5s ease"/>
      </svg>
      <div class="progress-text" style="font-size:${size/4}px;color:${color}">${value}</div>
    </div>`;
}

function pageHeader(title, subtitle, actions = '') {
  return `
    <div class="page-header">
      <div>
        <h1 class="headline-lg">${title}</h1>
        ${subtitle ? `<p class="body-md page-header-sub">${subtitle}</p>` : ''}
      </div>
      ${actions ? `<div class="page-header-actions">${actions}</div>` : ''}
    </div>`;
}

function cardHeader(title, action = '') {
  return `
    <div class="card-header">
      <h3 class="headline-sm">${title}</h3>
      ${action}
    </div>`;
}

function barChart(bars, color = 'var(--primary)') {
  const max = Math.max(...bars.map(b => b.value));
  return `<div class="bar-chart">${bars.map(b => `
    <div class="bar-col">
      <div class="bar-fill" style="height:${(b.value / max) * 100}%;background:linear-gradient(180deg,${color},${color}88)"></div>
      <span class="bar-label">${b.label}</span>
    </div>
  `).join('')}</div>`;
}

function severityGauge(level = 'high') {
  const levels = ['low', 'medium', 'high', 'critical'];
  const idx = levels.indexOf(level);
  const colors = ['var(--secondary)', 'var(--info)', 'var(--warning)', 'var(--danger)'];
  return `
    <div class="severity-gauge-wrap">
      <div class="severity-gauge">
        ${levels.map((l, i) => `
          <div class="severity-segment ${i <= idx ? 'active' : ''}" style="${i <= idx ? `background:${colors[i]}` : ''}"></div>
        `).join('')}
      </div>
      <div class="severity-label pill pill-${level}"><span class="dot"></span> ${level.charAt(0).toUpperCase() + level.slice(1)} Impact</div>
    </div>`;
}

function trustScorePanel(score = 82) {
  return `
    <div class="trust-score-panel">
      <div class="trust-score-header">
        <span class="label-sm">Community Trust Score</span>
        <span class="trust-score-value">${score}%</span>
      </div>
      <div class="progress-bar" style="height:8px;margin:var(--space-3) 0">
        <div class="progress-bar-fill" style="width:${score}%;background:linear-gradient(90deg,var(--secondary),var(--primary-light))"></div>
      </div>
      <p class="body-md" style="color:var(--text-muted);font-size:12px">Based on verification history and community consensus</p>
    </div>`;
}

function insightCard(icon, title, desc, action = '', variant = 'purple') {
  return `
    <div class="insight-card insight-card-${variant}">
      <div class="insight-card-icon">${icon}</div>
      <div class="insight-card-body">
        <div class="insight-card-title">${title}</div>
        <div class="insight-card-desc">${desc}</div>
        ${action}
      </div>
    </div>`;
}

function achievementBadge(icon, name, earned = true) {
  return `
    <div class="achievement-badge ${earned ? 'earned' : 'locked'}">
      <div class="badge-icon">${icon}</div>
      <div class="badge-name">${name}</div>
    </div>`;
}

function reportStepper(activeStep = 2) {
  const steps = ['Capture', 'Analyze', 'Verify', 'Submit'];
  return `
    <div class="stepper">
      ${steps.map((label, i) => {
        const num = i + 1;
        const cls = num < activeStep ? 'completed' : num === activeStep ? 'active' : '';
        return `
          ${i > 0 ? '<div class="step-line"></div>' : ''}
          <div class="step ${cls}">
            <div class="step-dot">${num < activeStep ? icons.check : num}</div>
            <span class="step-label">${label}</span>
          </div>`;
      }).join('')}
    </div>`;
}

function aiCopilotPanel(title = 'AI Copilot', messages = [], panelId = 'copilot') {
  const defaultMsgs = messages.length ? messages : copilotMessages.length ? copilotMessages : [
    { role: 'ai', text: "I'm CivicMind AI Copilot. Ask about wards, departments, critical issues, predictions, or today's reports." },
  ];
  const displayMsgs = messages.length ? messages : defaultMsgs;
  return `
    <div class="ai-copilot-panel glass-card" id="${panelId}-panel">
      <div class="ai-copilot-header">
        <span class="ai-copilot-icon">${icons.sparkle}</span>
        <div>
          <div class="label-md" style="color:var(--secondary-light)">${title}</div>
          <div style="font-size:11px;color:var(--text-dim)">Powered by Multi-LLM · Firestore context</div>
        </div>
      </div>
      <div class="ai-copilot-messages" id="${panelId}-messages">
        ${displayMsgs.map(m => `
          <div class="ai-message ai-message-${m.role}">
            ${escapeHtml(m.text)}
            ${m.source && m.role === 'ai' ? `<div style="text-align:right;font-size:9px;color:var(--text-dim);margin-top:4px">Powered by ${m.source === 'gemini' ? 'Gemini' : m.source === 'groq' ? 'Groq' : 'CivicMind Heuristic'}</div>` : ''}
          </div>
        `).join('')}
      </div>
      <form class="ai-copilot-input" onsubmit="submitCopilotQuestion(event, '${panelId}')">
        <input type="text" id="${panelId}-input" class="input-field" placeholder="Ask anything about civic data…" autocomplete="off" />
        <button type="submit" class="btn btn-primary btn-sm ai-send-btn" id="${panelId}-send">${icons.sparkle}</button>
      </form>
    </div>`;
}

window.submitCopilotQuestion = async (e, panelId = 'copilot') => {
  e.preventDefault();
  const input = document.getElementById(`${panelId}-input`);
  const sendBtn = document.getElementById(`${panelId}-send`);
  const messagesEl = document.getElementById(`${panelId}-messages`);
  const question = input?.value?.trim();
  if (!question || !messagesEl) return;

  const appendMessage = (role, text, source = null) => {
    const div = document.createElement('div');
    div.className = `ai-message ai-message-${role}`;
    div.innerHTML = escapeHtml(text) + (source && role === 'ai' ? `<div style="text-align:right;font-size:9px;color:var(--text-dim);margin-top:4px">Powered by ${source === 'gemini' ? 'Gemini' : source === 'groq' ? 'Groq' : 'CivicMind Heuristic'}</div>` : '');
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  appendMessage('user', question);
  input.value = '';
  if (sendBtn) sendBtn.disabled = true;

  appendMessage('ai', 'Analyzing Firestore data…');

  try {
    const { text, source } = await askCopilot(question, {
      issues: globalIssues,
      agentLogs: globalAgentLogs,
      notifications: globalNotifications,
    });
    messagesEl.lastElementChild?.remove();
    appendMessage('ai', text, source);
    copilotMessages = [...copilotMessages, { role: 'user', text: question }, { role: 'ai', text: text, source }];
  } catch (err) {
    messagesEl.lastElementChild?.remove();
    appendMessage('ai', `Unable to generate a response: ${err.message}`);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  }
};

window.toggleNotificationPanel = () => {
  notificationPanelOpen = !notificationPanelOpen;
  maybeRerender(getRoute());
};

window.markAllNotificationsReadHandler = async () => {
  try {
    await markAllNotificationsRead(globalNotifications);
    showSuccess('All notifications marked as read');
  } catch (err) {
    handleAppError(err);
  }
};

window.openNotification = async (id) => {
  const n = globalNotifications.find(x => x.id === id);
  if (!n) return;
  try {
    if (!n.read) await markNotificationRead(id);
    if (n.issueId) showInfo(`Issue ${n.issueId}: ${n.message}`);
    notificationPanelOpen = false;
    maybeRerender(getRoute());
  } catch (err) {
    handleAppError(err);
  }
};

window.setReportUploadTab = (tab) => {
  currentReportUploadTab = tab;
  maybeRerender('report');
};

window.handleReportMediaSelect = (e) => {
  const files = [...(e.target.files || [])];
  if (!files.length) return;
  const label = document.getElementById('upload-status-label');
  const preview = document.getElementById('upload-preview');

  if (currentReportUploadTab === 'images') {
    pendingReportMedia.images = [...pendingReportMedia.images, ...files].slice(0, 5);
    if (label) label.textContent = `${pendingReportMedia.images.length} image(s) ready`;
    if (preview) {
      preview.innerHTML = pendingReportMedia.images.map(f =>
        `<img src="${URL.createObjectURL(f)}" class="media-thumb" alt="preview" />`
      ).join('');
    }
  } else if (currentReportUploadTab === 'videos') {
    pendingReportMedia.video = files[0];
    if (label) label.textContent = `Video ready: ${files[0].name}`;
  } else if (currentReportUploadTab === 'audio') {
    pendingReportMedia.audio = files[0];
    if (label) label.textContent = `Voice note ready: ${files[0].name}`;
  }
};

window.handleReportImageSelect = window.handleReportMediaSelect;

window.toggleMapFilter = (key, value) => {
  if (key === 'showHeatmap' || key === 'showHotspots' || key === 'showClustering') {
    mapFilters[key] = !mapFilters[key];
  } else if (key === 'category') {
    const set = new Set(mapFilters.categories);
    set.has(value) ? set.delete(value) : set.add(value);
    mapFilters.categories = [...set];
  } else if (key === 'severity') {
    const set = new Set(mapFilters.severities);
    set.has(value) ? set.delete(value) : set.add(value);
    mapFilters.severities = [...set];
  } else if (key === 'department') {
    const set = new Set(mapFilters.departments || []);
    set.has(value) ? set.delete(value) : set.add(value);
    mapFilters.departments = [...set];
  }
  if (getRoute() === 'dashboard') maybeRerender('dashboard');
};

window.exportDashboardData = () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), issues: globalIssues, stats: computeIssueStats(globalIssues) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `civicmind-export-${Date.now()}.json`;
  a.click();
  showSuccess('Dashboard data exported');
};

window.mapZoomIn = mapZoomIn;
window.mapZoomOut = mapZoomOut;
window.initReportGeolocation = () => initReportGeolocation();

function agentCard(name, role, status, load, icon, confidence = 0, metrics = {}) {
  const { provider, latency, tokenUsage, providerSwitch } = metrics;
  const execTime = latency != null ? latency : metrics.executionTime;
  
  return `
    <div class="agent-card glass-card">
      <div class="agent-card-header" style="margin-bottom:8px">
        <div class="agent-avatar">${icon}</div>
        <div>
          <div class="agent-name">${name}</div>
          <div class="agent-role">${role}</div>
        </div>
        <span class="pill pill-${status === 'processing' ? 'processing' : status === 'idle' || status === 'failed' ? 'idle' : 'active'}"><span class="dot"></span> ${status}</span>
      </div>
      
      <div class="agent-metrics grid grid-2" style="gap:6px; margin-bottom:12px">
        <div class="agent-metric">
          <span class="label-sm">Provider</span>
          <span class="mono" style="color:var(--primary-light)">
            ${provider ? (provider === 'gemini' ? 'Gemini' : provider === 'groq' ? 'Groq' : 'Heuristic') : '—'}
            ${providerSwitch ? ' ⚠️' : ''}
          </span>
        </div>
        <div class="agent-metric"><span class="label-sm">Confidence</span><span class="mono">${confidence}%</span></div>
        <div class="agent-metric"><span class="label-sm">Tokens</span><span class="mono">${tokenUsage?.totalTokens ?? '—'}</span></div>
        <div class="agent-metric"><span class="label-sm">Latency</span><span class="mono">${execTime != null ? execTime + 'ms' : '—'}</span></div>
      </div>
      
      <div class="agent-load">
        <div class="label-sm" style="margin-bottom:6px;display:flex;justify-content:space-between">
          <span>Activity Load</span>
          <span class="mono">${load}%</span>
        </div>
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${load}%;background:var(--primary)"></div></div>
      </div>
    </div>`;
}

function deptWidget(dept, count, pct, color) {
  return `
    <div class="dept-widget">
      <div class="dept-widget-header">
        <span>${dept}</span>
        <span class="mono" style="color:${color};font-size:12px">${count}</span>
      </div>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
}

// ---------- Firestore Data Helpers ----------
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp.toDate) return timestamp.toDate();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
  return new Date(timestamp);
}

function formatIssueDate(timestamp) {
  const date = toDate(timestamp);
  if (!date || Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatLogTime(timestamp) {
  const date = toDate(timestamp);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function computeIssueStats(issues) {
  return {
    total: issues.length,
    active: issues.filter(i => i.status !== 'Resolved').length,
    resolved: issues.filter(i => i.status === 'Resolved').length,
    critical: issues.filter(i => i.severity === 'critical' && i.status !== 'Resolved').length,
    open: issues.filter(i => i.status === 'Open').length,
  };
}

function issuesSparklineByDay(issues, days = 7) {
  const counts = Array(days).fill(0);
  const now = new Date();
  issues.forEach(issue => {
    const date = toDate(issue.createdAt);
    if (!date) return;
    const dayDiff = Math.floor((now - date) / 86400000);
    if (dayDiff >= 0 && dayDiff < days) {
      counts[days - 1 - dayDiff] += 1;
    }
  });
  return counts.some(v => v > 0) ? counts : Array(days).fill(0);
}

function computeCategoryCounts(issues) {
  const counts = {};
  issues.forEach(i => {
    const cat = i.category || 'General';
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return counts;
}

function topCategoryInsight(issues) {
  const counts = computeCategoryCounts(issues);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const [category, count] = entries[0];
  return { category, count };
}

function peakHourFromIssues(issues) {
  const hours = Array(24).fill(0);
  issues.forEach(issue => {
    const date = toDate(issue.createdAt);
    if (date) hours[date.getHours()] += 1;
  });
  const max = Math.max(...hours);
  if (max === 0) return null;
  const peak = hours.indexOf(max);
  const end = (peak + 1) % 24;
  const fmt = h => {
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:00 ${period}`;
  };
  return `${fmt(peak)} – ${fmt(end)}`;
}

function computeDeptWorkload(issues) {
  const counts = {};
  issues.forEach(i => {
    const dept = i.department || DEPARTMENT_BY_CATEGORY[i.category] || 'General';
    counts[dept] = (counts[dept] || 0) + 1;
  });
  return counts;
}

function reputationPercent(score, maxScore = 1000) {
  if (score == null) return 0;
  return Math.min(100, Math.round((score / maxScore) * 100));
}

function renderProfileBadges(badges = []) {
  const catalogKeys = Object.keys(BADGE_CATALOG);
  if (!badges.length) {
    return catalogKeys.slice(0, 3).map(key =>
      achievementBadge(BADGE_CATALOG[key].icon, BADGE_CATALOG[key].name, false)
    ).join('');
  }
  return badges.map(badgeId => {
    const meta = BADGE_CATALOG[badgeId] || { icon: '🏅', name: badgeId.replace(/_/g, ' ') };
    return achievementBadge(meta.icon, meta.name, true);
  }).join('');
}

function avgUserTrustPercent(issues, profile) {
  if (issues.length) {
    const avg = issues.reduce((sum, i) => sum + (Number(i.trustScore) || 5), 0) / issues.length;
    return Math.round((avg / 10) * 100);
  }
  return reputationPercent(profile?.citizenScore ?? 100, profile?.role === 'Administrator' ? 1000 : 500);
}

function statusPillClass(status) {
  if (status === 'Resolved') return 'resolved';
  if (status === 'Verified') return 'active';
  if (status === 'Open' || status === 'In Progress') return 'processing';
  return 'idle';
}

function aggregateAgentCards(logs) {
  const latestByAgent = {};
  logs.forEach(log => {
    const name = log.agentName || 'Unknown';
    if (!latestByAgent[name]) latestByAgent[name] = log;
  });

  const pipelineAgents = PIPELINE_ORDER.map(name => {
    const latest = latestByAgent[name];
    const meta = AGENT_META[name] || { role: name, icon: '🤖' };
    const runs = logs.filter(l => l.agentName === name).length;
    const load = Math.min(100, Math.max(latest ? 25 : 5, runs * 8 + (latest?.confidence || 0) / 3));
    return {
      name,
      role: meta.role,
      status: latest?.status || 'idle',
      load: Math.round(load),
      icon: meta.icon,
      confidence: latest?.confidence ?? 0,
      metrics: {
        provider: latest?.provider,
        latency: latest?.latency,
        tokenUsage: latest?.tokenUsage,
        providerSwitch: latest?.providerSwitch,
        fallbackReason: latest?.fallbackReason,
        executionTime: latest?.executionTime
      },
    };
  });

  const legacy = Object.keys(latestByAgent)
    .filter(name => !PIPELINE_ORDER.includes(name))
    .map(name => {
      const latest = latestByAgent[name];
      const meta = AGENT_META[name] || { role: name, icon: '🤖' };
      return {
        name,
        role: meta.role,
        status: latest.status || 'idle',
        load: 20,
        icon: meta.icon,
        confidence: latest.confidence ?? 0,
        metrics: {
          provider: latest?.provider,
          latency: latest?.latency,
          tokenUsage: latest?.tokenUsage,
          providerSwitch: latest?.providerSwitch,
          fallbackReason: latest?.fallbackReason,
          executionTime: latest?.executionTime
        },
      };
    });

  return [...pipelineAgents, ...legacy];
}

function pipelineFromLogs(logs) {
  const latestByAgent = {};
  logs.forEach(log => {
    if (!latestByAgent[log.agentName]) latestByAgent[log.agentName] = log;
  });

  return PIPELINE_ORDER.map(name => {
    const log = latestByAgent[name];
    const meta = AGENT_META[name] || { icon: '🤖' };
    return {
      name,
      icon: meta.icon,
      status: log?.status || 'idle',
      desc: log?.output ? String(log.output).slice(0, 48) : 'Awaiting execution',
      confidence: log?.confidence ?? 0,
      executionTime: log?.executionTime ?? null,
    };
  });
}

function renderAgentLogEntry(log) {
  const structured = log.structuredOutput
    ? JSON.stringify(log.structuredOutput, null, 2)
    : null;
  return `
    <details class="agent-log-entry">
      <summary class="agent-log-summary">
        <span class="mono" style="color:var(--primary-light)">${escapeHtml(log.agentName)}</span>
        <span style="color:var(--text-muted);font-size:12px">${escapeHtml(log.issueId || '')}</span>
        <span class="pill pill-${log.status === 'complete' ? 'resolved' : log.status === 'failed' ? 'idle' : 'processing'}" style="font-size:10px">${escapeHtml(log.status)}</span>
        <span class="mono" style="font-size:11px;color:var(--secondary-light)">${log.confidence ?? 0}%</span>
        ${log.executionTime != null ? `<span class="mono" style="font-size:11px;color:var(--text-dim)">${log.executionTime}ms</span>` : ''}
        <span style="font-size:11px;color:var(--text-dim)">${formatLogTime(log.timestamp)}</span>
      </summary>
      <div class="agent-log-body">
        <p style="font-size:13px;margin-bottom:var(--space-3)">${escapeHtml(log.output || '')}</p>
        ${structured ? `<pre class="agent-log-structured">${escapeHtml(structured)}</pre>` : ''}
      </div>
    </details>`;
}

function buildEscalationChain(issues) {
  const stats = computeIssueStats(issues);
  return [
    {
      level: 'L1', dept: 'Field Agent',
      status: stats.open > 0 ? 'active' : 'complete',
      label: stats.open > 0 ? `${stats.open} open issue(s) awaiting triage` : 'No open issues in triage',
    },
    {
      level: 'L2', dept: 'Department Head',
      status: stats.critical > 0 ? 'active' : stats.active > 0 ? 'complete' : 'pending',
      label: stats.critical > 0 ? `Reviewing ${stats.critical} critical item(s)` : 'No critical escalations',
    },
    {
      level: 'L3', dept: 'City Operations',
      status: stats.active > 5 ? 'active' : 'pending',
      label: stats.active > 5 ? `${stats.active} active cases in queue` : 'Queue within normal range',
    },
    {
      level: 'L4', dept: 'Executive Office',
      status: stats.critical > 3 ? 'active' : 'pending',
      label: stats.critical > 3 ? 'Executive review required' : 'Standby',
    },
  ];
}

function issuesByWeekday(issues) {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const counts = Array(7).fill(0);
  issues.forEach(issue => {
    const date = toDate(issue.createdAt);
    if (date) counts[date.getDay()] += 1;
  });
  return labels.map((label, i) => ({ label, value: counts[i] }));
}

async function initReportGeolocation() {
  const latEl = document.getElementById('rep-lat');
  const lngEl = document.getElementById('rep-lng');
  const locEl = document.getElementById('rep-loc');
  const coordsEl = document.getElementById('geo-coords-display');
  const addressEl = document.getElementById('geo-address-display');
  const accuracyEl = document.getElementById('geo-accuracy-display');
  const mapContainerEl = document.querySelector('.geo-map-mini');
  if (!latEl || !lngEl || !locEl) return;

  // Reset captured location
  capturedLocation = { ...EMPTY_LOCATION };

  const handleMapClick = async (clickedLat, clickedLng) => {
    if (addressEl) addressEl.textContent = 'Reverse geocoding...';
    if (coordsEl) coordsEl.textContent = `${clickedLat.toFixed(4)}° N, ${clickedLng.toFixed(4)}° E`;
    if (accuracyEl) accuracyEl.textContent = 'Manual Selection';

    const { address } = await reverseGeocode(clickedLat, clickedLng);
    
    capturedLocation = {
      ...EMPTY_LOCATION,
      latitude: clickedLat,
      longitude: clickedLng,
      locationCapturedAt: new Date().toISOString(),
      ...address,
      coordinates: { latitude: clickedLat, longitude: clickedLng }
    };

    latEl.value = clickedLat;
    lngEl.value = clickedLng;
    locEl.value = address.formattedAddress || `${clickedLat.toFixed(5)}, ${clickedLng.toFixed(5)}`;
    
    if (addressEl) {
      addressEl.textContent = address.locationAddress || 'Manual Location Selected';
    }
    updateReportScanStatus(true);
  };

  if (!navigator.geolocation) {
    locEl.value = '';
    if (addressEl) addressEl.textContent = 'GPS unsupported. Click map to set location.';
    if (coordsEl) coordsEl.textContent = '—';
    showWarning('Your browser does not support geolocation. Please select location manually on the map.');
    if (mapContainerEl) {
      initReportMap(mapContainerEl, null, null, true, handleMapClick);
    }
    updateReportScanStatus(false);
    return;
  }

  if (addressEl) addressEl.textContent = 'Detecting location…';
  if (coordsEl) coordsEl.textContent = 'Requesting device GPS';

  const { location, geoError, geocodeError } = await captureFullLocation({
    enableHighAccuracy: true,
    timeout: 15000,
  });

  if (geoError) {
    capturedLocation = { ...EMPTY_LOCATION };
    locEl.value = '';
    if (addressEl) addressEl.textContent = 'Location access denied. Click map to set location.';
    if (coordsEl) coordsEl.textContent = '—';
    if (accuracyEl) accuracyEl.textContent = '';
    showWarning('GPS permission denied or timed out. Please click on the map to set location manually.');
    if (mapContainerEl) {
      initReportMap(mapContainerEl, null, null, true, handleMapClick);
    }
    updateReportScanStatus(false);
    return;
  }

  // GPS succeeded — populate form fields
  capturedLocation = location;
  latEl.value = location.latitude;
  lngEl.value = location.longitude;
  locEl.value = location.formattedAddress
    || `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;

  if (coordsEl) {
    coordsEl.textContent = `${location.latitude.toFixed(4)}° N, ${location.longitude.toFixed(4)}° E`;
  }
  if (accuracyEl && location.locationAccuracy) {
    accuracyEl.textContent = `±${Math.round(location.locationAccuracy)}m`;
  }

  // Show address or fallback
  if (addressEl) {
    if (location.locationAddress) {
      addressEl.textContent = location.locationAddress;
    } else if (geocodeError) {
      addressEl.textContent = 'Device location captured (address unavailable)';
      showInfo('Location captured. Address lookup failed — continuing without it.');
    } else {
      addressEl.textContent = 'Device location captured';
    }
  }

  if (mapContainerEl) {
    initReportMap(mapContainerEl, location.latitude, location.longitude, true, handleMapClick);
  }

  updateReportScanStatus(true);
}

function updateReportScanStatus(hasGeo) {
  const geoPill = document.getElementById('scan-geo-status');
  if (geoPill) {
    geoPill.className = `pill pill-${hasGeo ? 'resolved' : 'processing'}`;
    geoPill.innerHTML = hasGeo ? 'Complete' : '<span class="dot"></span> Pending';
  }
}

function initReportFormBindings() {
  const catEl = document.getElementById('rep-cat');
  const sevEl = document.getElementById('rep-severity');
  const catDisplay = document.getElementById('classify-category');
  const gaugeWrap = document.getElementById('classify-severity-wrap');

  const syncCategory = () => {
    if (catDisplay && catEl) catDisplay.textContent = catEl.value;
  };
  const syncSeverity = () => {
    if (gaugeWrap && sevEl) gaugeWrap.innerHTML = severityGauge(sevEl.value);
  };

  catEl?.addEventListener('change', syncCategory);
  sevEl?.addEventListener('change', syncSeverity);
  syncCategory();
  syncSeverity();
}

window.adminUpdateStatus = async (docId, status) => {
  try {
    const issue = globalIssues.find(i => i.id === docId);
    await updateIssueStatus(docId, status, currentUser?.uid, currentProfile?.role);
    if (issue) {
      await createAgentLog(issue.issueId, 'Output', 'complete', 100, `Status updated to ${status}`);
      await createNotification({
        userId: issue.createdBy,
        role: 'Citizen',
        issueId: issue.issueId,
        type: status === 'Verified' ? 'issue_verified' : status === 'Resolved' ? 'issue_resolved' : 'status_update',
        message: status === 'Verified'
          ? `Your report ${issue.issueId} has been verified by city officials.`
          : status === 'Resolved'
            ? `Your report ${issue.issueId} has been marked resolved. Thank you for contributing.`
            : `Status for ${issue.issueId} updated to ${status}.`,
      });
      if (currentProfile?.role === 'Administrator') {
        await createNotification({
          userId: currentUser.uid,
          role: 'Administrator',
          issueId: issue.issueId,
          type: 'admin_status_change',
          message: `Issue ${issue.issueId} status set to ${status}.`,
        });
      }
    }
    showSuccess(`Status updated to ${status}`);
  } catch (err) {
    handleAppError(err);
  }
};

window.adminAssignDepartment = async (docId, department) => {
  try {
    const issue = globalIssues.find(i => i.id === docId);
    await assignIssueDepartment(docId, department, currentUser?.uid, currentProfile?.role);
    if (issue) {
      await createAgentLog(issue.issueId, 'Output', 'active', 90, `Assigned to ${department}`);
      await createNotification({
        userId: issue.createdBy,
        role: 'Citizen',
        issueId: issue.issueId,
        type: 'issue_assigned',
        message: `Your report ${issue.issueId} has been assigned to ${department}.`,
      });
      await createNotification({
        userId: currentUser?.uid || issue.createdBy,
        role: 'Department',
        issueId: issue.issueId,
        type: 'department_assignment',
        message: `${department}: review issue ${issue.issueId} (${issue.title}).`,
        department,
      });
    }
    showSuccess(`Assigned to ${department}`);
  } catch (err) {
    handleAppError(err);
  }
};

window.adminMarkResolved = async (docId) => {
  try {
    const issue = globalIssues.find(i => i.id === docId);
    await updateIssueStatus(docId, 'Resolved', currentUser?.uid, currentProfile?.role);
    if (issue) {
      await createAgentLog(issue.issueId, 'Output', 'complete', 100, 'Issue marked resolved');
      await createNotification({
        userId: issue.createdBy,
        role: 'Citizen',
        issueId: issue.issueId,
        type: 'issue_resolved',
        message: `Your report ${issue.issueId} has been resolved. Thank you for your civic contribution.`,
      });
    }
    showSuccess('Issue marked resolved');
  } catch (err) {
    handleAppError(err);
  }
};

window.adminEscalate = async (docId, level) => {
  try {
    const issue = globalIssues.find(i => i.id === docId);
    const escalationLevel = Math.min(4, Math.max(1, Number(level) || 1));
    await escalateIssue(docId, escalationLevel, currentUser?.uid);
    if (issue) {
      await createNotification({
        userId: currentUser?.uid,
        role: 'Administrator',
        issueId: issue.issueId,
        type: 'escalation',
        message: `Issue ${issue.issueId} escalated to level ${escalationLevel}.`,
      });
    }
    showSuccess(`Escalated to L${escalationLevel}`);
  } catch (err) {
    handleAppError(err);
  }
};

// ============================================================
// AUTH PAGES
// ============================================================
window.executeLogin = async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const pass = document.getElementById('password').value;
  try {
    document.getElementById('auth-error').style.display = 'none';
    await loginWithEmail(email, pass);
    navigate('dashboard');
  } catch(err) {
    document.getElementById('auth-error').textContent = err.message;
    document.getElementById('auth-error').style.display = 'block';
  }
};

window.executeForgotPassword = async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  try {
    document.getElementById('auth-error').style.display = 'none';
    await resetPassword(email);
    showSuccess('Password reset email sent. Check your inbox.');
    navigate('login');
  } catch (err) {
    document.getElementById('auth-error').textContent = err.message;
    document.getElementById('auth-error').style.display = 'block';
  }
};

window.executeSignup = async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const pass = document.getElementById('password').value;
  const conf = document.getElementById('confirm').value;
  const role = 'Citizen';
  if (pass !== conf) {
    document.getElementById('auth-error').textContent = "Passwords do not match";
    document.getElementById('auth-error').style.display = 'block';
    return;
  }
  try {
    document.getElementById('auth-error').style.display = 'none';
    await registerUser({ name, email, password: pass, role });
    navigate('dashboard');
  } catch(err) {
    document.getElementById('auth-error').textContent = err.message;
    document.getElementById('auth-error').style.display = 'block';
  }
};

function renderLogin() {
  app.innerHTML = `
    <div class="auth-page">
      <div class="auth-bg-blob1"></div>
      <div class="auth-bg-blob2"></div>
      <div class="auth-bg-grid"></div>
      
      <div class="auth-card auth-card-premium">
        <div class="auth-logo">
          <div class="auth-logo-icon">C</div>
          <div class="auth-title">Welcome back</div>
          <div class="auth-subtitle">Sign in to CivicMind AI — your civic intelligence platform</div>
        </div>
        
        <div id="auth-error" class="auth-error"></div>

        <form class="auth-form" onsubmit="executeLogin(event)">
          <div class="auth-form-group">
            <label class="auth-label">Email Address</label>
            <input type="email" id="email" class="input-field" placeholder="citizen@smartcity.gov" required />
          </div>
          <div class="auth-form-group">
            <label class="auth-label">Password</label>
            <input type="password" id="password" class="input-field" placeholder="••••••••" required />
          </div>
          <div class="auth-options">
            <label class="auth-checkbox">
              <input type="checkbox" /> Remember me
            </label>
            <a onclick="navigate('forgot-password')" style="cursor:pointer">Forgot password?</a>
          </div>
          <button type="submit" class="btn btn-primary btn-lg auth-submit-btn">Sign In →</button>
        </form>

        <div class="auth-divider">or continue with</div>
        
        <button type="button" class="btn google-btn btn-lg" onclick="handleGoogleLogin()">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Continue with Google
        </button>

        <div class="auth-footer">
          Don't have an account? <a onclick="navigate('signup')" style="cursor:pointer">Create one free</a>
        </div>
      </div>
    </div>
  `;
}

function renderSignup() {
  app.innerHTML = `
    <div class="auth-page">
      <div class="auth-bg-blob1"></div>
      <div class="auth-bg-blob2"></div>
      <div class="auth-bg-grid"></div>
      
      <div class="auth-card auth-card-premium" style="max-width:520px">
        <div class="auth-logo" style="margin-bottom:var(--space-6)">
          <div class="auth-logo-icon">C</div>
          <div class="auth-title">Create your account</div>
          <div class="auth-subtitle">Join the CivicMind AI network and start reporting</div>
        </div>

        <div id="auth-error" class="auth-error"></div>

        <form class="auth-form" onsubmit="executeSignup(event)">
          <div class="auth-form-group">
            <label class="auth-label">Full Name</label>
            <input type="text" id="name" class="input-field" placeholder="Jane Doe" required />
          </div>
          <div class="auth-form-group">
            <label class="auth-label">Email</label>
            <input type="email" id="email" class="input-field" placeholder="jane@example.com" required />
          </div>
          <div class="grid grid-2" style="gap:var(--space-4)">
            <div class="auth-form-group">
              <label class="auth-label">Password</label>
              <input type="password" id="password" class="input-field" placeholder="••••••••" required />
            </div>
            <div class="auth-form-group">
              <label class="auth-label">Confirm Password</label>
              <input type="password" id="confirm" class="input-field" placeholder="••••••••" required />
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg auth-submit-btn">Create Account →</button>
        </form>

        <div class="auth-footer">
          Already have an account? <a onclick="navigate('login')" style="cursor:pointer">Sign in</a>
        </div>
      </div>
    </div>
  `;
}

function renderForgotPassword() {
  app.innerHTML = `
    <div class="auth-page">
      <div class="auth-bg-blob1"></div>
      <div class="auth-bg-blob2"></div>
      <div class="auth-bg-grid"></div>
      
      <div class="auth-card auth-card-premium">
        <div class="auth-logo" style="margin-bottom:var(--space-6)">
          <div class="auth-logo-icon">🔑</div>
          <div class="auth-title">Reset Password</div>
          <div class="auth-subtitle">Enter your email and we'll send reset instructions</div>
        </div>
        <form class="auth-form" onsubmit="executeForgotPassword(event)">
          <div id="auth-error" class="auth-error" style="display:none"></div>
          <div class="auth-form-group">
            <label class="auth-label">Email Address</label>
            <input type="email" id="email" class="input-field" placeholder="citizen@smartcity.gov" required />
          </div>
          <button type="submit" class="btn btn-primary btn-lg auth-submit-btn">Send Reset Link →</button>
        </form>
        <div class="auth-footer">
          Back to <a onclick="navigate('login')" style="cursor:pointer">Sign in</a>
        </div>
      </div>
    </div>
  `;
}

function initLandingAnimations() {
  // Typing Effect
  const phrases = [
    "Analyzing pothole reports...",
    "Predicting infrastructure failures...",
    "Routing issues to Public Works...",
    "Verifying community reports..."
  ];
  let currentPhrase = 0;
  const typingEl = document.getElementById('typing-text');
  
  if (typingEl) {
    setInterval(() => {
      currentPhrase = (currentPhrase + 1) % phrases.length;
      typingEl.textContent = phrases[currentPhrase];
      // reset animation
      typingEl.style.animation = 'none';
      typingEl.offsetHeight; /* trigger reflow */
      typingEl.style.animation = null;
    }, 4000);
  }

  // Leaflet Map Initialization
  const mapContainer = document.getElementById('landing-map-container');
  if (mapContainer && window.L && !window._landingMap) {
    try {
      const map = L.map('landing-map-container', {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: false
      }).setView([17.3850, 78.4867], 13); // Hyderabad center

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
      }).addTo(map);

      // Add Demo Markers
      const demoMarkers = [
        { lat: 17.3850, lng: 78.4867, type: 'red', title: 'Road damage', text: 'Critical hazard • Ward 122<br>AI Confidence 96%' },
        { lat: 17.3950, lng: 78.4767, type: 'amber', title: 'Streetlight outage', text: 'In Progress • Ward 15' },
        { lat: 17.3750, lng: 78.4967, type: 'green', title: 'Garbage overflow', text: 'Resolved in 4 hrs' },
        { lat: 17.3890, lng: 78.4997, type: 'blue', title: 'Water leakage', text: 'Verified • Community Consensus' }
      ];

      demoMarkers.forEach(m => {
        const icon = L.divIcon({
          className: `pulsing-dot pulsing-dot-${m.type}`,
          iconSize: [12, 12]
        });
        L.marker([m.lat, m.lng], { icon })
          .addTo(map)
          .bindTooltip(`<strong>${m.title}</strong><br><span style="font-size:11px;color:var(--text-dim)">${m.text}</span>`);
      });

      window._landingMap = map;
    } catch (e) {
      console.warn("Landing map init failed", e);
    }
  }
}

function renderLanding() {
  if (window._landingMap) {
    window._landingMap.remove();
    window._landingMap = null;
  }

  app.innerHTML = `
    <div class="landing-page">
      <!-- Live AI Status Card -->
      <div class="live-ai-status-card">
        <div class="label-sm" style="margin-bottom:var(--space-2);display:flex;align-items:center;gap:4px">
          <span class="pulsing-dot pulsing-dot-green" style="width:8px;height:8px;display:inline-block"></span> AI Services
        </div>
        <ul>
          <li><span class="status-icon">${icons.check || '✓'}</span> Gemini Connected</li>
          <li><span class="status-icon">${icons.check || '✓'}</span> Grok Available</li>
          <li><span class="status-icon">${icons.check || '✓'}</span> Firestore Online</li>
          <li><span class="status-icon">${icons.check || '✓'}</span> Supabase Storage</li>
          <li><span class="status-icon">${icons.check || '✓'}</span> 7 Agents Running</li>
        </ul>
        <div style="font-size:9px;color:var(--text-dim);margin-top:var(--space-2);text-align:right">Last Updated: Just now</div>
      </div>

      <nav class="landing-nav">
        <div class="landing-nav-brand">
          <div class="sidebar-logo-icon" style="width:32px;height:32px;font-size:16px">C</div>
          CivicMind AI
        </div>
        <div class="landing-nav-links">
          <a href="#dashboard" onclick="navigate('dashboard')">Dashboard</a>
          <a href="#intelligence" onclick="navigate('intelligence')">Intelligence</a>
          <a href="#report" onclick="navigate('report')">Community</a>
          <a href="#admin" onclick="navigate('admin')">Governance</a>
          ${currentUser 
            ? `<a onclick="navigate('dashboard')" class="btn btn-primary btn-sm">Dashboard</a>` 
            : `<a onclick="navigate('login')" class="btn btn-secondary btn-sm">Sign In</a>`}
        </div>
      </nav>

      <!-- HERO SECTION -->
      <section class="hero">
        <div class="hero-badge">${icons.sparkle || ''} Now with Civic Intelligence Engine</div>
        <h1>Transform Communities Through<br>AI-Powered <span class="text-gradient">Civic Action</span></h1>
        
        <div class="typing-container" style="margin-bottom:var(--space-4)">
          <span class="typing-text" id="typing-text">Analyzing pothole reports...</span>
        </div>

        <p>Empower citizens and city officials with real-time intelligence, predictive analytics, and community-driven verification for smarter urban governance.</p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" onclick="navigate('${currentUser ? 'report' : 'signup'}')">Report an Issue →</button>
          <button class="btn btn-secondary btn-lg" onclick="navigate('${currentUser ? 'dashboard' : 'login'}')">Explore Community Map</button>
        </div>
        
        <div class="hero-visual glass-card" style="padding:0;overflow:hidden">
          <div id="landing-map-container"></div>
        </div>
      </section>

      <!-- CITY IMPACT STATS -->
      <section class="stats-section">
        <div style="text-align:center;margin-bottom:var(--space-4);font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Demo Statistics</div>
        <div class="grid grid-4 stagger-children">
          <div class="glass-card stat-card landing-stat">
            <div class="stat-value">34,582</div>
            <div class="stat-label">Issues Reported</div>
          </div>
          <div class="glass-card stat-card landing-stat">
            <div class="stat-value text-gradient">31,106</div>
            <div class="stat-label">Issues Resolved</div>
          </div>
          <div class="glass-card stat-card landing-stat">
            <div class="stat-value">96%</div>
            <div class="stat-label">AI Accuracy</div>
          </div>
          <div class="glass-card stat-card landing-stat">
            <div class="stat-value">18m</div>
            <div class="stat-label">Avg Response Time</div>
          </div>
        </div>
      </section>

      <!-- LIVE ACTIVITY FEED -->
      <section class="activity-feed-section">
        <div class="section-header">
          <h2>Live Community Activity</h2>
          <p>Real-time simulated civic events processed by CivicMind AI.</p>
        </div>
        <div class="activity-feed-list glass-card">
          <div class="activity-item">
            <div class="activity-time">2 min ago</div>
            <div class="activity-content">Citizen reported water leakage in Hyderabad</div>
            <div class="activity-status" style="color:var(--info)">AI Verified</div>
          </div>
          <div class="activity-item" style="animation-delay: 0.1s">
            <div class="activity-time">5 min ago</div>
            <div class="activity-content">Streetlight repaired in Ward 17</div>
            <div class="activity-status" style="color:var(--success)">Resolved</div>
          </div>
          <div class="activity-item" style="animation-delay: 0.2s">
            <div class="activity-time">9 min ago</div>
            <div class="activity-content">Garbage complaint routed</div>
            <div class="activity-status" style="color:var(--warning)">Assigned to Public Works</div>
          </div>
          <div class="activity-item" style="animation-delay: 0.3s">
            <div class="activity-time">15 min ago</div>
            <div class="activity-content">Road crack detected via Vision AI</div>
            <div class="activity-status" style="color:var(--primary-light)">Computer Vision</div>
          </div>
        </div>
      </section>

      <!-- AI PIPELINE VISUALIZATION -->
      <section class="ai-pipeline-section">
        <div class="section-header">
          <h2>7-Agent Intelligence Pipeline</h2>
          <p>How an issue flows from citizen capture to government resolution.</p>
        </div>
        <div class="pipeline-track">
          <div class="pipeline-node"><div class="pipeline-icon-wrap">📱</div><div class="pipeline-node-label">Citizen Reports</div></div>
          <div class="pipeline-arrow"></div>
          <div class="pipeline-node"><div class="pipeline-icon-wrap">👁️</div><div class="pipeline-node-label">Vision AI</div></div>
          <div class="pipeline-arrow"></div>
          <div class="pipeline-node"><div class="pipeline-icon-wrap">🧠</div><div class="pipeline-node-label">Classification</div></div>
          <div class="pipeline-arrow"></div>
          <div class="pipeline-node"><div class="pipeline-icon-wrap">🗺️</div><div class="pipeline-node-label">Geo Intel</div></div>
          <div class="pipeline-arrow"></div>
          <div class="pipeline-node"><div class="pipeline-icon-wrap">🏢</div><div class="pipeline-node-label">Gov Assignment</div></div>
          <div class="pipeline-arrow"></div>
          <div class="pipeline-node"><div class="pipeline-icon-wrap">✅</div><div class="pipeline-node-label">Resolution</div></div>
        </div>
      </section>

      <!-- FEATURES SECTION -->
      <section class="features-section">
        <div class="section-header">
          <h2>Platform Capabilities</h2>
        </div>
        <div class="grid grid-3 stagger-children">
          <div class="glass-card feature-card">
            <div class="feature-card-icon" style="background:rgba(126,86,218,0.2);color:var(--primary)">👁️</div>
            <h3>AI Vision Inspector</h3>
            <p>Detects potholes, environmental hazards, and infrastructure damage automatically from images.</p>
          </div>
          <div class="glass-card feature-card">
            <div class="feature-card-icon" style="background:rgba(0,210,255,0.2);color:var(--secondary)">🗺️</div>
            <h3>Geo Intelligence</h3>
            <p>Maps and clusters civic issues to identify hotspots and optimize routing for city workers.</p>
          </div>
          <div class="glass-card feature-card">
            <div class="feature-card-icon" style="background:rgba(16,185,129,0.2);color:var(--success)">✅</div>
            <h3>Community Verification</h3>
            <p>Builds trust through decentralized citizen validation and consensus trust scoring.</p>
          </div>
          <div class="glass-card feature-card">
            <div class="feature-card-icon" style="background:rgba(245,158,11,0.2);color:var(--warning)">📈</div>
            <h3>Predictive Infrastructure</h3>
            <p>Forecasts future civic failures based on historical data patterns and weather overlays.</p>
          </div>
          <div class="glass-card feature-card">
            <div class="feature-card-icon" style="background:rgba(126,86,218,0.2);color:var(--primary)">🤖</div>
            <h3>Multi-LLM Copilot</h3>
            <p>Powered by Gemini, Grok, and CivicMind Intelligence to answer complex queries.</p>
          </div>
          <div class="glass-card feature-card">
            <div class="feature-card-icon" style="background:rgba(0,210,255,0.2);color:var(--secondary)">📊</div>
            <h3>Resolution Analytics</h3>
            <p>Provides deep insights into government performance and response time metrics.</p>
          </div>
        </div>
      </section>

      <!-- HOW IT WORKS TIMELINE -->
      <section class="timeline-section">
        <div class="section-header">
          <h2>How It Works</h2>
        </div>
        <div class="timeline-container">
          <div class="timeline-item">
            <div class="timeline-number">1</div>
            <div class="timeline-content glass-card" style="width:100%">
              <h3>Capture</h3>
              <p>Citizen uploads photo/video of a civic issue.</p>
            </div>
          </div>
          <div class="timeline-item">
            <div class="timeline-number">2</div>
            <div class="timeline-content glass-card" style="width:100%">
              <h3>AI Analysis</h3>
              <p>Seven AI agents analyze severity, category, and location.</p>
            </div>
          </div>
          <div class="timeline-item">
            <div class="timeline-number">3</div>
            <div class="timeline-content glass-card" style="width:100%">
              <h3>Assignment & Resolution</h3>
              <p>Issue is routed to the exact department, workers execute the fix, and citizens are rewarded points.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- TESTIMONIALS -->
      <section class="testimonials-section">
        <div class="grid grid-3 stagger-children max-w-layout mx-auto" style="max-width:1200px;margin:0 auto">
          <div class="glass-card testimonial-card">
            <div style="color:var(--warning);margin-bottom:8px">★★★★★</div>
            <div class="testimonial-text">"The AI identified a dangerous pothole and the city repaired it within a day. Incredible transparency."</div>
            <div class="testimonial-author">Resident</div>
            <div class="testimonial-meta">Ward 122</div>
          </div>
          <div class="glass-card testimonial-card">
            <div style="color:var(--warning);margin-bottom:8px">★★★★★</div>
            <div class="testimonial-text">"I finally know the exact status of every complaint I submit. The Civic Reputation points are a great touch."</div>
            <div class="testimonial-author">Active Citizen</div>
            <div class="testimonial-meta">Hyderabad</div>
          </div>
          <div class="glass-card testimonial-card">
            <div style="color:var(--warning);margin-bottom:8px">★★★★★</div>
            <div class="testimonial-text">"Our department reduced response times by 40% thanks to the automated classification pipeline."</div>
            <div class="testimonial-author">Municipal Engineer</div>
            <div class="testimonial-meta">Public Works Dept</div>
          </div>
        </div>
      </section>

      <!-- COMMUNITY IMPACT COUNTERS -->
      <section class="impact-counters">
        <div class="grid grid-4 max-w-layout mx-auto" style="max-width:1000px;margin:0 auto">
          <div><div class="counter-value">8,402</div><div class="label-sm text-dim">Roads Improved</div></div>
          <div><div class="counter-value">12,105</div><div class="label-sm text-dim">Streetlights Fixed</div></div>
          <div><div class="counter-value">4,392</div><div class="label-sm text-dim">Water Leaks Resolved</div></div>
          <div><div class="counter-value">18,200</div><div class="label-sm text-dim">Waste Reports Closed</div></div>
        </div>
      </section>

      <!-- CTA SECTION -->
      <section class="cta-section" style="padding:var(--space-8) var(--space-6)">
        <div class="cta-card">
          <h2>Help Build a Smarter City</h2>
          <p>Become part of a transparent, AI-powered civic ecosystem.</p>
          <div style="margin-top:var(--space-4);display:flex;gap:var(--space-3);justify-content:center">
            <button class="btn btn-primary btn-lg" onclick="navigate('${currentUser ? 'report' : 'signup'}')">Report an Issue</button>
            <button class="btn btn-secondary btn-lg" onclick="navigate('${currentUser ? 'dashboard' : 'login'}')">Explore Community Map</button>
          </div>
        </div>
      </section>

      <!-- FOOTER -->
      <footer class="landing-footer">
        <div class="landing-footer-inner" style="align-items:flex-start">
          <div>
            <div class="landing-footer-brand" style="margin-bottom:var(--space-2)">CivicMind AI</div>
            <div style="font-size:12px;color:var(--text-dim);max-width:250px">The AI Operating System for Smart Cities.</div>
          </div>
          <div class="landing-footer-links">
            <a href="#">About</a>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">GitHub</a>
            <a href="#">Documentation</a>
            <a href="#">Contact</a>
          </div>
        </div>
        
        <div class="tech-stack-badges">
          <span class="tech-badge">Firebase</span>
          <span class="tech-badge">Firestore</span>
          <span class="tech-badge">Supabase Storage</span>
          <span class="tech-badge">Gemini AI</span>
          <span class="tech-badge">Grok AI</span>
          <span class="tech-badge">Multi-LLM Orchestrator</span>
          <span class="tech-badge">Google Maps</span>
        </div>
        
        <div style="margin-top:var(--space-6);font-size:12px;text-align:center;color:var(--text-dim);border-top:1px solid var(--glass-border);padding-top:var(--space-4)">
          © 2026 CivicMind AI. Empowering Urban Governance.
        </div>
      </footer>
    </div>`;

  setTimeout(() => initLandingAnimations(), 100);
}

function renderDashboard() {
  const isAdmin = currentProfile?.role === 'Administrator';
  if (isAdmin) {
    renderGovDashboard();
  } else {
    renderCitizenDashboard();
  }
}

function renderCitizenDashboard() {
  const stats = computeIssueStats(globalIssues);
  const userStats = computeIssueStats(globalUserIssues);
  const citizenScore = currentProfile?.citizenScore ?? 0;
  const scoreMax = 500;
  const repPct = reputationPercent(citizenScore, scoreMax);
  const scoreSpark = issuesSparklineByDay(globalUserIssues, 7);
  const activeSpark = issuesSparklineByDay(globalUserIssues.filter(i => i.status !== 'Resolved'), 7);
  const resolvedSpark = issuesSparklineByDay(globalUserIssues.filter(i => i.status === 'Resolved'), 7);
  const recentIssues = globalIssues.slice(0, 8); // could be global or user based on preference
  const mapIssueCount = globalIssues.filter(i => i.latitude && i.longitude).length;

  const hasMapContainer = document.getElementById('dashboard-map');

  if (hasMapContainer && getRoute() === 'dashboard') {
    // Selective update to preserve DOM elements and prevent Leaflet recreation
    const totalVal = document.getElementById('stat-my-reports-val');
    if (totalVal) totalVal.textContent = userStats.total;
    const activeVal = document.getElementById('stat-my-active-val');
    if (activeVal) activeVal.textContent = userStats.active;
    const resolvedVal = document.getElementById('stat-my-resolved-val');
    if (resolvedVal) resolvedVal.textContent = userStats.resolved;
    const scoreVal = document.getElementById('stat-citizen-score-val');
    if (scoreVal) scoreVal.textContent = citizenScore;

    const countPill = document.getElementById('map-count-pill');
    if (countPill) countPill.innerHTML = `<span class="dot"></span> ${mapIssueCount} mapped issue(s)`;

    // Update map filters chips
    const filtersContainer = document.querySelector('.map-filters');
    if (filtersContainer) {
      filtersContainer.innerHTML = `
        ${['Infrastructure', 'Safety', 'Environment'].map(c => `
          <button type="button" class="map-filter-chip ${mapFilters.categories.includes(c) ? 'active' : ''}" onclick="toggleMapFilter('category','${c}')">${c}</button>
        `).join('')}
        ${['low', 'medium', 'high', 'critical'].map(s => `
          <button type="button" class="map-filter-chip ${mapFilters.severities.includes(s) ? 'active' : ''}" onclick="toggleMapFilter('severity','${s}')">${s}</button>
        `).join('')}
        <button type="button" class="map-filter-chip ${mapFilters.showHeatmap ? 'active' : ''}" onclick="toggleMapFilter('showHeatmap')">Heatmap</button>
        <button type="button" class="map-filter-chip ${mapFilters.showHotspots ? 'active' : ''}" onclick="toggleMapFilter('showHotspots')">Hotspots</button>
        <button type="button" class="map-filter-chip ${mapFilters.showClustering ? 'active' : ''}" onclick="toggleMapFilter('showClustering')">Cluster</button>
      `;
    }

    // Update reputation card content
    const repCardContent = document.getElementById('dashboard-reputation-card-content');
    if (repCardContent) {
      repCardContent.innerHTML = `
        <div class="label-md" style="color:var(--text-dim);margin-bottom:var(--space-4);text-align:center">Civic Reputation</div>
        ${progressRing(citizenScore, scoreMax, 130, 'var(--primary-light)')}
        <div class="reputation-meta">${currentProfile?.badges?.length || 0} badge(s) earned · ${repPct}% progress</div>
        <div class="progress-bar" style="margin-top:var(--space-4)">
          <div class="progress-bar-fill" style="width:${repPct}%;background:linear-gradient(90deg,var(--primary),var(--secondary))"></div>
        </div>
      `;
    }

    // Update achievements badges
    const achievementsGrid = document.getElementById('dashboard-achievements-badge-grid');
    if (achievementsGrid) {
      achievementsGrid.innerHTML = renderProfileBadges(currentProfile?.badges || []);
    }

    // Update table body
    const tableBody = document.getElementById('dashboard-recent-reports-body');
    if (tableBody) {
      tableBody.innerHTML = recentIssues.length === 0 ? `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📋</div><div>No reports in Firestore yet</div><button class="btn btn-primary btn-sm" style="margin-top:var(--space-3)" onclick="navigate('report')">Submit first report</button></div></td></tr>` : recentIssues.map(r => `
        <tr class="table-row-hover">
          <td><span class="mono report-id">${escapeHtml(r.issueId || '—')}</span></td>
          <td>
            <div class="report-title-cell">${escapeHtml(r.title)}</div>
            <div class="report-desc-cell">${escapeHtml((r.description || '').slice(0, 60))}${(r.description || '').length > 60 ? '…' : ''}</div>
            ${renderMediaGallery(r, escapeHtml)}
          </td>
          <td><span class="category-tag">${escapeHtml(r.category || 'General')}</span></td>
          <td><span class="pill pill-${r.severity || 'medium'}"><span class="dot"></span> ${escapeHtml(r.severity || 'medium')}</span></td>
          <td><span class="pill pill-${statusPillClass(r.status)}"><span class="dot"></span> ${escapeHtml(r.status || 'Open')}</span></td>
          <td class="mono" style="font-size:11px;color:var(--text-dim)">${formatIssueDate(r.updatedAt || r.createdAt)}</td>
        </tr>
      `).join('');
    }

    // Update overlay mounts
    const cpMount = document.getElementById('command-palette-mount');
    if (cpMount) cpMount.innerHTML = renderCommandPalette();
    const notifMount = document.getElementById('notification-mount');
    if (notifMount) {
      const unread = unreadNotificationCount();
      notifMount.innerHTML = `
        <button class="topbar-icon-btn" title="Notifications" onclick="toggleNotificationPanel()">${icons.bell}${unread ? '<span class="badge">' + (unread > 9 ? '9+' : unread) + '</span>' : ''}</button>
        ${renderNotificationPanel()}
      `;
    }

    // Refresh map instance with updated data
    initMaps();
    return;
  }

  const content = `
    ${pageHeader('My Civic Dashboard', `Your civic contributions and community standing`,
       `<button class="btn btn-primary" onclick="navigate('report')">+ Report New Issue</button>`)}

    <div class="grid grid-4 stagger-children dashboard-stats">
      ${[
        { label: 'Citizen Score', id: 'stat-citizen-score-val', value: citizenScore, spark: scoreSpark, color: 'var(--secondary)', icon: '⭐' },
        { label: 'My Reports', id: 'stat-my-reports-val', value: userStats.total, spark: issuesSparklineByDay(globalUserIssues, 7), color: 'var(--primary)', icon: '📋' },
        { label: 'Active Issues', id: 'stat-my-active-val', value: userStats.active, spark: activeSpark, color: 'var(--warning)', icon: '⏳' },
        { label: 'Resolved Issues', id: 'stat-my-resolved-val', value: userStats.resolved, spark: resolvedSpark, color: 'var(--accent)', icon: '✅' },
      ].map(s => `
        <div class="glass-card stat-card stat-card-premium">
          <div class="stat-card-top">
            <div class="stat-label">${s.label}</div>
            <div class="stat-icon">${s.icon}</div>
          </div>
          <div class="stat-value" id="${s.id}" style="color:${s.color}">${s.value}</div>
          <div class="stat-change positive">${icons.arrowUp} Recent activity</div>
          ${sparkline(s.spark, s.color)}
        </div>
      `).join('')}
    </div>

    <div class="grid grid-2-1 dashboard-main" style="margin-bottom:var(--space-6)">
      <div class="glass-card map-card" style="padding:0;overflow:hidden">
        ${cardHeader('Nearby Issues Map', `<span class="pill pill-active" id="map-count-pill"><span class="dot"></span> ${mapIssueCount} mapped issue(s)</span>`)}
        <div class="map-filters">
          ${['Infrastructure', 'Safety', 'Environment'].map(c => `
            <button type="button" class="map-filter-chip ${mapFilters.categories.includes(c) ? 'active' : ''}" onclick="toggleMapFilter('category','${c}')">${c}</button>
          `).join('')}
          ${['low', 'medium', 'high', 'critical'].map(s => `
            <button type="button" class="map-filter-chip ${mapFilters.severities.includes(s) ? 'active' : ''}" onclick="toggleMapFilter('severity','${s}')">${s}</button>
          `).join('')}
          <button type="button" class="map-filter-chip ${mapFilters.showHeatmap ? 'active' : ''}" onclick="toggleMapFilter('showHeatmap')">Heatmap</button>
          <button type="button" class="map-filter-chip ${mapFilters.showHotspots ? 'active' : ''}" onclick="toggleMapFilter('showHotspots')">Hotspots</button>
          <button type="button" class="map-filter-chip ${mapFilters.showClustering ? 'active' : ''}" onclick="toggleMapFilter('showClustering')">Cluster</button>
        </div>
        <div class="map-wrapper">
          <div id="dashboard-map" class="map-container" style="height:440px;border-radius:0"></div>
          <div class="map-controls">
            <button type="button" class="map-control-btn" onclick="mapZoomIn()">+</button>
            <button type="button" class="map-control-btn" onclick="mapZoomOut()">−</button>
          </div>
        </div>
      </div>

      <div class="dashboard-sidebar-col">
        <div class="glass-card glass-card-glow reputation-card">
          <div id="dashboard-reputation-card-content">
            <div class="label-md" style="color:var(--text-dim);margin-bottom:var(--space-4);text-align:center">Civic Reputation</div>
            ${progressRing(citizenScore, scoreMax, 130, 'var(--primary-light)')}
            <div class="reputation-meta">${currentProfile?.badges?.length || 0} badge(s) earned · ${repPct}% progress</div>
            <div class="progress-bar" style="margin-top:var(--space-4)">
              <div class="progress-bar-fill" style="width:${repPct}%;background:linear-gradient(90deg,var(--primary),var(--secondary))"></div>
            </div>
          </div>
        </div>

        <div class="glass-card achievements-panel">
          ${cardHeader('Achievements')}
          <div class="badge-grid" id="dashboard-achievements-badge-grid" style="grid-template-columns:repeat(2,1fr)">
            ${renderProfileBadges(currentProfile?.badges || [])}
          </div>
        </div>
      </div>
    </div>

    <div class="glass-card reports-table-card" style="padding:0;overflow:hidden">
      ${cardHeader('Community Reports Feed', `<span class="mono" style="font-size:11px;color:var(--text-dim)">${stats.total} total</span>`)}
      <div class="table-scroll">
        <table class="data-table data-table-premium">
          <thead><tr><th>ID</th><th>Issue</th><th>Category</th><th>Severity</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody id="dashboard-recent-reports-body">
            ${recentIssues.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">📋</div><div>No reports in your community yet</div><button class="btn btn-primary btn-sm" style="margin-top:var(--space-3)" onclick="navigate('report')">Submit first report</button></div></td></tr>` : recentIssues.map(r => `
              <tr class="table-row-hover">
                <td><span class="mono report-id">${escapeHtml(r.issueId || '—')}</span></td>
                <td>
                  <div class="report-title-cell">${escapeHtml(r.title)}</div>
                  <div class="report-desc-cell">${escapeHtml((r.description || '').slice(0, 60))}${(r.description || '').length > 60 ? '…' : ''}</div>
                  ${renderMediaGallery(r, escapeHtml)}
                </td>
                <td><span class="category-tag">${escapeHtml(r.category || 'General')}</span></td>
                <td><span class="pill pill-${r.severity || 'medium'}"><span class="dot"></span> ${escapeHtml(r.severity || 'medium')}</span></td>
                <td><span class="pill pill-${statusPillClass(r.status)}"><span class="dot"></span> ${escapeHtml(r.status || 'Open')}</span></td>
                <td class="mono" style="font-size:11px;color:var(--text-dim)">${formatIssueDate(r.updatedAt || r.createdAt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  app.innerHTML = dashboardLayout('dashboard', 'Dashboard', 'My City', content);
  
  // Initialize map after full render
  setTimeout(() => initMaps(), 100);
}

function renderGovDashboard() {
  const stats = computeIssueStats(globalIssues);
  const topCat = topCategoryInsight(globalIssues);
  const peakHour = peakHourFromIssues(globalIssues);
  const totalSpark = issuesSparklineByDay(globalIssues, 7);
  const activeSpark = issuesSparklineByDay(globalIssues.filter(i => i.status !== 'Resolved'), 7);
  const resolvedSpark = issuesSparklineByDay(globalIssues.filter(i => i.status === 'Resolved'), 7);
  const criticalSpark = issuesSparklineByDay(globalIssues.filter(i => i.severity === 'critical'), 7);
  const recentIssues = globalIssues.slice(0, 8);
  const mapIssueCount = globalIssues.filter(i => i.latitude && i.longitude).length;
  const deptHealth = computeDeptWorkload(globalIssues);
  const deptColors = { 'Public Works': 'var(--primary)', 'Safety & Traffic': 'var(--secondary)', 'Waste Management': 'var(--warning)', 'Environment': 'var(--accent)', 'General': 'var(--info)' };
  const maxDept = Math.max(...Object.values(deptHealth), 1);
  const escalation = buildEscalationChain(globalIssues);

  const hasMapContainer = document.getElementById('dashboard-map');

  if (hasMapContainer && getRoute() === 'dashboard') {
    // Selective update to preserve DOM elements and prevent Leaflet recreation
    const totalVal = document.getElementById('stat-total-issues-val');
    if (totalVal) totalVal.textContent = stats.total;
    const activeVal = document.getElementById('stat-active-issues-val');
    if (activeVal) activeVal.textContent = stats.active;
    const resolvedVal = document.getElementById('stat-resolved-val');
    if (resolvedVal) resolvedVal.textContent = stats.resolved;
    const criticalVal = document.getElementById('stat-critical-val');
    if (criticalVal) criticalVal.textContent = stats.critical;

    const countPill = document.getElementById('map-count-pill');
    if (countPill) countPill.innerHTML = `<span class="dot"></span> ${mapIssueCount} mapped issue(s)`;

    // Update map filters chips
    const filtersContainer = document.querySelector('.map-filters');
    if (filtersContainer) {
      filtersContainer.innerHTML = `
        ${['Public Works', 'Safety & Traffic', 'Environment', 'General'].map(d => `
          <button type="button" class="map-filter-chip ${(mapFilters.departments || []).includes(d) ? 'active' : ''}" onclick="toggleMapFilter('department','${d}')">${d}</button>
        `).join('')}
        ${['low', 'medium', 'high', 'critical'].map(s => `
          <button type="button" class="map-filter-chip ${mapFilters.severities.includes(s) ? 'active' : ''}" onclick="toggleMapFilter('severity','${s}')">${s}</button>
        `).join('')}
        <button type="button" class="map-filter-chip ${mapFilters.showHeatmap ? 'active' : ''}" onclick="toggleMapFilter('showHeatmap')">Heatmap</button>
        <button type="button" class="map-filter-chip ${mapFilters.showClustering ? 'active' : ''}" onclick="toggleMapFilter('showClustering')">Cluster</button>
      `;
    }

    // Update analytics insights list
    const insightsList = document.getElementById('dashboard-insights-list');
    if (insightsList) {
      insightsList.innerHTML = `
        ${topCat ? insightCard('📈', 'Top Reported Category', `${escapeHtml(topCat.category)} leads with ${topCat.count} report(s).`, `<button class="btn btn-secondary btn-sm" style="margin-top:var(--space-3)" onclick="navigate('intelligence')">View Trends</button>`, 'purple') : insightCard('📈', 'No Reports Yet', 'Waiting for reports.', '', 'purple')}
        <div class="peak-hour-widget">
          <span>🕐</span>
          <div>
            <div class="label-sm">Peak Incident Hour</div>
            <div style="font-size:14px;font-weight:600;margin-top:2px">${peakHour || 'Insufficient data'}</div>
          </div>
        </div>
      `;
    }

    // Update table body
    const tableBody = document.getElementById('dashboard-recent-reports-body');
    if (tableBody) {
      tableBody.innerHTML = recentIssues.length === 0 ? `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📋</div><div>No reports in Firestore yet</div></div></td></tr>` : recentIssues.map(r => `
        <tr class="table-row-hover">
          <td><span class="mono report-id">${escapeHtml(r.issueId || '—')}</span></td>
          <td>
            <div class="report-title-cell">${escapeHtml(r.title)}</div>
            <div class="report-desc-cell">${escapeHtml((r.description || '').slice(0, 60))}${(r.description || '').length > 60 ? '…' : ''}</div>
          </td>
          <td><span class="category-tag">${escapeHtml(r.category || 'General')}</span></td>
          <td><span class="pill pill-${r.severity || 'medium'}"><span class="dot"></span> ${escapeHtml(r.severity || 'medium')}</span></td>
          <td style="font-size:12px;color:var(--text-muted)">${escapeHtml(r.department || DEPARTMENT_BY_CATEGORY[r.category] || 'General')}</td>
          <td><span class="pill pill-${statusPillClass(r.status)}"><span class="dot"></span> ${escapeHtml(r.status || 'Open')}</span></td>
          <td class="mono" style="font-size:11px;color:var(--text-dim)">${formatIssueDate(r.updatedAt || r.createdAt)}</td>
        </tr>
      `).join('');
    }

    // Update overlay mounts
    const cpMount = document.getElementById('command-palette-mount');
    if (cpMount) cpMount.innerHTML = renderCommandPalette();
    const notifMount = document.getElementById('notification-mount');
    if (notifMount) {
      const unread = unreadNotificationCount();
      notifMount.innerHTML = `
        <button class="topbar-icon-btn" title="Notifications" onclick="toggleNotificationPanel()">${icons.bell}${unread ? '<span class="badge">' + (unread > 9 ? '9+' : unread) + '</span>' : ''}</button>
        ${renderNotificationPanel()}
      `;
    }

    // Refresh map instance with updated data
    initMaps();
    return;
  }

  const content = `
    ${pageHeader('Operations Dashboard', `Monitoring ${stats.total} live report(s) across city departments`,
      `<button class="btn btn-primary" onclick="navigate('admin')">Manage Issues</button>`)}

    <div class="grid grid-4 stagger-children dashboard-stats">
      ${[
        { label: 'Total Reports', id: 'stat-total-issues-val', value: stats.total, spark: totalSpark, color: 'var(--primary)', icon: '📋' },
        { label: 'Pending Issues', id: 'stat-active-issues-val', value: stats.active, spark: activeSpark, color: 'var(--warning)', icon: '⏳' },
        { label: 'Critical Esc.', id: 'stat-critical-val', value: stats.critical, spark: criticalSpark, color: 'var(--danger)', icon: '🔴' },
        { label: 'Resolved', id: 'stat-resolved-val', value: stats.resolved, spark: resolvedSpark, color: 'var(--accent)', icon: '✅' },
      ].map(s => `
        <div class="glass-card stat-card stat-card-premium">
          <div class="stat-card-top">
            <div class="stat-label">${s.label}</div>
            <div class="stat-icon">${s.icon}</div>
          </div>
          <div class="stat-value" id="${s.id}" style="color:${s.color}">${s.value}</div>
          <div class="stat-change positive">${icons.arrowUp} Live sync</div>
          ${sparkline(s.spark, s.color)}
        </div>
      `).join('')}
    </div>

    <div class="grid grid-2-1 dashboard-main" style="margin-bottom:var(--space-6)">
      <div class="glass-card map-card" style="padding:0;overflow:hidden">
        ${cardHeader('Operations Intelligence Map', `<span class="pill pill-active" id="map-count-pill"><span class="dot"></span> ${mapIssueCount} mapped issue(s)</span>`)}
        <div class="map-filters">
          ${['Public Works', 'Safety & Traffic', 'Environment', 'General'].map(d => `
            <button type="button" class="map-filter-chip ${(mapFilters.departments || []).includes(d) ? 'active' : ''}" onclick="toggleMapFilter('department','${d}')">${d}</button>
          `).join('')}
          ${['low', 'medium', 'high', 'critical'].map(s => `
            <button type="button" class="map-filter-chip ${mapFilters.severities.includes(s) ? 'active' : ''}" onclick="toggleMapFilter('severity','${s}')">${s}</button>
          `).join('')}
          <button type="button" class="map-filter-chip ${mapFilters.showHeatmap ? 'active' : ''}" onclick="toggleMapFilter('showHeatmap')">Heatmap</button>
          <button type="button" class="map-filter-chip ${mapFilters.showClustering ? 'active' : ''}" onclick="toggleMapFilter('showClustering')">Cluster</button>
        </div>
        <div class="map-wrapper">
          <div id="dashboard-map" class="map-container" style="height:440px;border-radius:0"></div>
          <div class="map-controls">
            <button type="button" class="map-control-btn" onclick="mapZoomIn()">+</button>
            <button type="button" class="map-control-btn" onclick="mapZoomOut()">−</button>
          </div>
        </div>
      </div>

      <div class="dashboard-sidebar-col">
        <div class="glass-card">
          ${cardHeader('Department Performance')}
          <div class="dept-list">
            ${Object.keys(deptHealth).length ? Object.entries(deptHealth).map(([dept, count]) =>
              deptWidget(dept, count, Math.round((count / maxDept) * 100), deptColors[dept] || 'var(--primary)')
            ).join('') : '<div class="empty-state">No assigned workloads yet</div>'}
          </div>
        </div>

        <div class="glass-card insights-panel">
          ${cardHeader('System Alerts', '<button class="btn btn-ghost btn-sm" onclick="navigate(\'intelligence\')">Intelligence</button>')}
          <div class="insights-list" id="dashboard-insights-list">
            ${topCat ? insightCard('📈', 'Top Reported Category', `${escapeHtml(topCat.category)} leads with ${topCat.count} report(s).`, `<button class="btn btn-secondary btn-sm" style="margin-top:var(--space-3)" onclick="navigate('intelligence')">View Trends</button>`, 'purple') : insightCard('📈', 'No Reports Yet', 'Waiting for reports.', '', 'purple')}
            <div class="peak-hour-widget">
              <span>🕐</span>
              <div>
                <div class="label-sm">Peak Incident Hour</div>
                <div style="font-size:14px;font-weight:600;margin-top:2px">${peakHour || 'Insufficient data'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="glass-card reports-table-card" style="padding:0;overflow:hidden">
      ${cardHeader('Incoming Incident Queue', `<span class="mono" style="font-size:11px;color:var(--text-dim)">${stats.total} total</span>`)}
      <div class="table-scroll">
        <table class="data-table data-table-premium">
          <thead><tr><th>ID</th><th>Issue</th><th>Category</th><th>Severity</th><th>Department</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody id="dashboard-recent-reports-body">
            ${recentIssues.length === 0 ? `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📋</div><div>No reports in Firestore yet</div></div></td></tr>` : recentIssues.map(r => `
              <tr class="table-row-hover">
                <td><span class="mono report-id">${escapeHtml(r.issueId || '—')}</span></td>
                <td>
                  <div class="report-title-cell">${escapeHtml(r.title)}</div>
                  <div class="report-desc-cell">${escapeHtml((r.description || '').slice(0, 60))}${(r.description || '').length > 60 ? '…' : ''}</div>
                </td>
                <td><span class="category-tag">${escapeHtml(r.category || 'General')}</span></td>
                <td><span class="pill pill-${r.severity || 'medium'}"><span class="dot"></span> ${escapeHtml(r.severity || 'medium')}</span></td>
                <td style="font-size:12px;color:var(--text-muted)">${escapeHtml(r.department || DEPARTMENT_BY_CATEGORY[r.category] || 'General')}</td>
                <td><span class="pill pill-${statusPillClass(r.status)}"><span class="dot"></span> ${escapeHtml(r.status || 'Open')}</span></td>
                <td class="mono" style="font-size:11px;color:var(--text-dim)">${formatIssueDate(r.updatedAt || r.createdAt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  app.innerHTML = dashboardLayout('dashboard', 'Dashboard', 'Operations', content);
  
  // Initialize map after full render
  setTimeout(() => initMaps(), 100);
}

window.executeReportSubmit = async (e) => {
  e.preventDefault();
  const title = document.getElementById('rep-title').value.trim();
  const desc = document.getElementById('rep-desc').value.trim();
  const cat = document.getElementById('rep-cat').value;
  const severity = document.getElementById('rep-severity').value;
  const loc = document.getElementById('rep-loc').value.trim();
  const latVal = document.getElementById('rep-lat')?.value;
  const lngVal = document.getElementById('rep-lng')?.value;
  const latitude = latVal !== '' && latVal != null ? parseFloat(latVal) : null;
  const longitude = lngVal !== '' && lngVal != null ? parseFloat(lngVal) : null;
  const submitBtn = e.target.querySelector('[type="submit"]');

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading evidence…';
    }

    const preIssueId = `ISS-${Date.now()}`;

    if (submitBtn) {
      submitBtn.textContent = isStorageEnabled() ? 'Uploading evidence…' : 'Submitting report…';
    }

    const media = await resolveReportMedia(currentUser.uid, preIssueId, pendingReportMedia);
    if (media.infoMessage) showInfo(media.infoMessage);

    if (submitBtn) submitBtn.textContent = 'Running agent pipeline…';

    // Use capturedLocation from the geolocation service, fall back to form hidden fields
    const finalLat = Number.isFinite(capturedLocation.latitude) ? capturedLocation.latitude
      : (Number.isFinite(latitude) ? latitude : null);
    const finalLng = Number.isFinite(capturedLocation.longitude) ? capturedLocation.longitude
      : (Number.isFinite(longitude) ? longitude : null);

    const { docId, issueId } = await submitIssue({
      issueId: preIssueId,
      title,
      description: desc,
      category: cat,
      severity,
      location: loc,
      uid: currentUser.uid,
      reporterName: currentProfile?.name || currentUser.displayName || 'Anonymous',
      reporterEmail: currentProfile?.email || currentUser.email || 'N/A',
      // Core GPS
      latitude: finalLat,
      longitude: finalLng,
      // Extended geolocation
      locationAccuracy: capturedLocation.locationAccuracy ?? null,
      altitude: capturedLocation.altitude ?? null,
      heading: capturedLocation.heading ?? null,
      speed: capturedLocation.speed ?? null,
      locationCapturedAt: capturedLocation.locationCapturedAt ?? null,
      // Reverse geocoded address
      locationAddress: capturedLocation.locationAddress ?? null,
      formattedAddress: capturedLocation.formattedAddress ?? null,
      city: capturedLocation.city ?? null,
      state: capturedLocation.state ?? null,
      country: capturedLocation.country ?? null,
      postalCode: capturedLocation.postalCode ?? null,
      // Media
      imageUrls: media.imageUrls,
      videoUrls: media.videoUrls,
      audioUrls: media.audioUrls,
      trustScore: 5.0,
    });

    if (media.storageUsed && (media.imageUrls.length || media.videoUrls.length || media.audioUrls.length)) {
      await updateIssueMedia(docId, {
        imageUrls: media.imageUrls,
        videoUrls: media.videoUrls,
        audioUrls: media.audioUrls,
      });
    }

    const pipelineImageUrl = media.pipelineImageUrl || media.imageUrls[0] || null;

    await createNotification({
      userId: currentUser.uid,
      role: 'Citizen',
      issueId,
      type: 'issue_submitted',
      message: `Your report ${issueId} was submitted successfully. The agent pipeline is processing your issue.`,
    });

    await runIssueAgentPipeline({
      issue: {
        docId,
        issueId,
        title,
        description: desc,
        category: cat,
        severity,
        location: loc,
        latitude: finalLat,
        longitude: finalLng,
        locationAddress: capturedLocation.locationAddress ?? null,
        city: capturedLocation.city ?? null,
        state: capturedLocation.state ?? null,
        imageUrl: pipelineImageUrl,
        imageUrls: media.imageUrls,
        videoUrls: media.videoUrls,
        audioUrls: media.audioUrls,
        createdBy: currentUser.uid,
        status: 'Open',
      },
      reporterProfile: currentProfile,
      allIssues: globalIssues,
    }).catch(err => {
      if (err.code === 'permission-denied' || String(err).includes('permission')) {
        console.warn('Agent pipeline ran locally, but citizen role prevents direct updating of issue protected fields. (Expected behavior)');
      } else {
        throw err;
      }
    });

    await createNotification({
      userId: currentUser.uid,
      role: 'Citizen',
      issueId,
      type: 'pipeline_complete',
      message: `Agent pipeline completed for ${issueId}. Check notifications for routing updates.`,
    });

    if (currentProfile?.role === 'Administrator') {
      await createNotification({
        userId: currentUser.uid,
        role: 'Administrator',
        issueId,
        type: 'admin_new_issue',
        message: `New issue submitted: ${issueId} — ${title}`,
      });
    }

    pendingReportMedia = { images: [], video: null, audio: null };
    capturedLocation = { ...EMPTY_LOCATION };
    showSuccess(`Report ${issueId} submitted and processed`);
    navigate('dashboard');
  } catch (err) {
    handleAppError(err, 'Failed to submit report');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit to Registry →';
    }
  }
};

function renderUserReportsTable(issues, emptyMessage = 'No reports submitted yet') {
  if (!issues.length) {
    return `<div class="empty-state" style="padding:var(--space-6)">${emptyMessage}</div>`;
  }
  return `
    <div class="table-scroll">
      <table class="data-table data-table-premium">
        <thead><tr><th>ID</th><th>Title</th><th>Category</th><th>Severity</th><th>Status</th><th>Submitted</th></tr></thead>
        <tbody>
          ${issues.slice(0, 10).map(r => `
            <tr>
              <td><span class="mono report-id">${escapeHtml(r.issueId || '—')}</span></td>
              <td><div class="report-title-cell">${escapeHtml(r.title)}</div></td>
              <td><span class="category-tag">${escapeHtml(r.category || 'General')}</span></td>
              <td><span class="pill pill-${r.severity || 'medium'}">${escapeHtml(r.severity || 'medium')}</span></td>
              <td><span class="pill pill-${statusPillClass(r.status)}">${escapeHtml(r.status || 'Open')}</span></td>
              <td class="mono" style="font-size:11px;color:var(--text-dim)">${formatIssueDate(r.createdAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderReport() {
  const trustPct = avgUserTrustPercent(globalUserIssues, currentProfile);

  const content = `
    ${pageHeader('Report New Issue', 'Submit urban issues for AI verification and community routing')}
    ${reportStepper(4)}

    <div class="grid grid-2-3 report-layout">
      <div class="report-main-col">
        <div class="grid grid-2" style="margin-bottom:var(--space-5)">
          <div class="glass-card upload-card">
            ${cardHeader('1. Add Media')}
            <div class="upload-tabs">
              <button type="button" class="upload-tab ${currentReportUploadTab === 'images' ? 'active' : ''}" onclick="setReportUploadTab('images')">${icons.camera} Image</button>
              <button type="button" class="upload-tab ${currentReportUploadTab === 'videos' ? 'active' : ''}" onclick="setReportUploadTab('videos')">${icons.video} Video</button>
              <button type="button" class="upload-tab ${currentReportUploadTab === 'audio' ? 'active' : ''}" onclick="setReportUploadTab('audio')">${icons.mic} Voice</button>
            </div>
            <div class="upload-zone" onclick="document.getElementById('rep-media').click()">
              <input type="file" id="rep-media" accept="${currentReportUploadTab === 'images' ? 'image/*' : currentReportUploadTab === 'videos' ? 'video/*' : 'audio/*'}" ${currentReportUploadTab === 'images' ? 'multiple' : ''} style="display:none" onchange="handleReportMediaSelect(event)" />
              <div class="upload-zone-icon">${icons.upload}</div>
              <div style="font-weight:500;color:var(--text-secondary)" id="upload-status-label">${currentReportUploadTab === 'images' ? 'Tap to upload images (up to 5)' : currentReportUploadTab === 'videos' ? 'Tap to upload video evidence' : 'Tap to record or upload voice note'}</div>
              <div style="font-size:12px;color:var(--text-dim)">Securely uploaded and verified</div>
              <div id="upload-preview" class="media-gallery" style="margin-top:var(--space-3)"></div>
            </div>
          </div>

          <div class="glass-card ai-classify-card">
            ${cardHeader('AI Pre-Analysis', '<span class="pill pill-active"><span class="dot"></span> AI Active</span>')}
            <div class="classify-status">Our AI instantly analyzes your media to pre-fill details.</div>
            <div class="classify-field">
              <span class="label-sm">Detected Category</span>
              <span class="category-tag category-tag-lg" id="classify-category">Pending</span>
            </div>
            <div class="classify-field">
              <span class="label-sm">Estimated Severity</span>
              <div id="classify-severity-wrap">${severityGauge('low')}</div>
            </div>
            <p class="ai-reasoning">Full analysis runs automatically after submission to alert authorities.</p>
          </div>
        </div>

        <form class="report-form" onsubmit="executeReportSubmit(event)">
          <input type="hidden" id="rep-lat" value="" />
          <input type="hidden" id="rep-lng" value="" />

          <div class="grid grid-2" style="margin-bottom:var(--space-5)">
            <div class="glass-card">
              ${cardHeader('2. Location', '<button type="button" class="btn btn-ghost btn-sm" onclick="initReportGeolocation()" title="Retry location">🔄 Retry</button>')}
              <div class="geo-preview">
                <div class="geo-map-mini"></div>
                <div class="geo-info">
                  <div style="font-weight:500;font-size:13px" id="geo-address-display">Detecting location…</div>
                  <div class="mono" style="font-size:11px;color:var(--text-dim);margin-top:4px" id="geo-coords-display">Waiting for device GPS</div>
                  <div class="mono" style="font-size:10px;color:var(--text-dim);margin-top:2px" id="geo-accuracy-display"></div>
                </div>
              </div>
              <input type="text" id="rep-loc" class="input-field" placeholder="Additional location notes" style="margin-top:var(--space-3)"/>
            </div>

            <div class="glass-card">
              ${cardHeader('3. Incident Details')}
              <div style="margin-bottom:var(--space-3)">
                <label class="label-sm" style="display:block;margin-bottom:var(--space-2)">Title</label>
                <input type="text" id="rep-title" class="input-field" placeholder="Brief issue title" required/>
              </div>
              <div style="margin-bottom:var(--space-3)">
                <label class="label-sm" style="display:block;margin-bottom:var(--space-2)">Category</label>
                <select id="rep-cat" class="input-field">
                  <option>Infrastructure</option><option>Safety</option><option>Environment</option>
                </select>
              </div>
              <div>
                <label class="label-sm" style="display:block;margin-bottom:var(--space-2)">Severity</label>
                <select id="rep-severity" class="input-field">
                  <option value="low">Low</option>
                  <option value="medium" selected>Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
          </div>

          <div class="glass-card" style="margin-bottom:var(--space-5)">
            ${cardHeader('4. Description')}
            <textarea id="rep-desc" class="input-field" rows="4" placeholder="Describe the issue in detail to help the community verify it…" required></textarea>
          </div>

          <div class="glass-card validation-card" style="margin-bottom:var(--space-5)">
            ${cardHeader('Community Trust')}
            ${trustScorePanel(trustPct)}
          </div>

          <div class="report-actions">
            <button type="button" class="btn btn-secondary" onclick="navigate('dashboard')">Cancel</button>
            <button type="submit" class="btn btn-primary btn-lg">Submit Report →</button>
          </div>
        </form>

        <div class="glass-card" style="padding:0;overflow:hidden;margin-top:var(--space-5)">
          ${cardHeader('Your Recent Reports', `<span class="mono" style="font-size:11px;color:var(--text-dim)">${globalUserIssues.length} total</span>`)}
          ${renderUserReportsTable(globalUserIssues)}
        </div>
      </div>

      <div class="report-ai-col">
        <div class="glass-card ai-analysis-panel">
          ${cardHeader('Submission Checklist')}
          <div class="ai-scan-status">
            <p class="body-md" style="color:var(--text-secondary);font-size:13px;line-height:1.6;margin-bottom:var(--space-4)">
              Ensure all details are accurate. False reports negatively impact your Civic Trust Score.
            </p>
            <div class="scan-item">
              <span>Media Uploaded</span>
              <span class="pill pill-processing" id="scan-media-status"><span class="dot"></span> Pending</span>
            </div>
            <div class="scan-item">
              <span>Location Captured</span>
              <span class="pill pill-processing" id="scan-geo-status"><span class="dot"></span> Pending</span>
            </div>
            <div class="scan-item">
              <span>Form Complete</span>
              <span class="pill pill-resolved">Ready</span>
            </div>
          </div>
        </div>
        ${aiCopilotPanel('Report Assistant', [
          { role: 'ai', text: 'Hi! I am your AI assistant. Upload a photo and I will help categorize your report automatically.' },
        ], 'report-copilot')}
      </div>
    </div>
  `;
  app.innerHTML = dashboardLayout('report', 'Report Issue', 'My City', content);
  
  // Initialize map and geolocation after report view renders
  setTimeout(() => {
    initMaps();
    initReportGeolocation();
    initReportFormBindings();
  }, 100);
}

function renderIntelligence() {
  const isAdmin = currentProfile?.role === 'Administrator';
  if (isAdmin) {
    renderGovIntelligence();
  } else {
    renderCitizenIntelligence();
  }
}

function renderCitizenIntelligence() {
  const stats = computeIssueStats(globalIssues);
  const categories = computeCategoryCounts(globalIssues);
  const trendBars = Object.entries(categories).map(([label, value]) => ({ label, value }));
  if (!trendBars.length) trendBars.push({ label: 'No data', value: 0 });
  const criticalIssues = globalIssues.filter(i => i.severity === 'critical' && i.status !== 'Resolved');
  const latestCritical = criticalIssues[0];
  const activeCount = stats.active;
  const recentResolved = globalIssues.filter(i => i.status === 'Resolved').length;

  const content = `
    ${pageHeader("What's Happening Near You", `Live community updates based on ${stats.total} total reports`,
      '<button class="btn btn-primary btn-sm" onclick="navigate(\'report\')">Report Issue</button>')}

    <div class="grid grid-4 stagger-children" style="margin-bottom:var(--space-6)">
      ${[
        { label: 'Active Issues', value: activeCount, sub: 'In your community', color: 'var(--primary)' },
        { label: 'Recently Resolved', value: recentResolved, sub: 'Community improvements', color: 'var(--accent)' },
        { label: 'Critical Alerts', value: stats.critical, sub: 'Safety warnings', color: 'var(--danger)' },
        { label: 'My Contributions', value: globalUserIssues.length, sub: 'Reports submitted', color: 'var(--secondary)' },
      ].map(m => `
        <div class="glass-card stat-card stat-card-premium">
          <div class="stat-label">${m.label}</div>
          <div class="stat-value" style="color:${m.color}">${m.value}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${m.sub}</div>
        </div>
      `).join('')}
    </div>

    <div class="grid grid-2-1" style="margin-bottom:var(--space-6)">
      <div class="glass-card heatmap-card" style="padding:0;overflow:hidden;min-height:380px">
        ${cardHeader('Community Incident Density', `<span class="pill pill-active"><span class="dot"></span> ${globalIssues.filter(i => i.latitude && i.longitude).length} mapped</span>`)}
        <div class="heatmap-container">
          <div class="heatmap-gradient"></div>
          <div class="heatmap-grid"></div>
          <div class="heatmap-legend">
            <span><span class="legend-dot" style="background:var(--accent)"></span> Quiet</span>
            <span><span class="legend-dot" style="background:var(--danger)"></span> Active</span>
          </div>
          <button class="btn btn-primary btn-sm heatmap-cta" onclick="navigate('dashboard')">View Detailed Map</button>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="glass-card prediction-card glass-card-glow">
          ${cardHeader('Safety Alerts')}
          <div class="prediction-alert">
            ${latestCritical ? `
              <div class="prediction-alert-header">
                <span style="font-weight:600">${escapeHtml(latestCritical.title)}</span>
                <span class="pill pill-critical"><span class="dot"></span> Critical</span>
              </div>
              <p class="body-md" style="color:var(--text-muted);font-size:13px;margin:var(--space-3) 0">${escapeHtml((latestCritical.description || '').slice(0, 120))}</p>
            ` : '<p class="body-md" style="color:var(--text-muted);padding:var(--space-4)">No immediate safety alerts in your area.</p>'}
          </div>
        </div>

        <div class="glass-card">
          ${cardHeader('Trending Issues')}
          <div class="trend-list">
            ${trendBars.map((t, i) => {
              const colors = ['var(--secondary)', 'var(--primary)', 'var(--accent)', 'var(--danger)', 'var(--warning)'];
              const max = Math.max(...trendBars.map(b => b.value), 1);
              return `
                <div class="trend-item">
                  <div class="trend-item-header">
                    <span>${escapeHtml(t.label)}</span>
                    <span class="mono" style="font-size:12px;color:var(--text-muted)">${t.value} reports</span>
                  </div>
                  <div class="progress-bar"><div class="progress-bar-fill" style="width:${(t.value/max)*100}%;background:${colors[i % colors.length]}"></div></div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2-1" style="margin-bottom:var(--space-6)">
      ${aiCopilotPanel('Civic Assistant Copilot', [], 'intelligence-copilot')}
      <div class="glass-card">
        ${cardHeader('Example Questions')}
        <div style="display:flex;flex-direction:column;gap:var(--space-2);padding:0 var(--space-5) var(--space-5)">
          ${[
            'What are the most common issues near me?',
            'Are there any safety alerts today?',
            'How can I volunteer for the community?',
            'What is the status of my recent report?',
            'Summarize today\'s community updates.',
          ].map(q => `
            <button type="button" class="btn btn-secondary btn-sm" style="text-align:left;justify-content:flex-start"
              onclick="document.getElementById('intelligence-copilot-input').value=${escapeHtml(JSON.stringify(q))};document.getElementById('intelligence-copilot-input').focus()">
              ${escapeHtml(q)}
            </button>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="glass-card recommended-action glass-card-glow">
      <div class="recommended-action-inner">
        <div class="recommended-action-icon">${icons.sparkle}</div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
            <span class="headline-sm">Recommended Action</span>
          </div>
          <p class="body-md" style="color:var(--text-muted);font-size:14px">Stay engaged with your community. Track your reports, verify issues, or submit new ones.</p>
          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
            <button class="btn btn-primary" onclick="navigate('dashboard')">Track My Reports</button>
            <button class="btn btn-secondary" onclick="navigate('report')">Report Another Issue</button>
          </div>
        </div>
      </div>
    </div>
  `;
  app.innerHTML = dashboardLayout('intelligence', 'Community', 'My City', content);
}

function renderGovIntelligence() {
  const stats = computeIssueStats(globalIssues);
  const categories = computeCategoryCounts(globalIssues);
  const trendBars = Object.entries(categories).map(([label, value]) => ({ label, value }));
  if (!trendBars.length) trendBars.push({ label: 'No data', value: 0 });
  const criticalIssues = globalIssues.filter(i => i.severity === 'critical' && i.status !== 'Resolved');
  const latestCritical = criticalIssues[0];
  const resolvedRate = stats.total ? Math.round((stats.resolved / stats.total) * 100) : 0;
  const weekdayBars = issuesByWeekday(globalIssues);
  const deptCounts = computeDeptWorkload(globalIssues);
  const deptHealth = Object.entries(deptCounts).map(([name, count]) => {
    const deptIssues = globalIssues.filter(i => (i.department || DEPARTMENT_BY_CATEGORY[i.category] || 'General') === name);
    const resolved = deptIssues.filter(i => i.status === 'Resolved').length;
    const health = deptIssues.length ? Math.round((resolved / deptIssues.length) * 100) : 0;
    return { name, health, count, status: health >= 70 ? 'good' : 'warning' };
  });

  const content = `
    ${pageHeader('City Intelligence Center', `${stats.total} incident(s) tracked in Firestore`,
      '<button class="btn btn-secondary btn-sm">Export Analytics</button>')}

    <div class="grid grid-4 stagger-children" style="margin-bottom:var(--space-6)">
      ${[
        { label: 'Total Incidents', value: stats.total, sub: `${stats.active} active`, color: 'var(--primary)' },
        { label: 'Resolved Rate', value: `${resolvedRate}%`, sub: `${stats.resolved} resolved`, color: 'var(--accent)' },
        { label: 'Critical Open', value: stats.critical, sub: 'Requires attention', color: 'var(--danger)' },
        { label: 'Open Queue', value: stats.open, sub: 'Awaiting action', color: 'var(--secondary)' },
      ].map(m => `
        <div class="glass-card stat-card stat-card-premium">
          <div class="stat-label">${m.label}</div>
          <div class="stat-value" style="color:${m.color}">${m.value}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${m.sub}</div>
        </div>
      `).join('')}
    </div>

    <div class="grid grid-2-1" style="margin-bottom:var(--space-6)">
      <div class="glass-card heatmap-card" style="padding:0;overflow:hidden;min-height:380px">
        ${cardHeader('Incident Density', `<span class="pill pill-active"><span class="dot"></span> ${globalIssues.filter(i => i.latitude && i.longitude).length} geolocated</span>`)}
        <div class="heatmap-container">
          <div class="heatmap-gradient"></div>
          <div class="heatmap-grid"></div>
          <div class="heatmap-legend">
            <span><span class="legend-dot" style="background:var(--accent)"></span> Low volume</span>
            <span><span class="legend-dot" style="background:var(--danger)"></span> High volume</span>
          </div>
          <button class="btn btn-primary btn-sm heatmap-cta" onclick="navigate('dashboard')">View Issue Map</button>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="glass-card prediction-card glass-card-glow">
          ${cardHeader('Critical Alert')}
          <div class="prediction-alert">
            ${latestCritical ? `
              <div class="prediction-alert-header">
                <span style="font-weight:600">${escapeHtml(latestCritical.title)}</span>
                <span class="pill pill-critical"><span class="dot"></span> Critical</span>
              </div>
              <p class="body-md" style="color:var(--text-muted);font-size:13px;margin:var(--space-3) 0">${escapeHtml((latestCritical.description || '').slice(0, 120))}</p>
              <div class="prediction-metric">
                <span class="prediction-metric-value" style="color:var(--danger)">${escapeHtml(latestCritical.department || 'Unassigned')}</span>
                <span style="font-size:11px;color:var(--text-dim)">assigned dept</span>
              </div>
            ` : '<p class="body-md" style="color:var(--text-muted);padding:var(--space-4)">No open critical incidents in Firestore.</p>'}
          </div>
        </div>

        <div class="glass-card">
          ${cardHeader('Reports by Weekday')}
          ${barChart(weekdayBars, 'var(--secondary)')}
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:var(--space-6)">
      <div class="glass-card">
        ${cardHeader('Trend Analysis')}
        <div class="trend-list">
          ${trendBars.map((t, i) => {
            const colors = ['var(--secondary)', 'var(--primary)', 'var(--accent)', 'var(--danger)', 'var(--warning)'];
            const max = Math.max(...trendBars.map(b => b.value), 1);
            return `
              <div class="trend-item">
                <div class="trend-item-header">
                  <span>${escapeHtml(t.label)}</span>
                  <span class="mono" style="font-size:12px;color:var(--text-muted)">${t.value}</span>
                </div>
                <div class="progress-bar"><div class="progress-bar-fill" style="width:${(t.value/max)*100}%;background:${colors[i % colors.length]}"></div></div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="glass-card infra-health-card">
        ${cardHeader('Department Resolution Health')}
        <div class="infra-grid">
          ${deptHealth.length ? deptHealth.map(i => `
            <div class="infra-item">
              <div class="infra-item-header">
                <span style="font-size:13px;font-weight:500">${escapeHtml(i.name)} (${i.count})</span>
                <span class="pill pill-${i.status === 'good' ? 'resolved' : 'high'}">${i.health}%</span>
              </div>
              <div class="progress-bar"><div class="progress-bar-fill" style="width:${i.health}%;background:${i.status === 'good' ? 'var(--accent)' : 'var(--warning)'}"></div></div>
            </div>
          `).join('') : '<div class="empty-state">No department data yet</div>'}
        </div>
      </div>
    </div>

    <div class="grid grid-2-1" style="margin-bottom:var(--space-6)">
      ${aiCopilotPanel('CivicMind AI Copilot', [], 'intelligence-copilot')}
      <div class="glass-card">
        ${cardHeader('Example Questions')}
        <div style="display:flex;flex-direction:column;gap:var(--space-2);padding:0 var(--space-5) var(--space-5)">
          ${[
            'Which ward has the highest infrastructure risk?',
            'Which department has the highest workload?',
            'Show unresolved critical issues.',
            'Predict infrastructure failures this week.',
            'Summarize today\'s reports.',
          ].map(q => `
            <button type="button" class="btn btn-secondary btn-sm" style="text-align:left;justify-content:flex-start"
              onclick="document.getElementById('intelligence-copilot-input').value=${escapeHtml(JSON.stringify(q))};document.getElementById('intelligence-copilot-input').focus()">
              ${escapeHtml(q)}
            </button>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="glass-card recommended-action glass-card-glow">
      <div class="recommended-action-inner">
        <div class="recommended-action-icon">${icons.sparkle}</div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
            <span class="headline-sm">Recommended Action</span>
            <span class="mono" style="font-size:12px;color:var(--secondary-light)">${stats.critical} critical open</span>
          </div>
          <p class="body-md" style="color:var(--text-muted);font-size:14px">${stats.critical > 0 ? `Review ${stats.critical} critical incident(s) and assign departments in the Admin Portal.` : stats.active > 0 ? `${stats.active} active incident(s) are awaiting resolution.` : 'No pending incidents require action.'}</p>
          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
            <button class="btn btn-primary" onclick="navigate('admin')">Issue Management</button>
            <button class="btn btn-secondary" onclick="navigate('dashboard')">View Dashboard</button>
          </div>
        </div>
      </div>
    </div>
  `;
  app.innerHTML = dashboardLayout('intelligence', 'City Intelligence', 'Operations', content);
}

function renderAgents() {
  const agentCards = aggregateAgentCards(globalAgentLogs);
  const pipeline = pipelineFromLogs(globalAgentLogs);
  const runningCount = globalAgentLogs.filter(l => l.status === 'processing' || l.status === 'active').length;

  // Calculate Orchestrator Metrics
  const totalCalls = globalAgentLogs.length;
  let totalLatency = 0;
  let latencyCount = 0;
  let totalTokens = 0;
  let fallbackCount = 0;
  let providerSwitches = 0;
  globalAgentLogs.forEach(l => {
    if (l.latency != null) { totalLatency += l.latency; latencyCount++; }
    if (l.tokenUsage?.totalTokens) totalTokens += l.tokenUsage.totalTokens;
    if (l.fallbackReason) fallbackCount++;
    if (l.providerSwitch) providerSwitches++;
  });
  const avgLatency = latencyCount ? Math.round(totalLatency / latencyCount) : 0;
  const currentPref = localStorage.getItem('ai_provider_preference') || 'auto';

  const content = `
    ${pageHeader('AI Operations Center', 'Monitor the live multi-agent pipeline and model executions',
      `<span class="pill pill-active"><span class="dot"></span> ${runningCount} agents active — ${globalAgentLogs.length} total logs</span>`)}

    <div class="glass-card grid grid-3" style="margin-bottom:var(--space-6); gap:var(--space-4)">
      <div class="agent-metric">
        <span class="label-sm">Provider Configuration</span>
        <select class="input-field" style="margin-top:var(--space-2)" onchange="localStorage.setItem('ai_provider_preference', this.value); location.reload()">
          <option value="auto" ${currentPref === 'auto' ? 'selected' : ''}>Auto (Recommended)</option>
          <option value="gemini" ${currentPref === 'gemini' ? 'selected' : ''}>Gemini Only</option>
          <option value="groq" ${currentPref === 'groq' ? 'selected' : ''}>Groq Only</option>
        </select>
      </div>
      <div class="agent-metric" style="display:flex;flex-direction:column;justify-content:center">
        <span class="label-sm">Avg Latency & Tokens</span>
        <span class="mono" style="font-size:16px;color:var(--primary-light)">${avgLatency}ms / ${totalTokens}</span>
      </div>
      <div class="agent-metric" style="display:flex;flex-direction:column;justify-content:center">
        <span class="label-sm">Orchestrator Interventions</span>
        <span class="mono" style="font-size:14px;color:var(--warning)">${providerSwitches} switches, ${fallbackCount} fallbacks</span>
      </div>
    </div>

    <div class="grid grid-3 stagger-children" style="margin-bottom:var(--space-6)">
      ${agentCards.map(a => agentCard(a.name, a.role, a.status, a.load, a.icon, a.confidence, a.metrics)).join('')}
    </div>

    <div class="grid grid-2-1" style="margin-bottom:var(--space-6)">
      <div class="glass-card">
        ${cardHeader('Live Agent Pipeline', '<span class="label-sm" style="color:var(--text-dim)">7 models</span>')}
        <div class="pipeline pipeline-premium">
          ${pipeline.map((n, i, arr) => `
            <div class="pipeline-node">
              <div class="pipeline-node-icon ${n.status}">${n.icon}</div>
              <span class="pipeline-node-label">${escapeHtml(n.name)}</span>
              <span class="pipeline-node-desc">${escapeHtml(n.desc)}</span>
              ${n.executionTime != null ? `<span class="mono" style="font-size:9px;color:var(--text-dim)">${n.executionTime}ms · ${n.confidence}%</span>` : ''}
            </div>
            ${i < arr.length - 1 ? `<div class="pipeline-connector ${['active', 'processing', 'complete'].includes(n.status) ? 'active' : ''}"></div>` : ''}
          `).join('')}
        </div>
      </div>

      <div class="glass-card workflow-timeline">
        ${cardHeader('Execution Timeline', '<span class="label-sm" style="color:var(--text-dim)">Latest 10 tasks</span>')}
        <div class="timeline">
          ${globalAgentLogs.slice(0, 10).length ? globalAgentLogs.slice(0, 10).map(log => {
            const status = log.status === 'complete' ? 'complete' : log.status === 'processing' || log.status === 'active' ? 'running' : log.status === 'failed' ? 'pending' : 'pending';
            return `
            <div class="timeline-item timeline-${status}">
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <div class="timeline-header">
                  <span class="mono" style="font-size:11px;color:var(--text-dim)">${formatLogTime(log.timestamp)}</span>
                  <span class="pill pill-${status === 'complete' ? 'resolved' : status === 'running' ? 'processing' : 'idle'}" style="font-size:10px">${escapeHtml(log.status || 'pending')}</span>
                </div>
                <div style="font-size:13px;font-weight:500;margin-top:4px">
                  <span style="color:var(--primary-light)">${escapeHtml(log.agentName)}</span>
                  — ${escapeHtml(String(log.output || '').slice(0, 80))}
                </div>
                <div class="mono" style="font-size:10px;color:var(--text-dim);margin-top:4px">
                  ${log.confidence ?? 0}% confidence${log.executionTime != null ? ` · ${log.executionTime}ms` : ''} · ${escapeHtml(log.issueId || '')}
                </div>
              </div>
            </div>`;
          }).join('') : '<div class="empty-state" style="padding:var(--space-5)">Submit a report to trigger the AI pipeline</div>'}
        </div>
      </div>
    </div>

    <div class="glass-card agent-console" style="padding:0;overflow:hidden">
      ${cardHeader('Detailed Agent Logs', '<span class="label-sm" style="color:var(--text-dim)">Expand for JSON output</span>')}
      <div class="agent-log-list">
        ${globalAgentLogs.length ? globalAgentLogs.slice(0, 25).map(renderAgentLogEntry).join('') : '<div class="empty-state" style="padding:var(--space-6)">No agent executions logged yet</div>'}
      </div>
    </div>
  `;
  app.innerHTML = dashboardLayout('agents', 'AI Operations', 'System', content);
}

function buildAdminActivityFeed(issues, agentLogs) {
  const items = [];
  agentLogs.slice(0, 20).forEach(log => {
    items.push({
      time: formatLogTime(log.timestamp),
      type: log.agentName || 'Agent',
      text: `${log.issueId}: ${String(log.output || '').slice(0, 100)}`,
      sortKey: log.timestamp?.toMillis?.() ?? 0,
    });
  });
  issues.forEach(i => {
    (i.activityHistory || []).forEach(h => {
      items.push({
        time: (h.timestamp || '').slice(0, 16),
        type: h.action || 'activity',
        text: `${i.issueId}: ${h.note || h.action}`,
        sortKey: new Date(h.timestamp || 0).getTime(),
      });
    });
  });
  return items.sort((a, b) => b.sortKey - a.sortKey);
}

function renderAdmin() {
  const stats = computeIssueStats(globalIssues);
  const deptWorkload = computeDeptWorkload(globalIssues);
  const deptColors = {
    'Public Works': 'var(--primary)',
    'Safety & Traffic': 'var(--secondary)',
    'Waste Management': 'var(--warning)',
    'Environment': 'var(--accent)',
    'General': 'var(--info)',
  };
  const maxDept = Math.max(...Object.values(deptWorkload), 1);
  const escalation = buildEscalationChain(globalIssues);
  const statusOptions = ['Open', 'In Progress', 'Verified', 'Resolved'];

  // Priority queue sorting: Critical first, then Open, then by date
  const priorityQueue = [...globalIssues].sort((a, b) => {
    if (a.severity === 'critical' && b.severity !== 'critical') return -1;
    if (a.severity !== 'critical' && b.severity === 'critical') return 1;
    if (a.status === 'Open' && b.status !== 'Open') return -1;
    if (a.status !== 'Open' && b.status === 'Open') return 1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  const content = `
    ${pageHeader('Issue Management', 'Manage live Firestore issues and department routing',
      `<span class="pill pill-active"><span class="dot"></span> ${stats.total} synced</span>`)}

    <div class="grid grid-4 stagger-children" style="margin-bottom:var(--space-6)">
      ${[
        { label: 'Total Issues', value: stats.total, color: 'var(--primary)' },
        { label: 'Active', value: stats.active, color: 'var(--warning)' },
        { label: 'Resolved', value: stats.resolved, color: 'var(--accent)' },
        { label: 'Critical Esc.', value: stats.critical, color: 'var(--danger)' },
      ].map(s => `
        <div class="glass-card stat-card stat-card-premium">
          <div class="stat-label">${s.label}</div>
          <div class="stat-value" style="color:${s.color}">${s.value}</div>
        </div>
      `).join('')}
    </div>

    <div class="grid grid-2-1" style="margin-bottom:var(--space-6)">
      <div class="glass-card" style="padding:0;overflow:hidden">
        ${cardHeader('Priority Queue', '<span class="pill pill-active"><span class="dot"></span> Critical issues prioritized</span>')}
        <div class="table-scroll">
          <table class="data-table data-table-premium">
            <thead>
              <tr><th>Report ID</th><th>Title</th><th>Status</th><th>Department</th><th>Escalation / Actions</th></tr>
            </thead>
            <tbody>
              ${priorityQueue.map(i => `
                <tr class="table-row-hover ${i.severity === 'critical' && i.status !== 'Resolved' ? 'critical-row' : ''}" style="${i.severity === 'critical' && i.status !== 'Resolved' ? 'background:var(--danger-glow); border-left:3px solid var(--danger);' : ''}">
                  <td><span class="mono report-id">${escapeHtml(i.issueId || '—')}</span></td>
                  <td>
                    <div class="report-title-cell">
                      ${escapeHtml(i.title)}
                      ${i.severity === 'critical' && i.status !== 'Resolved' ? `<span class="priority-badge" style="margin-left:8px;font-size:10px;background:var(--danger);color:#fff;padding:2px 6px;border-radius:4px;">PRIORITY</span>` : ''}
                    </div>
                    <div class="report-desc-cell">${escapeHtml(i.category || '')} · ${escapeHtml(i.severity || '')} · L${i.escalationLevel || 1}</div>
                    ${renderMediaGallery(i, escapeHtml)}
                  </td>
                  <td>
                    <select class="input-field" style="padding:6px 8px;font-size:12px;min-width:120px"
                      onchange="adminUpdateStatus('${i.id}', this.value)">
                      ${statusOptions.map(s => `<option value="${s}" ${i.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    <select class="input-field" style="padding:6px 8px;font-size:12px;min-width:140px"
                      onchange="adminAssignDepartment('${i.id}', this.value)">
                      ${DEPARTMENTS.map(d => `<option value="${d}" ${(i.department || DEPARTMENT_BY_CATEGORY[i.category] || 'General') === d ? 'selected' : ''}>${d}</option>`).join('')}
                    </select>
                  </td>
                  <td style="white-space:nowrap">
                    <select class="input-field" style="padding:6px 8px;font-size:12px;width:64px;display:inline-block;margin-right:4px"
                      onchange="adminEscalate('${i.id}', this.value)">
                      ${[1, 2, 3, 4].map(l => `<option value="${l}" ${(i.escalationLevel || 1) === l ? 'selected' : ''}>L${l}</option>`).join('')}
                    </select>
                    <button class="btn btn-primary btn-sm" onclick="adminMarkResolved('${i.id}')" ${i.status === 'Resolved' ? 'disabled' : ''}>Resolve</button>
                  </td>
                </tr>
              `).join('')}
              ${globalIssues.length === 0 ? '<tr><td colspan="5" class="empty-state">No issues in Firestore</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        <div class="glass-card">
          ${cardHeader('Department KPIs')}
          <div class="dept-list">
            ${Object.keys(deptWorkload).length ? Object.entries(deptWorkload).map(([dept, count]) =>
              deptWidget(dept, count, Math.round((count / maxDept) * 100), deptColors[dept] || 'var(--primary)')
            ).join('') : '<div class="empty-state">No assigned workloads yet</div>'}
          </div>
        </div>

        <div class="glass-card">
          ${cardHeader('Escalation Dashboard')}
          <div class="escalation-chain">
            ${escalation.map(e => `
              <div class="escalation-level">
                <div class="escalation-dot" style="border-color:${e.status === 'complete' ? 'var(--accent)' : e.status === 'active' ? 'var(--primary)' : 'var(--border-default)'};color:${e.status === 'complete' ? 'var(--accent)' : e.status === 'active' ? 'var(--primary-light)' : 'var(--text-dim)'}">${e.level}</div>
                <div>
                  <div style="font-size:13px;font-weight:500">${escapeHtml(e.dept)}</div>
                  <div style="font-size:11px;color:var(--text-dim)">${escapeHtml(e.label)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:var(--space-6)">
      <div class="glass-card">
        ${cardHeader('Resolution Timeline', '<span class="label-sm" style="color:var(--text-dim)">Recent activity</span>')}
        <div class="timeline">
          ${buildAdminActivityFeed(globalIssues, globalAgentLogs).slice(0, 12).map(a => `
            <div class="timeline-item timeline-complete">
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <div class="timeline-header">
                  <span class="mono" style="font-size:11px;color:var(--text-dim)">${escapeHtml(a.time)}</span>
                  <span class="pill pill-processing" style="font-size:10px">${escapeHtml(a.type)}</span>
                </div>
                <div style="font-size:13px;margin-top:4px">${escapeHtml(a.text)}</div>
              </div>
            </div>
          `).join('') || '<div class="empty-state">No activity recorded yet</div>'}
        </div>
      </div>

      <div class="glass-card">
        ${cardHeader('Issue Audit Trail', '<span class="label-sm" style="color:var(--text-dim)">Activity history</span>')}
        <div class="activity-feed">
          ${globalIssues.flatMap(i => (i.activityHistory || []).slice(-3).map(h => ({
            issueId: i.issueId,
            ...h,
          }))).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')).slice(0, 15).map(h => `
            <div class="activity-feed-item">
              <span class="mono" style="color:var(--primary-light);font-size:11px">${escapeHtml(h.issueId)}</span>
              <span style="font-size:13px">${escapeHtml(h.note || h.action)}</span>
              <span class="mono" style="font-size:10px;color:var(--text-dim)">${escapeHtml(h.byRole || '')} · ${escapeHtml((h.timestamp || '').slice(0, 16))}</span>
            </div>
          `).join('') || '<div class="empty-state">Submit and manage issues to build activity history</div>'}
        </div>
      </div>
    </div>
  `;
  app.innerHTML = dashboardLayout('admin', 'Issue Management', 'Operations', content);
}

function initMaps() {
  const dashMapEl = document.getElementById('dashboard-map');
  if (dashMapEl && window.L) {
    // Wait for the container to have non-zero dimensions before initializing the map.
    // On direct reload, the container may still have zero width during the initial setTimeout.
    if (dashMapEl.clientWidth > 0 && dashMapEl.clientHeight > 0) {
      refreshDashboardMap(dashMapEl, globalIssues, mapFilters, escapeHtml);
    } else {
      requestAnimationFrame(() => {
        const el = document.getElementById('dashboard-map');
        if (el && el.clientWidth > 0) {
          refreshDashboardMap(el, globalIssues, mapFilters, escapeHtml);
        } else {
          // Final fallback: wait one more frame
          requestAnimationFrame(() => {
            const el2 = document.getElementById('dashboard-map');
            if (el2) refreshDashboardMap(el2, globalIssues, mapFilters, escapeHtml);
          });
        }
      });
    }
  }
}

function refreshUserIssuesSubscription() {
  if (window._userIssuesUnsub) window._userIssuesUnsub();
  if (currentUser?.uid && currentProfile) {
    window._userIssuesUnsub = useUserIssues(currentUser.uid, (issues, err) => {
      globalUserIssues = issues;
      if (err) firestoreError = err;
      
      if (currentProfile && currentProfile.role === 'Citizen') {
        let resolvedCount = 0;
        issues.forEach(i => {
          if (i.status === 'Resolved') resolvedCount++;
        });
        const computedScore = 100 + (issues.length * 25) + (resolvedCount * 50);
        if (currentProfile.citizenScore !== computedScore) {
          currentProfile.citizenScore = computedScore;
          updateCitizenScore(currentUser.uid, computedScore).catch(e => console.warn('Failed to sync score:', e));
        }
      }

      if (getRoute() === 'report' || getRoute() === 'dashboard') maybeRerender(getRoute());
    });
  } else if (!currentUser) {
    globalUserIssues = [];
  }
}

function refreshNotificationsSubscription() {
  if (window._notificationsUnsub) window._notificationsUnsub();
  if (currentUser?.uid && currentProfile) {
    window._notificationsUnsub = useNotifications(currentUser.uid, (notifications, err) => {
      globalNotifications = notifications;
      if (err) firestoreError = err;
      dataLoading.notifications = false;
      maybeRerender(getRoute());
    });
  } else if (!currentUser) {
    globalNotifications = [];
  }
}

// Initialize Subscribers
useAuth((user, profile) => {
  currentUser = user;
  currentProfile = profile;

  // Tear down previous global listeners
  if (window._issuesUnsub) { window._issuesUnsub(); window._issuesUnsub = null; }
  if (window._agentLogsUnsub) { window._agentLogsUnsub(); window._agentLogsUnsub = null; }

  // Only subscribe to protected collections when BOTH user auth and profile are fully resolved
  if (user && profile) {
    firestoreError = null;

    window._issuesUnsub = useRealtimeIssues((issues, err) => {
      globalIssues = issues;
      dataLoading.issues = false;
      if (err) firestoreError = err;
      maybeRerender(getRoute());
    });

    // agent_logs requires Admin role in Firestore rules — only subscribe for admins
    if (profile.role === 'Administrator') {
      window._agentLogsUnsub = useAgentLogs((logs, err) => {
        globalAgentLogs = logs;
        dataLoading.logs = false;
        if (err) firestoreError = err;
        if (getRoute() === 'agents') maybeRerender('agents');
      }, 50);
    } else {
      globalAgentLogs = [];
      dataLoading.logs = false;
    }
  } else if (!user) {
    // User signed out — clear all data
    globalIssues = [];
    globalAgentLogs = [];
    dataLoading.issues = false;
    dataLoading.logs = false;
    firestoreError = null;
  }

  refreshUserIssuesSubscription();
  refreshUserIssuesSubscription();
  refreshNotificationsSubscription();
  handleRoute();
});

// Command Palette global keyboard listener
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    toggleCommandPalette();
  } else if (e.key === 'Escape' && commandPaletteOpen) {
    toggleCommandPalette();
  }
});

// Command Palette Logic
window.toggleCommandPalette = () => {
  commandPaletteOpen = !commandPaletteOpen;
  commandPaletteQuery = '';
  maybeRerender(getRoute());
  if (commandPaletteOpen) {
    setTimeout(() => {
      document.getElementById('cmd-palette-input')?.focus();
    }, 50);
  }
};

window.updateCommandQuery = (e) => {
  commandPaletteQuery = e.target.value.toLowerCase();
  const resultsContainer = document.getElementById('cmd-palette-results-container');
  if (resultsContainer) {
    resultsContainer.innerHTML = renderCommandPaletteResults();
  }
};

window.executeCommand = (type, payload) => {
  commandPaletteOpen = false;
  commandPaletteQuery = '';
  if (type === 'route') {
    navigate(payload);
  } else if (type === 'issue') {
    showInfo(`Viewing Issue: ${payload}`);
    // Assuming navigate('report') or custom issue view logic applies here
  } else if (type === 'notification') {
    openNotification(payload);
  }
  maybeRerender(getRoute());
};

function renderCommandPalette() {
  if (!commandPaletteOpen) return '';
  return `
    <div class="command-palette-overlay" onclick="if(event.target===this) toggleCommandPalette()">
      <div class="command-palette">
        <div class="command-palette-input-wrap">
          <span class="command-palette-icon">${icons.search}</span>
          <input type="text" id="cmd-palette-input" class="command-palette-input" 
                 placeholder="Search reports, issues, locations, or navigation..." 
                 value="${escapeHtml(commandPaletteQuery)}"
                 oninput="updateCommandQuery(event)">
        </div>
        <div class="command-palette-results" id="cmd-palette-results-container">
          ${renderCommandPaletteResults()}
        </div>
      </div>
    </div>
  `;
}

function renderCommandPaletteResults() {
  const query = commandPaletteQuery.toLowerCase();
  let resultsHtml = '';

  // 1. Navigation Routes
  const routes = [
    { id: 'dashboard', title: 'Dashboard', desc: 'Go to main overview' },
    { id: 'report', title: 'Report Issue', desc: 'Create a new civic report' },
    { id: 'intelligence', title: 'Intelligence', desc: 'View global insights' },
    { id: 'agents', title: 'AI Operations', desc: 'Manage Multi-LLM agents' },
    { id: 'admin', title: 'Admin', desc: 'Manage system settings' }
  ];
  const matchedRoutes = routes.filter(r => r.title.toLowerCase().includes(query) || r.desc.toLowerCase().includes(query));
  if (matchedRoutes.length > 0) {
    resultsHtml += `<div class="command-group-title">Navigation</div>`;
    resultsHtml += matchedRoutes.map(r => `
      <div class="command-item" onclick="executeCommand('route', '${r.id}')">
        <div class="command-item-icon">${icons.settings || '•'}</div>
        <div class="command-item-content">
          <div class="command-item-title">${escapeHtml(r.title)}</div>
          <div class="command-item-subtitle">${escapeHtml(r.desc)}</div>
        </div>
        <div class="command-item-shortcut">Route</div>
      </div>
    `).join('');
  }

  // 2. Issues / Reports
  const matchedIssues = globalIssues.filter(i => 
    (i.issueId && String(i.issueId).toLowerCase().includes(query)) || 
    (i.description && String(i.description).toLowerCase().includes(query)) ||
    (i.category && String(i.category).toLowerCase().includes(query)) ||
    (i.location_name && String(i.location_name).toLowerCase().includes(query))
  ).slice(0, 5);
  
  if (matchedIssues.length > 0) {
    resultsHtml += `<div class="command-group-title">Issues & Reports</div>`;
    resultsHtml += matchedIssues.map(i => `
      <div class="command-item" onclick="executeCommand('issue', '${i.issueId}')">
        <div class="command-item-icon">${icons.camera || '•'}</div>
        <div class="command-item-content">
          <div class="command-item-title">${escapeHtml(i.issueId)} - ${escapeHtml(i.category)}</div>
          <div class="command-item-subtitle">${escapeHtml(i.location_name || 'Unknown location')}</div>
        </div>
        <div class="command-item-shortcut">${escapeHtml(i.status)}</div>
      </div>
    `).join('');
  }

  // 3. Notifications
  const matchedNotifications = globalNotifications.filter(n => 
    (n.message && String(n.message).toLowerCase().includes(query)) ||
    (n.issueId && String(n.issueId).toLowerCase().includes(query))
  ).slice(0, 3);
  
  if (matchedNotifications.length > 0) {
    resultsHtml += `<div class="command-group-title">Notifications</div>`;
    resultsHtml += matchedNotifications.map(n => `
      <div class="command-item" onclick="executeCommand('notification', '${n.id}')">
        <div class="command-item-icon">${icons.bell || '•'}</div>
        <div class="command-item-content">
          <div class="command-item-title">${escapeHtml(n.type)}</div>
          <div class="command-item-subtitle">${escapeHtml(n.message)}</div>
        </div>
        <div class="command-item-shortcut">${formatLogTime(n.createdAt)}</div>
      </div>
    `).join('');
  }

  if (!resultsHtml) {
    resultsHtml = `<div class="empty-state" style="padding: var(--space-6) var(--space-4)">No results found for "${escapeHtml(commandPaletteQuery)}"</div>`;
  }
  return resultsHtml;
}

