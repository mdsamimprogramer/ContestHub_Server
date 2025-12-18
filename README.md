# 🖥️ ContestHub – Server Side (Backend)

This is the backend server for **ContestHub**, a full-stack contest management platform where users can create, join, and manage creative contests.  
The backend is built with **Node.js, Express, MongoDB**, and **Firebase Authentication**, and includes **Stripe payment integration** and **role-based access control**.

---

## 🌐 Live Server URL
https://your-server-live-url.vercel.app

---

## ⚙️ Core Responsibilities

- REST API for contests, users, payments, and submissions
- Role-based authorization (Admin, Creator, User)
- Secure APIs using Firebase JWT
- Stripe payment session & verification
- Contest participation & winner declaration
- Admin moderation (users & contests)

---

## 🛠 Tech Stack

- **Runtime:** Node.js  
- **Framework:** Express.js  
- **Database:** MongoDB (Atlas)  
- **Authentication:** Firebase Admin SDK (JWT)  
- **Payment Gateway:** Stripe  
- **Deployment:** Vercel  

---

## 🔐 Authentication & Security

- Firebase ID Token (JWT) verification
- Protected routes using `verifyToken` middleware
- Role-based access using `verifyAdmin`
- Sensitive keys stored in environment variables
- No secret keys pushed to GitHub

---

## 📦 Installed Packages

```bash
express
cors
dotenv
mongodb
firebase-admin
stripe

server/
│
├─ index.js                 # Main server entry
├─ verifyToken.js           # JWT verification middleware
├─ firebase-services-account.json (ignored in git)
├─ .env                     # Environment variables
├─ package.json
└─ README.md

