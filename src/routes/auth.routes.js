const express = require('express');
const router = express.Router();
const {
    registrar,
    login,
    getMe,
    forgotPassword,
    resetPassword
} = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

// Rotas publicas
router.post('/registrar', registrar);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Rotas privadas
router.get('/me', authMiddleware, getMe);

module.exports = router;