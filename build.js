const fs = require(‘fs’);
if (!fs.existsSync(‘dist’)) fs.mkdirSync(‘dist’);
let html = fs.readFileSync(‘index.html’, ‘utf8’);
const vars = {
‘“FIREBASE_API_KEY”’:             `"${process.env.FIREBASE_API_KEY||''}"`,
‘“FIREBASE_AUTH_DOMAIN”’:         `"${process.env.FIREBASE_AUTH_DOMAIN||''}"`,
‘“FIREBASE_PROJECT_ID”’:          `"${process.env.FIREBASE_PROJECT_ID||''}"`,
‘“FIREBASE_STORAGE_BUCKET”’:      `"${process.env.FIREBASE_STORAGE_BUCKET||''}"`,
‘“FIREBASE_MESSAGING_SENDER_ID”’: `"${process.env.FIREBASE_MESSAGING_SENDER_ID||''}"`,
‘“FIREBASE_APP_ID”’:              `"${process.env.FIREBASE_APP_ID||''}"`
};
for (const [k, v] of Object.entries(vars)) html = html.split(k).join(v);
// Force unique build to bypass Netlify CDN cache
html = html.replace(’<!– build:’, `<!-- deployed:${Date.now()} build:`);
fs.writeFileSync(‘dist/index.html’, html);
fs.writeFileSync(‘dist/_redirects’, ‘/*    /index.html   200\n’);
console.log(‘✓ Firebase config injetado!’);
