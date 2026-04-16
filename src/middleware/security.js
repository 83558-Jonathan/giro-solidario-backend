// Middleware para logging de requisições suspeitas
const suspiciousActivityLogger = (req, res, next) => {
    const suspiciousPatterns = [
        /(\b(select|insert|update|delete|drop|union|exec|declare|create|alter)\b)/i,
        /(\$ne|\$gt|\$lt|\$eq|\$or|\$and|\$in)/i, // MongoDB operators
        /(<\s*script|javascript:|onerror=|onload=)/i // XSS patterns
    ];

    const checkString = (str) => {
        if (!str) return false;
        return suspiciousPatterns.some(pattern => pattern.test(str));
    };

    const checkObject = (obj) => {
        for (let key in obj) {
            if (typeof obj[key] === 'string' && checkString(obj[key])) {
                return true;
            }
            if (typeof obj[key] === 'object' && checkObject(obj[key])) {
                return true;
            }
        }
        return false;
    };

    if (checkObject(req.body) || checkObject(req.query) || checkObject(req.params)) {
        console.warn(`⚠️ [SECURITY] Possível ataque detectado de IP: ${req.ip}`);
        console.warn(`   URL: ${req.method} ${req.originalUrl}`);
        console.warn(`   Body:`, JSON.stringify(req.body).substring(0, 500));

        // Opcional: bloquear o IP temporariamente
        // Você pode implementar um sistema de banimento aqui
    }

    next();
};

module.exports = { suspiciousActivityLogger };