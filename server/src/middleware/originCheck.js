import { env } from '../config/env.js';

export const originCheck = (req, res, next) => {
  const allowedOrigins = [
    'https://placement-prep-ai-inky.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ];

  if (env.CLIENT_ORIGIN) allowedOrigins.push(env.CLIENT_ORIGIN.replace(/\/$/, ''));
  if (env.CLIENT_URL) allowedOrigins.push(env.CLIENT_URL.replace(/\/$/, ''));

  const origin = req.headers.origin;

  // Allow requests if they have no origin (like Postman) or match our list
  if (!origin || allowedOrigins.includes(origin)) {
    return next();
  }

  console.warn(`[originCheck] Blocked unauthorized origin: ${origin}`);
  return res.status(403).json({
    success: false,
    message: 'Forbidden: Origin not allowed'
  });
};