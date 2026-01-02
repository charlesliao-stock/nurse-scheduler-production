// js/config.js

// 請替換為您的 Firebase 設定
const firebaseConfig = {
    apiKey: "AIzaSyA2B_rDKi7JyLaYpJd-lfFNXZ1BJUzpu-k",
    authDomain: "nursing-schedule-2f9c8.firebaseapp.com",
    projectId: "nursing-schedule-2f9c8",
    storageBucket: "nursing-schedule-2f9c8.firebasestorage.app",
    messagingSenderId: "561144664580",
    appId: "1:561144664580:web:3d4397a5cbd7f788b1db51",
    measurementId: "G-V0DBP9RZ7P"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

console.log("Firebase initialized.");
