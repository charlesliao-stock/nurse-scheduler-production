// js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { firebaseConfig } from "./config/firebase-config.js";

// 初始化 App
const app = initializeApp(firebaseConfig);

// 匯出實例供全站使用
export const db = getFirestore(app);
export const auth = getAuth(app);
