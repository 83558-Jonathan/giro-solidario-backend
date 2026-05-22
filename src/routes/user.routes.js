const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const validateObjectId = require("../middleware/validateObjectId");

router.use(authMiddleware);

router.get("/", userController.listarUsuarios);
router.get("/:id", validateObjectId(['id']), userController.buscarUsuario);
router.put("/:id", validateObjectId(['id']), userController.atualizarUsuario);
router.get("/:id/indicados", validateObjectId(['id']), userController.listarIndicados);

module.exports = router;