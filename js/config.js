/**
 * ODEA Ledger — public configuration.
 *
 * Everything in this file is SAFE to publish on GitHub Pages:
 *  - A Firebase web config is an identifier, not a secret. Access to data is
 *    enforced by Firestore Security Rules (firebase/firestore.rules), which
 *    only let signed-in members listed in the `users` collection read/write.
 *  - The Apps Script URL is protected by the same rule: every call carries the
 *    user's Firebase ID token and the script verifies membership before doing
 *    anything with Drive.
 *
 * Configured for the odea-ledger Firebase project.
 */
export const CONFIG = {
  appName: 'ODEA Ledger',
  companyName: 'ODEA Development',
  companyTagline: 'Finance desk',

  firebase: {
    apiKey: 'AIzaSyBDcgD8EW6OSh4GxpvImQAUKEItb76mp7Y',
    authDomain: 'odea-ledger.firebaseapp.com',
    projectId: 'odea-ledger',
    storageBucket: 'odea-ledger.firebasestorage.app',
    messagingSenderId: '222910051349',
    appId: '1:222910051349:web:ac24ebb7c73fd53eb84a1c',
  },

  /** Google Apps Script web-app URL (ends with /exec). Handles bill uploads to Drive. */
  driveProxyUrl: 'https://script.google.com/macros/s/AKfycbyWYXKZmtR5GwXe13znm1TzD_i9EX_I9YG07XabR3GaVo1gjXr8_WjK1X6oLUdTkeGA/exec',

  /** All dates are calculated in this timezone so entries never slip into the wrong month. */
  timezone: 'Asia/Kolkata',

  defaultCategories: [
    'Office Rent', 'Electricity & Utilities', 'Internet & Phone', 'Office Supplies',
    'Tea & Snacks', 'Meta Ads', 'Google Ads', 'SEO Tools', 'Website & Hosting',
    'Software Subscriptions', 'Content Creation', 'Graphic Design', 'Video Production',
    'Salaries & Staff', 'Travel & Fuel', 'Repairs & Maintenance', 'Client Payments', 'Other',
  ],

  paymentMethods: ['UPI', 'Cash', 'Bank Transfer', 'Debit Card', 'Credit Card', 'Cheque', 'Other'],

  gstRates: [0, 5, 12, 18, 28],

  bills: {
    maxSizeMB: 10,          // hard limit before compression
    maxDimension: 1800,     // images are resized so the longest side is ≤ this
    jpegQuality: 0.82,
    accept: 'image/*,application/pdf',
  },

  pageSizes: [10, 25, 50, 100],
};

export const isFirebaseConfigured = () => !String(CONFIG.firebase.apiKey).startsWith('PASTE');
export const isDriveConfigured = () => /^https:\/\/script\.google\.com\/.+\/exec$/.test(CONFIG.driveProxyUrl);
