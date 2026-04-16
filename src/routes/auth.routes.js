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
const {
    validateRegister,
    validateLogin,
    validateForgotPassword,
    validateResetPassword
} = require('../middleware/validation');

// Rotas publicas COM VALIDAÇÃO
router.post('/registrar', validateRegister, registrar);
router.post('/login', validateLogin, login);
router.post('/forgot-password', validateForgotPassword, forgotPassword);
router.post('/reset-password', validateResetPassword, resetPassword);

// Rotas privadas
router.get('/me', authMiddleware, getMe);

module.exports = router;