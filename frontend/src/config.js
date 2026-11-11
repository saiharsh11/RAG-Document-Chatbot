// The backend URL comes from VITE_API_URL (set in Vercel, or in frontend/.env.development.local for local dev).
const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export default API_URL;
