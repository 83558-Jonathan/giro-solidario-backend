const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

// Todas as rotas de usuários requerem autenticação
router.use(authMiddleware);

// Listar todos os usuários
router.get('/', userController.listarUsuarios);

// Buscar usuário por ID
router.get('/:id', userController.buscarUsuario);

// Atualizar usuário
router.put('/:id', userController.atualizarUsuario);

// Listar indicados de um usuário
router.get('/:id/indicados', userController.listarIndicados);

module.exports = router;