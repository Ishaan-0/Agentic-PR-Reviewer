import rateLimit from "express-rate-limit";

export const hourlyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, 
    message: "You've hit the rate limit. Please try again after an hour",
});