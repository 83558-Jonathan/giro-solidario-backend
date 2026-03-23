const express = require('express');
const router = express.Router();
const { registrar, login, getMe } = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

// Rotas públicas
router.post('/registrar', registrar);
router.post('/login', login);

// Rotas privadas
router.get('/me', authMiddleware, getMe);

module.exports = router;