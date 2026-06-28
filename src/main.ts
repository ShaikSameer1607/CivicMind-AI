import './style.css';
import './design-system.css';
import { initRouter } from './router';

// Load Google Charts loader script
function loadGoogleCharts() {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/charts/loader.js';
    script.onload = () => {
      // @ts-ignore
      google.charts.load('current', { packages: ['corechart', 'gauge'] });
      // @ts-ignore
      google.charts.setOnLoadCallback(() => resolve());
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadGoogleCharts();
    initRouter();
  } catch (e) {
    console.error('Failed to load Google Charts', e);
  }
});
