const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const usuario = await User.findById(decoded.id).select('-senha');
    
    if (!usuario) {
      return res.status(401).json({ success: false, error: 'Usuário não encontrado' });
    }

    req.usuario = usuario;
    req.usuarioId = usuario._id;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }
};

module.exports = authMiddleware;