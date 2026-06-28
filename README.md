<div align="center">

# 🚀 CivicMind AI

**Multi-Agent AI Powered Civic Intelligence Platform**

[![Google AI](https://img.shields.io/badge/Google%20AI-Gemini-4285F4?style=for-the-badge&logo=google)](https://ai.google.dev/)
[![Groq](https://img.shields.io/badge/Groq-Llama_3.3-f55036?style=for-the-badge&logo=meta)](https://groq.com/)
[![Firebase](https://img.shields.io/badge/Firebase-Backend-FFCA28?style=for-the-badge&logo=firebase)](https://firebase.google.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Storage-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Vite](https://img.shields.io/badge/Vite-Build_Tool-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)
[![Cloud Run](https://img.shields.io/badge/Google_Cloud-Cloud_Run-4285F4?style=for-the-badge&logo=googlecloud)](https://cloud.google.com/run)
[![Hackathon](https://img.shields.io/badge/Hackathon-Submission-ff69b4?style=for-the-badge)](https://devpost.com/)

![CivicMind Banner](docs/images/banner.png)

</div>

---

## 📖 Overview

### The Problem
Cities worldwide face an explosion of citizen reports regarding infrastructure, safety, and sanitation. Government departments are overwhelmed with duplicate reports, unverified claims, and the manual labor of categorizing and routing issues to the correct department, leading to slow response times and frustrated citizens.

### The Solution
**CivicMind AI** is an intelligent, multi-agent platform that revolutionizes civic issue management. By deploying a pipeline of specialized AI agents (powered by Google Gemini and Groq), the platform automatically analyzes incoming reports, extracts metadata, verifies claims against community consensus, predicts infrastructure decay, and routes issues to the correct government department instantly.

### Why CivicMind AI?
It bridges the gap between citizens and government by replacing bureaucratic bottlenecks with an instant, intelligent, and transparent AI-driven workflow, empowering both city officials and civic heroes.

---

## 🧪 Try it Out (Test Credentials)

You can explore the platform using the following test accounts:

**Government Administrator Account** (Access to Agent Pipeline & Operations)
- **Email:** `shaik@12test.com`
- **Password:** `123456`

*(To test as a Citizen, feel free to register a new account on the signup page!)*

---

## ✨ Features

- **🤖 Multi-Agent AI Pipeline**: An orchestrator that dynamically routes tasks between Gemini and Groq depending on quota and capabilities.
- **🧠 Vision Analysis**: Automatically identifies issue categories, severity, and context from uploaded images.
- **📍 Geo Intelligence**: Analyzes coordinates, reverse geocodes locations, and spots spatial clusters.
- **🔁 Duplicate Detection**: Groups similar incidents to prevent redundant dispatches.
- **✅ Community Verification**: Scores reports based on community trust and consensus.
- **📊 Predictive Infrastructure**: Forecasts future decay and suggests preventative maintenance.
- **🏛 Admin Dashboard**: A comprehensive command center for government officials to manage city operations.
- **👥 Citizen Portal**: A gamified platform where citizens report issues and earn "Civic Hero" reputation points.
- **🗺 Interactive Maps**: Heatmaps and clustering for identifying city-wide problem hotspots.
- **📦 Media Upload**: Secure, scalable evidence media persistence via Supabase.
- **🔐 Firebase Authentication**: Seamless Google and Email authentication.

---

## 🏗 System Architecture

CivicMind AI uses a decentralized, event-driven architecture designed for high availability and rapid processing. 

### Data Flow
1. **Client Layer (Vite/JS):** Citizens capture media and geolocation data. The payload is sent to the backend.
2. **Persistence Layer (Firebase/Supabase):** Images/videos are securely uploaded to Supabase Storage. Structural metadata and relationships are synchronized in real-time using Firestore.
3. **Multi-LLM Orchestrator:** The application dynamically routes inference tasks between **Gemini 1.5 Pro** and **Groq (Llama-3.3-70b)** based on quota limits, token performance, and vision requirements.

![Architecture](docs/images/architecture.png)

---

## 🤖 AI Agent Pipeline

Our system employs a sequential pipeline of specialized agents. Each issue passes through these agents instantly upon submission:

1. **🔍 Vision Inspector**: Analyzes uploaded media to identify the core issue, assess severity, and extract relevant visual context.
2. **🌍 Geo Intelligence**: Enriches the report with precise location data, neighborhood context, and historical hotspot analysis.
3. **📋 Duplicate Detection**: Compares the new report against recent active reports to flag potential duplicates and merge data.
4. **✅ Community Verification**: Assigns a confidence score based on the reporter's reputation and corroborating evidence.
5. **📊 Predictive Infrastructure**: Analyzes trends to predict if this issue is indicative of larger systemic infrastructure failure.
6. **💡 Resolution Recommendation**: Suggests immediate mitigation steps and identifies the optimal government department for dispatch.
7. **🔔 Notification Agent**: Drafts contextual alerts for citizens and officials regarding the new issue status.

---

## 📸 Platform Screenshots

### Citizen Dashboard
A gamified dashboard where citizens track their contributions and city-wide status.
<img src="docs/images/citizen-dashboard.png" width="800" alt="Citizen Dashboard" />

### AI-Assisted Issue Reporting
Our intelligent report form pre-fills categories, severity, and urgency based on the uploaded image.
<img src="docs/images/report-page.png" width="800" alt="Report Issue Form" />

### Government Operations Dashboard
Command center for city administrators to track critical emergencies and city intelligence.
<img src="docs/images/admin-dashboard.png" width="800" alt="Admin Dashboard" />

### Live Agent Pipeline (Execution Timeline)
Full transparency into the sequential multi-agent execution pipeline evaluating incoming reports.
<img src="docs/images/ai-analysis.png" width="800" alt="Live Agent Pipeline" />

### CivicMind AI Copilot
Query the city's Firestore database using natural language to predict failures, track trends, or get immediate answers.
<img src="docs/images/copilot.png" width="800" alt="AI Copilot Interface" />

*(Note: Additional screenshots like map views and analytics can be added in future iterations!)*

---

## 🛠 Tech Stack

| Domain | Technologies |
| :--- | :--- |
| **Frontend** | Vanilla JS, HTML5, CSS3, Vite |
| **Backend (BaaS)** | Firebase (Firestore, Auth), Supabase (Storage) |
| **AI Providers** | Google Gemini (Gemini 1.5 Pro/Flash), Groq (Llama 3.3 70b) |
| **Mapping** | Leaflet.js, OpenStreetMap |
| **Deployment** | Docker, Google Cloud Build, Google Cloud Run |

---

## 📂 Project Structure

```text
├── src/
│   ├── services/
│   │   ├── agents/          # Multi-agent AI logic and providers
│   │   ├── auth.js          # Firebase Authentication
│   │   ├── copilot.js       # AI Chatbot interface
│   │   ├── firebase.js      # Firebase Initialization
│   │   ├── geolocation.js   # Location & Maps utilities
│   │   ├── issues.js        # Firestore CRUD for reports
│   │   ├── mapController.js # Leaflet integration
│   │   ├── storage.js       # Supabase Media Upload
│   │   ├── system.js        # Notifications & Agent Logs
│   │   └── ui.js            # Toast alerts & UI states
│   ├── main.js              # Application entry point and router
│   └── style.css            # Custom CSS and design system
├── docs/
│   └── images/              # README assets
├── index.html               # Main HTML template
├── Dockerfile               # Container definition
├── cloudbuild.yaml          # CI/CD pipeline
└── vite.config.js           # Vite bundler configuration
```

---

## 🚀 Installation & Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/YourUsername/CivicMind-AI.git
   cd CivicMind-AI
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Create a `.env` file in the root directory (see Environment Variables section).

4. **Run the development server**
   ```bash
   npm run dev
   ```

---

## 🔑 Environment Variables

To run the project locally, create a `.env` file with the following variables:

```env
# AI Providers
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_GROQ_API_KEY=your_groq_api_key
VITE_DEFAULT_AI_PROVIDER=gemini # or 'groq'

# Supabase Storage
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Firebase (Authentication & Firestore)
# Note: For production, we hardcoded these in firebase.js to prevent CI/CD issues, 
# but for local dev, you can manage them via ENV.
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id
VITE_FIREBASE_APP_ID=your_firebase_app_id
```

---

## ☁️ Deployment

This project is configured for continuous deployment using **Google Cloud Build** and **Google Cloud Run**.

The `cloudbuild.yaml` file automatically triggers a Docker build upon pushes to the `main` branch. It injects the environment variables securely into the container at build time and deploys the resulting image to a fully managed, scalable Cloud Run instance.

---

## 🌐 Demo

- **Live Demo**: [Insert Link Here]
- **Demo Video**: [Insert Link Here]
- **Pitch Presentation**: [Insert Link Here]

---

## 🔮 Future Scope

- **IoT Integration**: Syncing with smart city sensors (traffic cameras, air quality monitors).
- **Mobile App**: Releasing native iOS and Android versions using React Native.
- **Multilingual Support**: Real-time translation of reports for diverse communities.
- **Blockchain Verification**: Immutable, tamper-proof audit trails for government accountability.

---

## 👥 Team

- **Shaik Sameer** - *Developer & AI Engineer*

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
