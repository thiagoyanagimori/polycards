# PolyCards 🚀

PolyCards is a modern vocabulary learning platform designed to help users master new languages through interactive flashcards, spaced repetition, pronunciation training, and gamified progression.

🌐 Live Demo: https://playpolycards.vercel.app/

---

## ✨ Features

- 🔐 Google Authentication with Firebase
- ☁️ Cloud sync using Firestore
- 💳 Stripe Premium integration
- 🧠 Flashcard-based vocabulary training
- 📈 Progressive level system
- 🔊 Text-to-Speech pronunciation
- 🎮 Gamified learning experience
- 🌙 Modern responsive UI
- ⚡ Fast deployment with Vercel

---

## 🛠️ Tech Stack

### Frontend
- Vite
- Vanilla JavaScript
- HTML5
- CSS3

### Backend & Services
- Firebase Authentication
- Firestore Database
- Firebase Functions
- Stripe Checkout API

### Deployment
- Vercel
- GitHub

---

## 📦 Installation

Clone the repository:

```bash
git clone https://github.com/thiagoyanagimori/polycards.git
```

Enter the project folder:

```bash
cd polycards/artifacts/polycards
```

Install dependencies:

```bash
pnpm install
```

Start development server:

```bash
pnpm dev
```

---

## 🔑 Environment Variables

Create a `.env` file inside the project root:

```env
VITE_FIREBASE_API_KEY=your_key
VITE_FIREBASE_AUTH_DOMAIN=your_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FUNCTIONS_BASE_URL=your_functions_url
```
